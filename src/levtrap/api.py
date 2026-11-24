"""JSON-in / JSON-out entry points for the engine (the app's worker and
local server, and scripts), and the beam and T-matrix builders ``solve``
uses.

All inputs and outputs are SI.  Internally the OTT conventions are used
(see :mod:`levtrap.derived` for the conversions):

* F [N] = Q n_medium P / c, with Q from :func:`levtrap.force.forcetorque`
  for a beam whose coefficients are scaled so that ``beam.power`` equals
  the total power in watts (the beams of a superposition are scaled to
  their individual powers before the coherent sum).

Entry points (:func:`handle` dispatches them by name):

* ``solve``: :func:`levtrap.solve.solve_json`, the Setup -> Result contract;
* ``field3d``: intensity volumes (and force arrows) for a request
  ``{"setup": …, "options": {"scan": …, "multipoles": …}}``;
* ``lens_trap`` / ``lens_sweep``: the ray-traced asphere (levtrap.lens);
* ``materials``, ``benchmark``.

Each response contains plain lists / floats only (``json.dumps``-able).
"""

from __future__ import annotations

import json
import math
import time

import numpy as np

from .bsc import Bsc, BscPmGauss
from .derived import C, KB, power_balance, recoil_ratio, sphere_mass
from .force import forcetorque
from .materials import MATERIALS, get_material
from .special import paraxial_beam_waist
from .tmatrix import TmatrixMie
from .traps import axial_equilibrium, find_traps, trap_depth

__all__ = ["materials", "benchmark", "field3d", "lens_trap", "lens_sweep", "handle"]

DEFAULT_SCAN = dict(z_range=3e-6, x_range=1.5e-6)  # field3d's box [m], unless the request's options.scan says

_BEAM_CACHE: dict = {}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _pol(p) -> tuple[complex, complex]:
    if isinstance(p, str):
        return {"x": (1, 0), "y": (0, 1), "circular+": (1, 1j), "circular-": (1, -1j),
                "circular": (1, 1j)}[p]
    return complex(p[0][0], p[0][1]), complex(p[1][0], p[1][1])


def _beam_angle(focus: dict, wavelength: float, n_medium: float, order: int) -> float:
    """Convergence angle [rad] from the focus block (NA, angle_deg or waist).

    For a waist W (1/e^2 field radius of the paraxial LG/HG mode at focus)
    OTT's far-field mapping (the default) gives tan(angle) = lambda_m w_p / (pi W)
    with w_p = ``paraxial_beam_waist(order)`` (BscPmGauss.m). With
    ``mapping: "sine"`` (#64) it is sin(angle) = lambda_m w_p / (pi W): a
    Gaussian's angular spectrum goes with k sin(theta), so this is the
    textbook relation; below lambda_m w_p / pi there is no angle.
    """
    if focus.get("waist"):
        lam_m = wavelength / n_medium
        s = lam_m * paraxial_beam_waist(order) / (math.pi * float(focus["waist"]))
        if focus.get("mapping") == "sine":
            if s >= 1:
                raise ValueError(f"a waist of {float(focus['waist']):.3g} m is below the diffraction limit "
                                 f"{lam_m * paraxial_beam_waist(order) / math.pi:.3g} m")
            return math.asin(s)
        return math.atan(s)
    if focus.get("angle_deg"):
        return math.radians(float(focus["angle_deg"]))
    na = float(focus["NA"])
    if na >= n_medium:
        raise ValueError(f"NA ({na}) must be smaller than the medium index ({n_medium})")
    return math.asin(na / n_medium)


