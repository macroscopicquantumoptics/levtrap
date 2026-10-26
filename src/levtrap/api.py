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

__all__ = ["compute", "sweep", "presets", "materials", "benchmark", "handle"]

DEFAULT_SCAN = dict(z_range=3e-6, z_points=61, x_range=1.5e-6, x_points=41,
                    map_nx=13, map_nz=17, intensity_n=60)

_BEAM_CACHE: dict = {}


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
        XX, ZZ = np.meshgrid(ix, iz)
        pts = np.stack([XX.ravel(), 0 * XX.ravel(), ZZ.ravel()], axis=1)
        E = beam.em_field_xyz(pts)
        I = 4 * beam.k_medium**2 * np.sum(np.abs(E) ** 2, axis=1).reshape(XX.shape)  # W/m^2 (beam.power = P)
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
    return {"compute": compute, "sweep": sweep, "presets": presets,
            "materials": materials, "benchmark": benchmark}[method](*args)


