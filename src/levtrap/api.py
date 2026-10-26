"""JSON-in / JSON-out entry points for the web worker (and scripts).

All inputs and outputs are SI.  Internally the OTT conventions are used
(see :mod:`levtrap.derived` for the conversions):

* F [N] = Q n_medium P / c, with Q from :func:`levtrap.force.forcetorque`
  for a beam whose coefficients are scaled so that ``beam.power`` equals
  the total power in watts (the beams of a superposition are scaled to
  their individual powers before the coherent sum).
* k [N/m] = -dQ/dx n P / c,  Omega = sqrt(k/m).
* U [J] = -integral F dx;  depth in k_B T at the given temperature.

Request schema (``compute`` / ``sweep``)::

    {
      "wavelength": 1.064e-6,            # vacuum wavelength [m]
      "medium_index": 1.0,
      "particle": {"radius": 1e-7, "n": 1.45, "k": 0.0, "density": 2200},
      "beams": [                         # 1 or 2 beams, summed coherently
        {"type": "lg" | "hg", "mode": [p, l] | [m, n],
         "NA": 0.9  (or "waist": 1e-6 [m], or "angle_deg": 50),
         "power": 0.1,                   # [W]
         "polarisation": "x" | "y" | "circular+" | "circular-" | [[re, im], [re, im]],
         "phase": 0.0}                   # relative phase [rad]
      ],
      "dark_focus": false,               # 2 beams: re-split power to null the focal field
      # With two beams the sum of the "power" entries is the power of the
      # coherent superposition; the entries set the ratio of the components.
      "multipoles": {"ED": true, "MD": true, "EQ": true, "MQ": true, "higher": true},
      "dipole_overlay": false,
      "temperature": 300.0,
      "scan": {"z_range": 3e-6, "z_points": 61, "x_range": 1.5e-6, "x_points": 41,
               "map_nx": 13, "map_nz": 17, "intensity_n": 60}
    }

Each response contains plain lists / floats only (``json.dumps``-able).
"""

from __future__ import annotations

import json
import math
import time
from typing import Any

import numpy as np

from . import __version__
from .bsc import Bsc, BscPmGauss
from .derived import (
    C, KB, mie_efficiencies, power_balance, recoil_ratio, sphere_mass, trap_frequency,
)
from .dipole import dipole_force
from .force import forcetorque
from .materials import MATERIALS, get_material
from .special import paraxial_beam_waist
from .tmatrix import TmatrixMie
from .traps import NoStableTrap, axial_equilibrium, find_traps, trap_depth

__all__ = ["compute", "sweep", "presets", "materials", "benchmark", "field3d", "handle"]

DEFAULT_SCAN = dict(z_range=3e-6, z_points=61, x_range=1.5e-6, x_points=41,
                    map_nx=13, map_nz=17, intensity_n=60)

_BEAM_CACHE: dict = {}
_INTENSITY_CACHE: dict = {}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _pol(p) -> tuple[complex, complex]:
    if isinstance(p, str):
        return {"x": (1, 0), "y": (0, 1), "circular+": (1, 1j), "circular-": (1, -1j),
                "circular": (1, 1j)}[p]
    return complex(p[0][0], p[0][1]), complex(p[1][0], p[1][1])


def _beam_angle(spec: dict, wavelength: float, n_medium: float, order: int) -> float:
    """Convergence angle [rad] from NA, angle or waist.

    For a waist W (1/e^2 field radius of the paraxial LG/HG mode at focus)
    OTT's far-field mapping gives tan(angle) = lambda_m w_p / (pi W) with
    w_p = ``paraxial_beam_waist(order)`` (BscPmGauss.m).
    """
    if spec.get("waist"):
        lam_m = wavelength / n_medium
        return math.atan(lam_m * paraxial_beam_waist(order) / (math.pi * float(spec["waist"])))
    if spec.get("angle_deg"):
        return math.radians(float(spec["angle_deg"]))
    na = float(spec.get("NA", 0.9))
    if na >= n_medium:
        raise ValueError(f"NA ({na}) must be smaller than the medium index ({n_medium})")
    return math.asin(na / n_medium)


def _single_beam(spec: dict, wavelength: float, n_medium: float) -> Bsc:
    btype = spec.get("type", "lg")
    mode = tuple(int(v) for v in spec.get("mode", (0, 0)))
    order = (2 * mode[0] + abs(mode[1])) if btype == "lg" else (mode[0] + mode[1])
    angle = _beam_angle(spec, wavelength, n_medium, order)
    pol = _pol(spec.get("polarisation", "x"))
    key = (btype, mode, round(angle, 12), pol, wavelength, n_medium)
    beam = _BEAM_CACHE.get(key)
    if beam is None:
        if len(_BEAM_CACHE) > 32:
            _BEAM_CACHE.clear()
        beam = BscPmGauss(btype, mode, polarisation=pol, angle=angle, index_medium=n_medium,
                          wavelength0=wavelength, power=1.0)
        _BEAM_CACHE[key] = beam
    return beam