def _single_beam(b: dict, n_medium: float) -> Bsc:
    """Unit-power beam for one beam field of a parsed setup."""
    wavelength = float(b["wavelength"])
    btype = b["mode"]["type"]
    mode = tuple(int(v) for v in b["mode"]["indices"])
    order = (2 * mode[0] + abs(mode[1])) if btype == "lg" else (mode[0] + mode[1])
    angle = _beam_angle(b["focus"], wavelength, n_medium, order)
    pol = _pol(b["polarisation"])
    filling = b["focus"].get("filling")
    mapping = b["focus"].get("mapping", "ott")
    key = (btype, mode, round(angle, 12), pol, wavelength, n_medium, filling, mapping)
    beam = _BEAM_CACHE.get(key)
    if beam is None:
        if len(_BEAM_CACHE) > 32:
            _BEAM_CACHE.clear()
        if filling:
            # an aplanatic objective (sine condition, rho = f sin theta) of aperture sin(theta_max) = NA / n,
            # its back aperture filled by the beam: 1/e^2 radius = filling x aperture radius (issue #61);
            # the power is what passes the aperture
            beam = BscPmGauss(btype, mode, polarisation=pol, angle=angle, index_medium=n_medium,
                              wavelength0=wavelength, power=1.0, angular_scaling="sintheta",
                              apodisation="aplanatic", width_sin=float(filling) * math.sin(angle),
                              truncation_angle=angle)
        elif mapping == "sine":
            # the Gaussian of this NA as its angular spectrum has it (#64): the paraxial beam mapped by
            # sin(theta), weighted by sqrt(cos theta) as an aplanatic lens does, so it fades to 0 at 90 degrees;
            # at small NA its waist is the textbook lambda / (pi NA)
            beam = BscPmGauss(btype, mode, polarisation=pol, angle=angle, index_medium=n_medium,
                              wavelength0=wavelength, power=1.0, angular_scaling="sintheta",
                              apodisation="aplanatic")
        else:
            # OTT's BscPmGauss: the paraxial beam mapped by tan(theta) (the default; OTT-based papers use it)
            beam = BscPmGauss(btype, mode, polarisation=pol, angle=angle, index_medium=n_medium,
                              wavelength0=wavelength, power=1.0)
        _BEAM_CACHE[key] = beam
    return beam


def prepare(req: dict | str) -> tuple[dict, dict]:
    """``{"setup": …, "options": …}`` -> (parsed setup, options).

    The setup is validated, checked to be one this engine computes, and its
    particle's n, k and density are filled in from the material if not given.
    """
    from .setup import parse
    from .solve import check_simple, resolve_particle
    if isinstance(req, str):
        req = json.loads(req)
    if not isinstance(req, dict) or "setup" not in req:
        raise ValueError('the request must be {"setup": …, "options": …}')
    s = parse(req["setup"])
    check_simple(s)
    resolve_particle(s)
    return s, dict(req.get("options") or {})


def wavelength_of(s: dict) -> float:
    return float(s["trap"]["fields"][0]["wavelength"])


def build_beam(s: dict, options: dict | None = None) -> tuple[Bsc, float]:
    """Coherent superposition of the setup's beams, scaled to watts.

    Returns ``(beam, P_total)`` with ``beam.power == P_total`` [W].
    ``options`` is accepted for the request shape and not used.
    """
    nm = float(s["environment"]["medium_index"])
    specs = s["trap"]["fields"]
    powers = [max(float(b["power"]), 0.0) for b in specs]
    beams = [_single_beam(b, nm) for b in specs]
    total = None
    for spec, b, p in zip(specs, beams, powers):
        b = b * (math.sqrt(p) * np.exp(1j * float(spec["phase"])))
        total = b if total is None else total + b
    # Beams of different shape are not orthogonal, so the coherent sum
    # carries P1 + P2 + interference.  The requested total (sum of the
    # "power" entries) is taken to be the power of the combined beam.
    target = sum(powers)
    if len(specs) > 1 and total.power > 0:
        scale = target / total.power
        total = total * math.sqrt(scale)
        powers = [p * scale for p in powers]
    total.info = dict(powers=powers)
    return total, total.power


def _multipole_fn(mp: dict | None):
    if not mp:
        return None
    labels = {(1, "E"): "ED", (1, "M"): "MD", (2, "E"): "EQ", (2, "M"): "MQ"}
    if all(mp.get(k, True) for k in ("ED", "MD", "EQ", "MQ", "higher")):
        return None
    return lambda n, kind: bool(mp.get(labels.get((n, kind), "higher"), True))


def _tmatrix(particle: dict, wavelength: float, n_medium: float, multipoles: dict | None = None):
    n_p = complex(float(particle["n"]), float(particle.get("k") or 0.0))
    T = TmatrixMie(float(particle["radius"]), index_medium=n_medium, index_particle=n_p,
                   wavelength0=wavelength, multipoles=_multipole_fn(multipoles))
    return T, n_p


def build_tmatrix(s: dict, options: dict | None = None):
    """T-matrix of the setup's particle (n, k already resolved by :func:`prepare`)."""
    return _tmatrix(s["particle"], wavelength_of(s), float(s["environment"]["medium_index"]),
                    (options or {}).get("multipoles"))


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


