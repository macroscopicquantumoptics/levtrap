"""``solve(setup) -> result``: the one entry point of the engine.

See ``docs/ARCHITECTURE.md`` §4 (Setup) and §6 (Result).  Everything is SI.

The setup becomes a list of fields (:mod:`levtrap.fields`) and the generic
solver (:mod:`levtrap.solver`) finds the equilibrium, modes and depth of
their summed force.  Computed so far: one beam, or one coherent group of two
beams, travelling along +z with the focus at the origin, plus gravity.  Other
setups raise :class:`UnsupportedSetup` naming what is missing.
"""

from __future__ import annotations

import json
import time
from typing import Any, Iterable

import numpy as np

from . import __version__
from .materials import get_material
from .setup import SetupError, parse, unknown_keys

__all__ = ["solve", "solve_json", "check_supported", "resolve_particle", "UnsupportedSetup",
           "RESULT_VERSION", "WANTS"]

RESULT_VERSION = 1
WANTS = ("curves",)
SCAN_RANGES = (1.5e-6, 1.5e-6, 3e-6)  # half-widths [m] searched for the equilibrium (x, y, z)
SCAN_POINTS = 61


class UnsupportedSetup(NotImplementedError):
    """The setup is valid but this version of the engine cannot compute it yet."""


def check_supported(s: dict) -> None:
    """Raise :class:`UnsupportedSetup` unless this engine computes the parsed setup."""
    fields = s["trap"]["fields"]
    others = sorted({f["kind"] for f in fields if f["kind"] not in ("beam", "gravity")})
    if others:
        raise UnsupportedSetup(f"{', '.join(others)} fields are not computed yet")
    beams = [f for f in fields if f["kind"] == "beam"]
    if not beams:
        raise UnsupportedSetup("a setup without a beam is not computed yet")
    if len(beams) > 2:
        raise UnsupportedSetup("more than two beams are not computed yet")
    for i, b in enumerate(beams):
        dx, dy, dz = b["direction"]
        if dx or dy or dz <= 0:
            raise UnsupportedSetup(f"trap.fields[{i}].direction: only beams along +z are computed yet")
        if any(b["position"]):
            raise UnsupportedSetup(f"trap.fields[{i}].position: only a focus at the origin is computed yet")
    if len(beams) == 2:
        a, b = beams
        linked = (a["coherent_with"] is not None and a["coherent_with"] == b.get("id")) or \
                 (b["coherent_with"] is not None and b["coherent_with"] == a.get("id"))
        if not linked:
            raise UnsupportedSetup("two beams that are not coherent with each other are not computed yet")


def resolve_particle(s: dict) -> dict:
    """Fill the particle's missing n, k and density from its material at the
    beam wavelength (in place); returns the particle."""
    p = s["particle"]
    wl = next(f for f in s["trap"]["fields"] if f["kind"] == "beam")["wavelength"]
    if p["material"] is not None and (p["n"] is None or p["k"] is None or p["density"] is None):
        m = get_material(p["material"], wl)
        if not m["valid"] and p["n"] is None:
            raise SetupError("particle.material", f"no refractive-index data for {p['material']} at "
                                                  f"{wl * 1e9:.0f} nm; give n and k")
        for key in ("n", "k", "density"):
            if p[key] is None:
                p[key] = m[key]
    return p