def build_beam(req: dict) -> tuple[Bsc, float]:
    """Coherent superposition of the requested beams, scaled to watts.

    Returns ``(beam, P_total)`` with ``beam.power == P_total`` [W].
    """
    wl = float(req["wavelength"])
    nm = float(req.get("medium_index", 1.0))
    specs = req["beams"]
    powers = [max(float(s.get("power", 1.0)), 0.0) for s in specs]
    beams = [_single_beam(s, wl, nm) for s in specs]
    if req.get("dark_focus") and len(beams) == 2:
        # choose the power split that nulls the field at the focus,
        # keeping the total power: P1 |E1(0)|^2 = P2 |E2(0)|^2 (unit-power beams)
        e = [float(np.sum(np.abs(b.em_field_xyz(np.zeros((1, 3)))) ** 2)) for b in beams]
        ptot = sum(powers)
        powers = [ptot * e[1] / (e[0] + e[1]), ptot * e[0] / (e[0] + e[1])]
    total = None
    for spec, b, p in zip(specs, beams, powers):
        b = b * (math.sqrt(p) * np.exp(1j * float(spec.get("phase", 0.0))))
        total = b if total is None else total + b
    # Beams of different shape are not orthogonal, so the coherent sum
    # carries P1 + P2 + interference.  The requested total (sum of the
    # "power" entries) is taken to be the power of the combined beam.
    target = sum(powers)
    if len(specs) > 1 and total.power > 0:
        s = target / total.power
        total = total * math.sqrt(s)
        powers = [p * s for p in powers]
    total.info = dict(powers=powers)
    return total, total.power


def _multipole_fn(mp: dict | None):
    if not mp:
        return None
    labels = {(1, "E"): "ED", (1, "M"): "MD", (2, "E"): "EQ", (2, "M"): "MQ"}
    if all(mp.get(k, True) for k in ("ED", "MD", "EQ", "MQ", "higher")):
        return None
    return lambda n, kind: bool(mp.get(labels.get((n, kind), "higher"), True))


def build_tmatrix(req: dict, nmax_beam: int | None = None):
    wl = float(req["wavelength"])
    nm = float(req.get("medium_index", 1.0))
    p = req["particle"]
    n_p = complex(float(p["n"]), float(p.get("k", 0.0)))
    T = TmatrixMie(float(p["radius"]), index_medium=nm, index_particle=n_p, wavelength0=wl,
                   multipoles=_multipole_fn(req.get("multipoles")))
    return T, n_p


def _finite(x):
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (np.floating, float)):
        return float(x) if np.isfinite(x) else None
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.ndarray):
        return _finite(x.tolist())
    return x


def _multipole_powers(sbeam: Bsc, pin: float) -> dict:
    """Scattered power fraction per multipole: 4 sum_m |p_nm|^2 / P_inc."""
    n, _ = sbeam.get_mode_indices()
    pm = 4 * np.sum(np.abs(sbeam.a) ** 2, axis=1)  # M waves: magnetic
    pe = 4 * np.sum(np.abs(sbeam.b) ** 2, axis=1)  # N waves: electric
    out = {}
    for order, (le, lm) in {1: ("ED", "MD"), 2: ("EQ", "MQ"), 3: ("EO", "MO")}.items():
        out[le] = float(pe[n == order].sum() / pin)
        out[lm] = float(pm[n == order].sum() / pin)
    out["higher"] = float((pe[n > 3].sum() + pm[n > 3].sum()) / pin)
    return out


# ---------------------------------------------------------------------------
# core analysis
# ---------------------------------------------------------------------------


def _axial_scan(beam: Bsc, T, zs: np.ndarray) -> np.ndarray:
    """Q_z (and full Q) along the beam axis at positions zs [m]."""
    f = forcetorque(beam, T, position=np.vstack([0 * zs, 0 * zs, zs]))[0]
    return np.atleast_2d(f.T).T if f.ndim == 1 else f