# ---------------------------------------------------------------------------
# 3D view (the field map)
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
    s, options = prepare(req_json)
    opts = json.loads(opts_json)
    t0 = time.perf_counter()
    scan = {**DEFAULT_SCAN, **options.get("scan", {})}
    beam, P = build_beam(s, options)
    xr, zr = float(scan["x_range"]), float(scan["z_range"])
    nxy, nzz = int(opts.get("nxy", 64)), int(opts.get("nz", 96))
    I, x, y, z = intensity_volume(beam, xr, zr, nxy, nzz)
    gx, gy, gz = np.gradient(I, x, y, z)
    G = np.sqrt(gx**2 + gy**2 + gz**2)
    out = dict(dims=[nxy, nxy, nzz], bounds=dict(x=xr, y=xr, z=zr), I=_b64_u8(I), Imax=float(I.max()),
               G=_b64_u8(G), Gmax=float(G.max()), radius=float(s["particle"]["radius"]),
               z_eq=opts.get("z_eq"), wavelength=wavelength_of(s))
    if opts.get("forces"):
        T, _ = build_tmatrix(s, options)
        nm = float(s["environment"]["medium_index"])
        nf, nzf = opts.get("force_n", [7, 11])
        fx_ = np.linspace(-xr * 0.85, xr * 0.85, int(nf))
        fz_ = np.linspace(-zr * 0.85, zr * 0.85, int(nzf))
        FX, FY = np.meshgrid(fx_, fx_, indexing="ij")
        lat = np.vstack([FX.ravel(), FY.ravel(), 0 * FX.ravel()])
        pos, vec = [], []
        for zz in fz_:
            bz = beam.translate_z(zz) if zz != 0 else beam
            f = forcetorque(bz, T, position=lat)[0] * nm / C
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


def asphere_focus(b: dict) -> dict:
    """A beam field focused by a real lens (``focus.kind = "asphere"``):
    its unit-power beam about the best focus P* of the lens as set (tilted,
    decentred), where P* is relative to the best focus of the same lens
    untilted and centred (the beam's ``position``), and what the lens does.

    Returns ``beam`` (a :class:`Bsc` in the beam's own frame, about P*, for 1 W
    on the lens: its power is the fraction transmitted), ``offset`` [m] (P*
    in the beam's own frame) and ``info`` (the ``lenses`` block of a Result
    for this beam, before the lab-frame entries are added).
    """
    focus = b["focus"]
    wl = float(b["wavelength"])
    lens_req = dict(diameter_mm=float(focus["beam_diameter"]) * 1e3, tilt_x_deg=float(focus["tilt_deg"][0]),
                    tilt_y_deg=float(focus["tilt_deg"][1]), decenter_x_mm=float(focus["decentre"][0]) * 1e3,
                    decenter_y_mm=float(focus["decentre"][1]) * 1e3, pivot="centre",
                    polarisation=b["polarisation"])
    ref_req = dict(lens_req, tilt_x_deg=0.0, tilt_y_deg=0.0, decenter_x_mm=0.0, decenter_y_mm=0.0)
    lr, lr0 = _lens_beam(lens_req, wl), _lens_beam(ref_req, wl)
    offset = (np.asarray(lr.focus_mm) - np.asarray(lr0.focus_mm)) * 1e-3
    info = dict(lens=focus["lens"], transmitted=float(lr.transmitted), clipping_loss=float(1 - lr.transmitted),
                rms_waves=float(lr.rms_waves), rms_waves_untilted=float(lr0.rms_waves), n_glass=float(lr.n_glass),
                back_focal_length=float(lr0.focus_mm[2] - 3.214106073867) * 1e-3,
                pointing_mrad=[float(lr.centroid_dir[0] * 1e3), float(lr.centroid_dir[1] * 1e3)])
    return dict(beam=lr.beam * math.sqrt(lr.transmitted), offset=offset, info=info, lens=lr, aligned_focus_mm=np.asarray(lr0.focus_mm),
                wavelength=wl, beam_diameter=float(focus["beam_diameter"]))