def solve(setup: dict | str, want: Iterable[str] = ()) -> dict:
    """Compute the result of a setup.

    Parameters
    ----------
    setup : dict or JSON text, see :mod:`levtrap.setup`.
    want : extra blocks to compute, from :data:`WANTS`.  ``"curves"`` adds the
        force along x, y and z through the equilibrium.

    Returns
    -------
    dict (``json.dumps``-able):

    * ``stable`` — a restoring force along all three axes.
    * ``equilibrium`` — [x, y, z] in m, or ``None``.
    * ``modes`` — the three eigen-modes of the stiffness matrix: ``name``
      (the lab axis each is closest to), ``axis`` (unit vector),
      ``frequency`` [Hz], ``stiffness`` [N/m], ``depth`` [J] along that axis.
      ``frequency`` is ``None`` where the stiffness is not positive.
    * ``depth`` — the smallest of the three, as ``J``, ``K`` and ``kT`` (at
      the environment temperature); zero when not stable.
    * ``particle`` — resolved ``n``, ``k``, ``density`` and ``mass`` [kg].
    * ``optical`` — scattered and absorbed power [W] at the equilibrium, and
      the plane-wave Mie efficiencies.
    * ``models``, ``warnings`` — what was used and what to be careful about.
    """
    # late imports: api and the fields pull in the whole engine
    from .api import build_beam, build_tmatrix
    from .derived import KB, mie_efficiencies, sphere_mass
    from .fields import GravityField, OpticalField, total_force
    from .solver import find_trap

    t0 = time.perf_counter()
    want = tuple(want)
    bad = [w for w in want if w not in WANTS]
    if bad:
        raise SetupError("want", f"unknown block {bad[0]!r}; choose from {', '.join(WANTS)}")
    raw = json.loads(setup) if isinstance(setup, str) else setup
    s = parse(raw)
    warnings = [f"{path}: unknown key, ignored" for path in unknown_keys(raw)]
    check_supported(s)
    p = resolve_particle(s)
    env = s["environment"]
    nm, temp = float(env["medium_index"]), float(env["temperature"])
    mass = sphere_mass(float(p["radius"]), float(p["density"]))

    beams = [f for f in s["trap"]["fields"] if f["kind"] == "beam"]
    optical_setup = dict(s, trap=dict(fields=beams))
    beam, P = build_beam(optical_setup)
    T, n_p = build_tmatrix(optical_setup)
    optical = OpticalField(beam, T, nm)
    fields = [optical] + [GravityField(mass, f["g"]) for f in s["trap"]["fields"] if f["kind"] == "gravity"]

    trap = find_trap(fields, mass, ranges=SCAN_RANGES, points=SCAN_POINTS)
    warnings += trap.warnings
    r_eq = trap.equilibrium
    if r_eq is None:
        warnings.append("No stable trap: the force along the beam axis (z) never restores the particle.")
    elif not trap.stable:
        loose = [m["name"] for m in trap.modes if m["stiffness"] <= 0]
        warnings.append("No stable trap: the particle is pushed away along " + ", ".join(loose) + ".")
    modes = [dict(name=m["name"], axis=[float(v) for v in m["axis"]], frequency=m["frequency"],
                  stiffness=m["stiffness"], depth=m["depth"]) for m in trap.modes]
    U = min(m["depth"] for m in trap.modes) if trap.stable else 0.0

    wl = beams[0]["wavelength"]
    eff = mie_efficiencies(float(p["radius"]), wl, n_p, nm)
    sc = optical.scattering(r_eq if r_eq is not None else np.zeros(3))
    result: dict[str, Any] = dict(
        version=RESULT_VERSION,
        engine=__version__,
        stable=trap.stable,
        equilibrium=None if r_eq is None else [float(v) for v in r_eq],
        modes=modes,
        depth=dict(J=U, K=U / KB, kT=U / (KB * temp)),
        particle=dict(n=p["n"], k=p["k"], density=p["density"], mass=mass),
        optical=dict(P_sca=sc["P_sca"], P_abs=sc["P_abs"], power=P,
                     Qext=eff["Qext"], Qsca=eff["Qsca"], Qabs=eff["Qabs"],
                     size_parameter=eff["x"], Nmax=dict(beam=beam.Nmax, particle=T.Nmax[0])),
        models=[dict(quantity="modes", model="mie", validity="ok", notes=[]),
                dict(quantity="optical", model="mie", validity="ok", notes=[])],
        warnings=warnings,
    )
    if "curves" in want:
        centre = r_eq if r_eq is not None else np.zeros(3)
        result["curves"] = {}
        for j, name in enumerate("xyz"):
            ss = np.linspace(-SCAN_RANGES[j], SCAN_RANGES[j], SCAN_POINTS)
            line = np.tile(centre, (SCAN_POINTS, 1))
            line[:, j] += ss
            result["curves"][name] = dict(position=(centre[j] + ss).tolist(),
                                          force=total_force(fields, line)[:, j].tolist())
    result["time"] = time.perf_counter() - t0
    return result


def solve_json(setup_json: str, want_json: str = "[]") -> str:
    """JSON wrapper for the web worker: ``{"ok": true, "result": …}`` or
    ``{"ok": false, "error": …, "kind": "setup" | "unsupported" | "internal", "path": …}``."""
    try:
        return json.dumps(dict(ok=True, result=solve(setup_json, json.loads(want_json))))
    except SetupError as exc:
        return json.dumps(dict(ok=False, kind="setup", path=exc.path, error=exc.message))
    except UnsupportedSetup as exc:
        return json.dumps(dict(ok=False, kind="unsupported", error=str(exc)))
    except Exception as exc:  # report to the UI rather than crash the worker
        return json.dumps(dict(ok=False, kind="internal", error=f"{type(exc).__name__}: {exc}"))