def analyse(req: dict, detail: bool = True) -> dict:
    """Full single-point analysis.  See module docstring for the schema."""
    t0 = time.perf_counter()
    scan = {**DEFAULT_SCAN, **req.get("scan", {})}
    wl = float(req["wavelength"])
    nm = float(req.get("medium_index", 1.0))
    temp = float(req.get("temperature", 300.0))
    part = req["particle"]
    radius = float(part["radius"])
    density = float(part["density"])
    mass = sphere_mass(radius, density)
    beam, P = build_beam(req)
    T, n_p = build_tmatrix(req)
    unit = nm / C  # Q (with beam.power in W) -> N
    t_beam = time.perf_counter()

    # --- axial scan and equilibrium ------------------------------------
    zs = np.linspace(-scan["z_range"], scan["z_range"], int(scan["z_points"]))
    fz_line = _axial_scan(beam, T, zs)  # (3, N) in Q*W units
    traps = find_traps(zs, fz_line[2])
    stable = None
    z_eq = kz = None
    notes = []
    if traps:
        # prefer the trap with the deepest restoring force
        stable = max(traps, key=lambda t: t["depth"])
        try:
            z_eq, kzq = axial_equilibrium(T, beam, stable["position"])
            kz = -kzq * unit * P  # axial_equilibrium normalises to power 1
            if not (zs[0] <= z_eq <= zs[-1]):
                raise NoStableTrap
        except (NoStableTrap, np.linalg.LinAlgError, ValueError):
            z_eq = float(stable["position"])
            kz = -float(stable["stiffness"]) * unit
            notes.append("axial_equilibrium refinement failed; using scan estimate")
    result: dict[str, Any] = dict(version=__version__, wavelength=wl, power=P, mass=mass,
                                  beam_powers=beam.info.get("powers"))

    eff = mie_efficiencies(radius, wl, n_p, nm)
    result["mie"] = dict(Qext=eff["Qext"], Qsca=eff["Qsca"], Qabs=eff["Qabs"], x=eff["x"],
                         multipoles=eff["Qsca_multipoles"])
    result["Nmax"] = dict(beam=beam.Nmax, particle=T.Nmax[0])

    z_ref = z_eq if z_eq is not None else 0.0
    beam_ref = beam.translate_z(z_ref) if z_ref != 0 else beam
    sbeam, _ = beam_ref.scatter(T)
    pb = power_balance(beam_ref, sbeam)
    if abs(pb["abs"]) < 1e-12:  # round-off for (nearly) lossless particles
        pb["abs"] = max(pb["abs"], 0.0)
    result["at"] = dict(z=z_ref, P_sca=pb["sca"] * P, P_abs=pb["abs"] * P,
                        Qsca_beam=pb["sca"], Qabs_beam=pb["abs"],
                        multipoles=_multipole_powers(sbeam, beam_ref.power))

    # --- lateral stiffness at z_eq ----------------------------------------
    stable_3d = False
    kx = ky = None
    if z_eq is not None:
        dx = wl / nm / 200
        pos = np.array([[-dx, 0, 0], [dx, 0, 0], [0, -dx, 0], [0, dx, 0]]).T
        f = forcetorque(beam_ref, T, position=pos)[0]
        kx = -(f[0, 1] - f[0, 0]) / (2 * dx) * unit
        ky = -(f[1, 3] - f[1, 2]) / (2 * dx) * unit
        stable_3d = bool(kz > 0 and kx > 0 and ky > 0)
    result["stable"] = stable_3d
    result["z_eq"] = z_eq
    result["stiffness"] = dict(x=kx, y=ky, z=kz)
    Om = {a: (trap_frequency(k, mass) if k is not None else None) for a, k in (("x", kx), ("y", ky), ("z", kz))}
    result["Omega"] = Om
    result["freq"] = {a: (o / 2 / math.pi if o is not None and np.isfinite(o) else None) for a, o in Om.items()}
    result["recoil_ratio"] = {a: (recoil_ratio(result["at"]["P_sca"], wl, mass, o)
                                  if o is not None and np.isfinite(o) and o > 0 else None)
                              for a, o in Om.items()}

    # --- line cuts through the trap ---------------------------------------
    xs = np.linspace(-scan["x_range"], scan["x_range"], int(scan["x_points"]))
    fx_line = forcetorque(beam_ref, T, position=np.vstack([xs, 0 * xs, 0 * xs]))[0]
    fy_line = forcetorque(beam_ref, T, position=np.vstack([0 * xs, xs, 0 * xs]))[0]
    lines = dict(z=zs, Fz=fz_line * unit, x=xs, Fx=fx_line * unit, y=xs, Fy=fy_line * unit,
                 z_ref=z_ref)

    # --- trap depth ----------------------------------------------------------
    depth = {}
    if z_eq is not None:
        dz_, bz = trap_depth(zs, fz_line[2] * unit, z_eq)
        dx_, bx = trap_depth(xs, fx_line[0] * unit, 0.0)
        dy_, by = trap_depth(xs, fy_line[1] * unit, 0.0)
        depth = dict(z=dz_, x=dx_, y=dy_, bounded=dict(z=bz, x=bx, y=by))
        U = min(dz_, dx_, dy_) if stable_3d else 0.0
        depth.update(U=U, kT=U / (KB * temp), K=U / KB, temperature=temp)
    result["depth"] = depth

    if detail:
        t_lines = time.perf_counter()
        # --- xz force map over intensity -----------------------------------
        nx, nz = int(scan["map_nx"]), int(scan["map_nz"])
        mx = np.linspace(-scan["x_range"], scan["x_range"], nx)
        mz = np.linspace(-scan["z_range"], scan["z_range"], nz)
        FX = np.zeros((nz, nx))
        FZ = np.zeros((nz, nx))
        for i, zz in enumerate(mz):
            bz_ = beam.translate_z(zz) if zz != 0 else beam
            f = forcetorque(bz_, T, position=np.vstack([mx, 0 * mx, 0 * mx]))[0]
            FX[i] = f[0] * unit
            FZ[i] = f[2] * unit
        ni = int(scan["intensity_n"])
        ix = np.linspace(-scan["x_range"], scan["x_range"], ni)
        iz = np.linspace(-scan["z_range"], scan["z_range"], int(ni * 1.4))
        ikey = (json.dumps(req["beams"], sort_keys=True), bool(req.get("dark_focus")), wl, nm,
                float(scan["x_range"]), float(scan["z_range"]), ni)
        I = _INTENSITY_CACHE.get(ikey)
        if I is None:
            XX, ZZ = np.meshgrid(ix, iz)
            pts = np.stack([XX.ravel(), 0 * XX.ravel(), ZZ.ravel()], axis=1)
            E = beam.em_field_xyz(pts)
            # W/m^2, since beam.power = P [W] (see levtrap.derived)
            I = 4 * beam.k_medium**2 * np.sum(np.abs(E) ** 2, axis=1).reshape(XX.shape)
            if len(_INTENSITY_CACHE) > 8:
                _INTENSITY_CACHE.clear()
            _INTENSITY_CACHE[ikey] = I
        result["map"] = dict(x=mx, z=mz, Fx=FX, Fz=FZ, Ix=ix, Iz=iz, I=I)
        if req.get("dipole_overlay"):
            m_rel = n_p / nm
            zpts = np.stack([0 * zs, 0 * zs, zs], 1)
            xpts = np.stack([xs, 0 * xs, z_ref + 0 * xs], 1)
            ypts = np.stack([0 * xs, xs, z_ref + 0 * xs], 1)
            lines["dipole"] = dict(
                Fz=dipole_force(beam, radius, m_rel, zpts)[2] * unit * P,
                Fx=dipole_force(beam, radius, m_rel, xpts)[0] * unit * P,
                Fy=dipole_force(beam, radius, m_rel, ypts)[1] * unit * P)
        result["timing"] = dict(beam=t_beam - t0, lines=t_lines - t_beam,
                                map=time.perf_counter() - t_lines)
    result["lines"] = lines
    result["notes"] = notes
    result["time"] = time.perf_counter() - t0
    return _finite(result)