def lens_detail(entry: dict, R: np.ndarray, position: np.ndarray, per_fan: int = 9) -> dict:
    """The traced rays and the wavefront error of a beam focused by a real lens
    (``asphere_focus``'s ``entry``), for ``want=["lens"]``.

    ``rays``: two fans (across x and across y, through the beam's centre),
    ``per_fan`` rays each within the beam's 1/e^2 diameter; each ray is a
    polyline [m, lab] from the incoming beam, to the front surface, to the back
    surface, to the plane of the best focus, with its ``weight`` (the input
    intensity, 1 on the axis). ``R`` and ``position`` place the beam's own
    frame (origin at the aligned lens's best focus) in the lab.

    ``wavefront``: the error W [waves] about the best focus on the input ray
    grid ``x``, ``y`` [m] (null where no ray passes), with ``weight`` (the
    input intensity); sqrt(sum weight W^2 / sum weight) is the lens's
    ``rms_waves``.
    """
    lr = entry["lens"]
    tr = lr.trace
    P0 = entry["aligned_focus_mm"]
    P = np.asarray(lr.focus_mm)

    def lab(v_mm):  # lens lab (mm, S1 vertex of the aligned lens at 0) -> lab (m)
        own = (np.asarray(v_mm, dtype=float) - P0) * 1e-3
        return (own @ R.T + position).tolist()

    w = entry["beam_diameter"] / 2 * 1e3  # mm
    n = tr.x.shape[0]
    mid = n // 2
    rays = []
    for fan, line in (("x", [(mid, j) for j in range(n)]), ("y", [(i, mid) for i in range(n)])):
        cand = [(i, j) for i, j in line if tr.valid[i, j] and np.hypot(tr.x[i, j], tr.y[i, j]) <= w]
        if not cand:
            continue
        pick = [cand[int(round(k))] for k in np.linspace(0, len(cand) - 1, min(per_fan, len(cand)))]
        for i, j in pick:
            start = np.array([tr.x[i, j], tr.y[i, j], -2 * w])
            q1, q2, u = tr.Q1[i, j], tr.Q[i, j], tr.U[i, j]
            end = q2 + u * (P[2] - q2[2]) / u[2]
            rays.append(dict(fan=fan, weight=float(tr.E_in[i, j] ** 2), points=[lab(start), lab(q1), lab(q2), lab(end)]))
    Wv = np.where(tr.valid, lr.W / (entry["wavelength"] * 1e3), np.nan)
    wf = dict(x=(tr.x[0, :] * 1e-3).tolist(), y=(tr.y[:, 0] * 1e-3).tolist(),
              W=[[None if not np.isfinite(v) else float(v) for v in row] for row in Wv],
              weight=(tr.E_in**2 * tr.valid).tolist())
    return dict(rays=rays, wavefront=wf)


_MIRROR_BEAMS: dict = {}


def mirror_focus(b: dict) -> dict:
    """A beam field focused by a parabolic mirror (``focus.kind =
    "parabolic_mirror"``, :mod:`levtrap.mirror`): its beam about the focus,
    for 1 W in the input beam (its power is the fraction reflected), and the
    ``mirrors`` block of a Result for it."""
    from .mirror import focused_beam
    focus = b["focus"]
    key = json.dumps(dict(focus=focus, wl=b["wavelength"], pol=b["polarisation"]), sort_keys=True)
    hit = _MIRROR_BEAMS.get(key)
    if hit is None:
        if len(_MIRROR_BEAMS) > 16:
            _MIRROR_BEAMS.clear()
        r = focused_beam(float(focus["focal_length"]), float(focus["rim_radius"]), float(focus["beam_diameter"]) / 2,
                         float(b["wavelength"]), hole_radius=float(focus["hole_radius"]),
                         polarisation=_pol(b["polarisation"]))
        info = dict(reflected=float(r.reflected), clipping_loss=float(1 - r.reflected),
                    rim_angle_deg=math.degrees(r.alpha_rim), hole_angle_deg=math.degrees(r.alpha_hole),
                    deep=bool(r.alpha_rim > math.pi / 2), Nmax=int(r.beam.Nmax))
        hit = _MIRROR_BEAMS[key] = dict(beam=r.beam, info=info)
    return hit


def _lens_trap(req: dict, lens_req: dict, detail: bool, r_start=None):
    """Trap analysis for the beam behind the (tilted) lens.  Positions are
    relative to the best focus P* of that beam; the caller adds P*."""
    from .traps import equilibrium_3d
    wl = float(req["wavelength"])
    lr = _lens_beam(lens_req, wl)
    P = float(req.get("power", 0.1))
    beam = lr.beam * math.sqrt(P * lr.transmitted)  # coefficients in sqrt(W)
    T, n_p = _tmatrix(req["particle"], wl, 1.0)
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


# ---------------------------------------------------------------------------
# materials / benchmark
# ---------------------------------------------------------------------------


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
    """Dispatch by name, for the app's worker and local server."""
    from .solve import solve_json
    return {"solve": solve_json, "field3d": field3d, "lens_trap": lens_trap, "lens_sweep": lens_sweep,
            "materials": materials, "benchmark": benchmark}[method](*args)