# ---------------------------------------------------------------------------
# 3D view (visual aid)
# ---------------------------------------------------------------------------


def _bilinear(F: np.ndarray, rho_g: np.ndarray, z_g: np.ndarray, rho: np.ndarray, z: np.ndarray):
    """Bilinear interpolation of F[irho, iz, ...] on a regular grid."""
    fr = np.clip((rho - rho_g[0]) / (rho_g[1] - rho_g[0]), 0, rho_g.size - 1.000001)
    fz = np.clip((z - z_g[0]) / (z_g[1] - z_g[0]), 0, z_g.size - 1.000001)
    i0 = fr.astype(int)
    k0 = fz.astype(int)
    tr = (fr - i0)[..., None]
    tz = (fz - k0)[..., None]
    return ((1 - tr) * (1 - tz) * F[i0, k0] + tr * (1 - tz) * F[i0 + 1, k0]
            + (1 - tr) * tz * F[i0, k0 + 1] + tr * tz * F[i0 + 1, k0 + 1])


def intensity_volume(beam: Bsc, x_range: float, z_range: float, nxy: int = 64, nz: int = 96):
    """|E|^2 on an (nxy, nxy, nz) grid, assembled from azimuthal orders.

    Every VSWF term carries exp(i m phi), and its spherical field components
    depend on (r, theta) only, so E(rho, phi, z) = sum_m E_m(rho, z) exp(i m phi).
    Each E_m is evaluated on a fine (rho, z) grid and interpolated, which is
    much cheaper than evaluating every voxel (accurate to the interpolation,
    sufficient for visualisation).  Returns ``(I, x, y, z)`` with I in W/m^2
    for ``beam.power`` in watts.
    """
    from .special import combined_index as _ci, sbesselh1, sbesselh2, sbesselj, spharm, xyz2rtp
    x = np.linspace(-x_range, x_range, nxy)
    z = np.linspace(-z_range, z_range, nz)
    rho_g = np.linspace(0, x_range * math.sqrt(2) * 1.001, int(nxy * 1.25))
    z_g = np.linspace(-z_range, z_range, int(nz * 1.25))
    R2, Z2 = np.meshgrid(rho_g, z_g, indexing="ij")
    r, t, _ = xyz2rtp(R2.ravel(), 0 * R2.ravel(), Z2.ravel())
    kr = np.maximum(r * beam.k_medium, 1e-15)
    a, b = beam.a[:, 0], beam.b[:, 0]
    idx = np.nonzero(np.abs(a) + np.abs(b))[0]
    n_all, m_all = _ci(idx + 1)
    ms = np.unique(m_all)
    col = {int(m): i for i, m in enumerate(ms)}
    # E_m(r, theta) at phi = 0, spherical components, all m in one pass
    # (same expressions as levtrap.vswf.em_field)
    Em = np.zeros((kr.size, ms.size, 3), dtype=complex)
    func = {"incoming": sbesselh2, "outgoing": sbesselh1, "regular": sbesselj}[beam.basis]
    scale = 0.5 if beam.basis in ("incoming", "outgoing") else 1.0
    fall = func(np.arange(0, int(n_all.max()) + 1), kr) * scale
    for nn in np.unique(n_all):
        nn = int(nn)
        sel = n_all == nn
        mm = m_all[sel]
        Nn = 1 / math.sqrt(nn * (nn + 1))
        Y, Yt, Yp = spharm(nn, mm, t, np.zeros_like(t))
        hn = fall[:, nn][:, None]
        dhn = (fall[:, nn - 1] - nn / kr * fall[:, nn])[:, None]
        p_, q_ = a[idx][sel][None, :], b[idx][sel][None, :]
        cols = [col[int(m)] for m in mm]
        Em[:, cols, 0] += Nn * nn * (nn + 1) / kr[:, None] * hn * Y * q_
        Em[:, cols, 1] += Nn * (hn * Yp * p_ + dhn * Yt * q_)
        Em[:, cols, 2] += Nn * (-hn * Yt * p_ + dhn * Yp * q_)
    Em = Em.reshape(R2.shape + (ms.size, 3))
    X, Y3, Z = np.meshgrid(x, x, z, indexing="ij")
    rho = np.hypot(X, Y3)
    phi = np.arctan2(Y3, X)
    E = np.zeros(X.shape + (3,), dtype=complex)
    for i, m in enumerate(ms):
        E += _bilinear(Em[:, :, i, :], rho_g, z_g, rho, Z) * np.exp(1j * m * phi)[..., None]
    I = 4 * beam.k_medium**2 * np.sum(np.abs(E) ** 2, axis=-1)
    return I, x, x, z


def _b64_u8(v: np.ndarray) -> str:
    import base64
    vmax = float(v.max()) or 1.0
    u8 = np.clip(np.round(v / vmax * 255), 0, 255).astype(np.uint8)
    # x fastest, then y, then z (WebGL 3D texture order)
    return base64.b64encode(np.ascontiguousarray(u8.transpose(2, 1, 0)).tobytes()).decode()


def field3d(req_json: str, opts_json: str = "{}") -> str:
    """Intensity and |grad I| volumes (and optional force arrows) for the 3D view.

    opts: {"nxy": 64, "nz": 96, "forces": false, "force_n": [7, 11], "z_eq": float|null}
    Volumes are returned as base64 uint8 (normalised to their maxima, given
    in W/m^2 and W/m^3), x fastest.
    """
    req = json.loads(req_json)
    opts = json.loads(opts_json)
    t0 = time.perf_counter()
    scan = {**DEFAULT_SCAN, **req.get("scan", {})}
    beam, P = build_beam(req)
    xr, zr = float(scan["x_range"]), float(scan["z_range"])
    nxy, nzz = int(opts.get("nxy", 64)), int(opts.get("nz", 96))
    I, x, y, z = intensity_volume(beam, xr, zr, nxy, nzz)
    gx, gy, gz = np.gradient(I, x, y, z)
    G = np.sqrt(gx**2 + gy**2 + gz**2)
    out = dict(dims=[nxy, nxy, nzz], bounds=dict(x=xr, y=xr, z=zr), I=_b64_u8(I), Imax=float(I.max()),
               G=_b64_u8(G), Gmax=float(G.max()), radius=float(req["particle"]["radius"]),
               z_eq=opts.get("z_eq"), wavelength=float(req["wavelength"]))
    if opts.get("forces"):
        T, _ = build_tmatrix(req)
        nf, nzf = opts.get("force_n", [7, 11])
        fx_ = np.linspace(-xr * 0.85, xr * 0.85, int(nf))
        fz_ = np.linspace(-zr * 0.85, zr * 0.85, int(nzf))
        FX, FY = np.meshgrid(fx_, fx_, indexing="ij")
        lat = np.vstack([FX.ravel(), FY.ravel(), 0 * FX.ravel()])
        pos, vec = [], []
        for zz in fz_:
            bz = beam.translate_z(zz) if zz != 0 else beam
            f = forcetorque(bz, T, position=lat)[0] * (nm_ := float(req.get("medium_index", 1.0))) / C
            for i in range(lat.shape[1]):
                pos.append([lat[0, i], lat[1, i], zz])
                vec.append(f[:, i].tolist())
        out["forces"] = dict(pos=pos, vec=vec)
    out["time"] = time.perf_counter() - t0
    return json.dumps(_finite(out))


# ---------------------------------------------------------------------------
# Lens tilt page
# ---------------------------------------------------------------------------

_LENS_BEAMS: dict = {}


def _lens_beam(lens_req: dict, wl: float):
    from .lens import THORLABS_354330, focused_beam
    key = json.dumps(dict(lens_req, wl=wl), sort_keys=True)
    lr = _LENS_BEAMS.get(key)
    if lr is None:
        if len(_LENS_BEAMS) > 24:
            _LENS_BEAMS.clear()
        lr = focused_beam(THORLABS_354330, wl * 1e6, float(lens_req.get("diameter_mm", 2.5)),
                          float(lens_req.get("tilt_x_deg", 0.0)), float(lens_req.get("tilt_y_deg", 0.0)),
                          (float(lens_req.get("decenter_x_mm", 0.0)), float(lens_req.get("decenter_y_mm", 0.0))),
                          lens_req.get("pivot", "centre"), _pol(lens_req.get("polarisation", "x")),
                          nmax=int(lens_req.get("nmax", 30)), n_rays=int(lens_req.get("n_rays", 81)))
        _LENS_BEAMS[key] = lr
    return lr


def _lens_trap(req: dict, lens_req: dict, detail: bool, r_start=None):
    """Trap analysis for the beam behind the (tilted) lens.  Positions are
    relative to the best focus P* of that beam; the caller adds P*."""
    from .traps import equilibrium_3d
    wl = float(req["wavelength"])
    lr = _lens_beam(lens_req, wl)
    P = float(req.get("power", 0.1))
    beam = lr.beam * math.sqrt(P * lr.transmitted)  # coefficients in sqrt(W)
    T, n_p = build_tmatrix(dict(req, medium_index=1.0))
    part = req["particle"]
    mass = sphere_mass(float(part["radius"]), float(part["density"]))
    unit = 1.0 / C  # vacuum
    zr = float(req.get("z_range", 4e-6))
    c = lr.centroid_dir
    ss = np.linspace(-zr, zr, int(req.get("z_points", 41)))
    line = np.outer(c, ss)
    f = forcetorque(beam, T, position=line)[0]
    fpar = c @ f
    out = dict(stable=False, r_eq=None, freqs=None, axes=None, depth_kT=None, transmitted=lr.transmitted,
               mass=mass)
    out["axial_scan"] = dict(s=ss, F=fpar * unit) if detail else None
    traps = find_traps(ss, fpar)
    ok = False
    out["jumped"] = False
    if r_start is not None:
        # continuation (sweeps): follow the equilibrium found at the previous point
        r_eq, K, ok = equilibrium_3d(beam, T, np.asarray(r_start, dtype=float))
        if ok and np.all(np.linalg.eigvalsh(0.5 * (K + K.T)) > 0):
            traps = traps or [dict(position=0.0, depth=0.0)]
        else:
            ok = False
            out["jumped"] = True  # the followed equilibrium vanished
    if not ok:
        if not traps:
            return out, beam, T, lr
        t0 = max(traps, key=lambda t: t["depth"])
        r_eq, K, ok = equilibrium_3d(beam, T, c * t0["position"])
    Ks = 0.5 * (K + K.T) * unit
    ev, evec = np.linalg.eigh(Ks)
    stable = bool(ok and np.all(ev > 0))
    order = np.argsort(-np.abs(evec[2]))  # most axial mode first
    ev, evec = ev[order], evec[:, order]
    freqs = [float(np.sqrt(e / mass) / 2 / math.pi) if e > 0 else None for e in ev]
    for i in range(3):  # orient eigenvectors consistently
        if evec[np.argmax(np.abs(evec[:, i])), i] < 0:
            evec[:, i] *= -1
    out.update(stable=stable, converged=bool(ok), r_eq=r_eq, K=Ks, freqs=freqs, axes=evec.T,
               axial_angle_mrad=float(np.arccos(min(1.0, abs(evec[2, 0]))) * 1e3))
    if detail and stable:
        temp = float(req.get("temperature", 300.0))
        rng = float(req.get("depth_range", 2.5e-6))
        dd = np.linspace(-rng, rng, 31)
        depths = []
        tb_eq = beam.translate_xyz(r_eq)  # scans from r_eq along fixed directions reuse rotations
        for i in range(3):
            fl = evec[:, i] @ forcetorque(tb_eq, T, position=np.outer(evec[:, i], dd))[0]
            depths.append(trap_depth(dd, fl * unit, 0.0)[0])
        out["depth_kT"] = min(depths) / (KB * temp)
        out["depths_kT"] = [d / (KB * temp) for d in depths]
    if stable:
        tb = beam.translate_xyz(r_eq)
        sb, _ = tb.scatter(T)
        pb = power_balance(tb, sb)
        out["P_sca"] = pb["sca"] * tb.power
        out["P_abs"] = max(pb["abs"], 0.0) * tb.power
        if freqs[0]:
            out["recoil_ratio_axial"] = recoil_ratio(out["P_sca"], wl, mass, 2 * math.pi * freqs[0])
    out["mass"] = mass
    return out, beam, T, lr


def _lens_point(req: dict, detail: bool = True, start_um=None) -> dict:
    """``start_um``: equilibrium guess relative to the aligned focus (um)."""
    lens_req = dict(req.get("lens", {}))
    ref_req = dict(lens_req, tilt_x_deg=0.0, tilt_y_deg=0.0, decenter_x_mm=0.0, decenter_y_mm=0.0)
    r_start = None
    if start_um is not None:
        lr_ = _lens_beam(lens_req, float(req["wavelength"]))
        lr0_ = _lens_beam(ref_req, float(req["wavelength"]))
        r_start = (np.asarray(start_um) * 1e-3 - (lr_.focus_mm - lr0_.focus_mm)) * 1e-3  # m, about P*
    res, beam, T, lr = _lens_trap(req, lens_req, detail, r_start)
    res0, _, _, lr0 = _lens_trap(req, ref_req, False)
    um = 1e3  # mm -> um
    focus = (lr.focus_mm - lr0.focus_mm) * um
    out = dict(
        focus_shift_um=focus, rms_waves=lr.rms_waves, rms_waves_untilted=lr0.rms_waves,
        transmitted=lr.transmitted, n_glass=lr.n_glass,
        bfl_mm=float(lr0.focus_mm[2] - 3.214106073867),
        pointing_mrad=[float(lr.centroid_dir[0] * 1e3), float(lr.centroid_dir[1] * 1e3)],
        stable=res["stable"], freqs=res["freqs"], axes=res["axes"], depth_kT=res.get("depth_kT"),
        depths_kT=res.get("depths_kT"), axial_angle_mrad=res.get("axial_angle_mrad"),
        P_sca=res.get("P_sca"), P_abs=res.get("P_abs"), recoil_ratio_axial=res.get("recoil_ratio_axial"),
        mass=res["mass"], freqs_untilted=res0["freqs"], stable_untilted=res0["stable"],
        jumped=res.get("jumped", False),
    )
    if res["r_eq"] is not None:
        out["eq_rel_focus_um"] = res["r_eq"] * 1e6
        out["eq_um"] = focus + res["r_eq"] * 1e6  # relative to the untilted best focus
    if res0["r_eq"] is not None:
        out["eq_untilted_um"] = res0["r_eq"] * 1e6
        if res["r_eq"] is not None:
            out["particle_shift_um"] = out["eq_um"] - out["eq_untilted_um"]
    if detail:
        out["axial_scan"] = res["axial_scan"]
        # wavefront map (waves), downsampled
        step = max(1, lr.W.shape[0] // 61)
        Wm = lr.W[::step, ::step] / (float(req["wavelength"]) * 1e3)
        # show only the illuminated part (intensity > ~1% of the peak)
        w_mm = float(lens_req.get("diameter_mm", 2.5)) / 2
        R = np.hypot(lr.x[::step, ::step], lr.y[::step, ::step])
        Wm = np.where(R <= 1.5 * w_mm, Wm, np.nan)
        out["wavefront"] = dict(x=lr.x[0, ::step], y=lr.y[::step, 0], W=Wm)
        # focal intensity maps around the trap (about P*), xz and xy
        c = res["r_eq"] if res["r_eq"] is not None else np.zeros(3)
        hx, hz = float(req.get("map_x", 2.5e-6)), float(req.get("map_z", 4e-6))
        xs = np.linspace(-hx, hx, 41)
        zs = np.linspace(-hz, hz, 61)
        X, Z = np.meshgrid(xs, zs)
        Ixz = np.sum(np.abs(beam.em_field_xyz(np.stack([X.ravel(), 0 * X.ravel(), Z.ravel()], 1))) ** 2, 1)
        Y2, X2 = np.meshgrid(xs, xs, indexing="ij")
        Ixy = np.sum(np.abs(beam.em_field_xyz(np.stack([X2.ravel(), Y2.ravel(), c[2] + 0 * X2.ravel()], 1))) ** 2, 1)
        k = beam.k_medium
        out["maps"] = dict(x=xs, z=zs, Ixz=(4 * k**2 * Ixz).reshape(X.shape), Ixy=(4 * k**2 * Ixy).reshape(X2.shape),
                           z_cut=float(c[2]), focus_um=focus)
    return _finite(out)


def lens_trap(req_json: str) -> str:
    """Lens-tilt analysis for one configuration.  Request::

        {"wavelength": 1.55e-6, "power": 0.1,  # W incident on the lens
         "particle": {...}, "temperature": 300,
         "lens": {"diameter_mm": 2.5, "tilt_x_deg": 0, "tilt_y_deg": 1,
                  "pivot": "centre", "decenter_x_mm": 0, "decenter_y_mm": 0,
                  "polarisation": "x"}}

    Positions are in micrometres relative to the best focus of the untilted
    lens (same wavelength and beam); z is the optical axis of the untilted
    lens, pointing away from it.
    """
    try:
        t0 = time.perf_counter()
        out = _lens_point(json.loads(req_json), True)
        out["time"] = time.perf_counter() - t0
        return json.dumps(dict(ok=True, result=out))
    except Exception as exc:
        return json.dumps(dict(ok=False, error=f"{type(exc).__name__}: {exc}"))


def lens_sweep(req_json: str, variable: str, values_json: str, start_json: str = "null") -> str:
    """Sweep 'tilt_x_deg', 'tilt_y_deg', 'diameter_mm', 'decenter_x_mm' or 'power'.

    Successive points follow the same equilibrium (continuation): each starts
    from the previous particle position; ``start_json`` seeds the first point.
    """
    req = json.loads(req_json)
    pts = []
    start = json.loads(start_json)
    for v in json.loads(values_json):
        r = json.loads(json.dumps(req))
        if variable == "power":
            r["power"] = float(v)
        else:
            r.setdefault("lens", {})[variable] = float(v)
        try:
            pt = _lens_point(r, False, start)
            pts.append(dict(value=v, **pt))
            if pt.get("stable") and pt.get("eq_um") is not None:
                start = pt["eq_um"]
        except Exception as exc:
            pts.append(dict(value=v, stable=False, error=str(exc)))
    return json.dumps(_finite(dict(ok=True, variable=variable, points=pts)))


def compute(req_json: str) -> str:
    """JSON wrapper around :func:`analyse`."""
    req = json.loads(req_json)
    try:
        return json.dumps(dict(ok=True, result=analyse(req)))
    except Exception as exc:  # report to the UI rather than crash the worker
        return json.dumps(dict(ok=False, error=f"{type(exc).__name__}: {exc}"))


def sweep_point(req: dict) -> dict:
    """Reduced analysis for one sweep point (no maps)."""
    r = analyse(req, detail=False)
    return dict(stable=r["stable"], z_eq=r["z_eq"], freq=r["freq"], depth_kT=r["depth"].get("kT"),
                recoil_ratio=r["recoil_ratio"], P_sca=r["at"]["P_sca"], P_abs=r["at"]["P_abs"],
                multipoles=r["at"]["multipoles"], Qsca=r["mie"]["Qsca"], Qabs=r["mie"]["Qabs"])


def _set_param(req: dict, variable: str, value: float) -> dict:
    req = json.loads(json.dumps(req))
    if variable == "radius":
        req["particle"]["radius"] = value
    elif variable == "wavelength":
        req["wavelength"] = value
        mat = req["particle"].get("material")
        if mat and mat in MATERIALS:
            m = get_material(mat, value)
            if m["valid"]:
                req["particle"].update(n=m["n"], k=m["k"])
    elif variable == "power":
        tot = sum(float(b.get("power", 1.0)) for b in req["beams"])
        for b in req["beams"]:
            b["power"] = float(b.get("power", 1.0)) * value / tot
    else:
        raise ValueError(f"Unknown sweep variable {variable}")
    return req


def sweep(req_json: str, variable: str, values_json: str) -> str:
    """Sweep ``variable`` in {'radius', 'wavelength', 'power'} over values."""
    req = json.loads(req_json)
    values = json.loads(values_json)
    pts = []
    for v in values:
        try:
            pts.append(dict(value=v, **sweep_point(_set_param(req, variable, float(v)))))
        except Exception as exc:
            pts.append(dict(value=v, stable=False, error=str(exc)))
    return json.dumps(_finite(dict(ok=True, variable=variable, points=pts)))


# ---------------------------------------------------------------------------
# presets / materials / benchmark
# ---------------------------------------------------------------------------


def _silica(wl: float, radius: float) -> dict:
    m = get_material("SiO2", wl)
    return dict(material="SiO2", radius=radius, n=m["n"], k=m["k"], density=m["density"])


PRESETS = {
    "silica_1064": dict(
        label="Silica bright tweezer @ 1064 nm", validated=True,
        request=dict(wavelength=1064e-9, medium_index=1.0, particle=_silica(1064e-9, 100e-9),
                     beams=[dict(type="lg", mode=[0, 0], NA=0.9, power=0.2, polarisation="x", phase=0.0)],
                     scan=dict(z_range=2.5e-6, x_range=1.2e-6))),
    "silica_1550": dict(
        label="Silica bright tweezer @ 1550 nm", validated=True,
        request=dict(wavelength=1550e-9, medium_index=1.0, particle=_silica(1550e-9, 100e-9),
                     beams=[dict(type="lg", mode=[0, 0], NA=0.9, power=0.2, polarisation="x", phase=0.0)],
                     scan=dict(z_range=3e-6, x_range=1.6e-6))),
    "ws2_bottle_1550": dict(
        label="WS₂ bottle-beam dark trap @ 1550 nm (illustrative, not validated)", validated=False,
        note=("Two coherent circularly polarised LG beams (p=0, w=1.59 um) and (p=1, w=0.866 um) "
              "with relative phase pi and 0.8 W total, after arXiv:2607.09896. The power split is "
              "not given in the paper; it is chosen so the field vanishes at the focus. "
              "No OTT reference covers this case."),
        request=dict(wavelength=1550e-9, medium_index=1.0, dark_focus=True,
                     particle=dict(material="WS2", radius=300e-9, n=3.79, k=2.83e-10, density=7500.0),
                     beams=[dict(type="lg", mode=[0, 0], waist=1.59e-6, power=0.4, polarisation="circular+", phase=0.0),
                            dict(type="lg", mode=[1, 0], waist=0.866e-6, power=0.4, polarisation="circular+",
                                 phase=math.pi)],
                     scan=dict(z_range=3.1e-6, x_range=2.0e-6))),
}


def presets() -> str:
    return json.dumps(PRESETS)


def materials(wavelength) -> str:
    wl = float(wavelength)
    return json.dumps(_finite({k: get_material(k, wl) for k in MATERIALS}))


def benchmark() -> str:
    """OTT testExamples.m axial-equilibrium benchmark (timed)."""
    t0 = time.perf_counter()
    n_medium, n_particle, wl = 1.34, 1.59, 1064e-9
    radius = 1.5 * wl / n_medium
    beam = BscPmGauss(angle_deg=50, polarisation=(1, 0), index_medium=n_medium, wavelength0=wl, power=1.0)
    T = TmatrixMie(radius, index_medium=n_medium, index_particle=n_particle, wavelength0=wl)
    z, kz = axial_equilibrium(T, beam)
    b2, _ = beam.translate_z(z).rotate_y(math.pi / 2)
    x, kx = axial_equilibrium(T, b2)
    return json.dumps(dict(z=z, kz=kz, x=x, kx=kx, time=time.perf_counter() - t0,
                           expected=dict(z=4.023474767793779e-07, kz=-6.258368435930368e04,
                                         x=0.0, kx=-2.450214062064871e05)))


def handle(method: str, *args) -> str:
    """Dispatch used by the web worker."""
    return {"compute": compute, "sweep": sweep, "presets": presets, "field3d": field3d,
            "lens_trap": lens_trap, "lens_sweep": lens_sweep,
            "materials": materials, "benchmark": benchmark}[method](*args)


