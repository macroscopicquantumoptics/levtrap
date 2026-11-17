"""``solve(setup) -> result``: the one entry point of the engine.

See ``docs/ARCHITECTURE.md`` §4 (Setup) and §6 (Result).  Everything is SI.

The setup becomes a list of fields (:mod:`levtrap.fields`) and the generic
solver (:mod:`levtrap.solver`) finds the equilibrium, modes and depth of
their summed force.  Computed: any number of beams in any direction with
any focus position (:mod:`levtrap.optics`: incoherent beams add their
forces, coherent groups interfere), a Paul trap, both together (a hybrid
trap, with a per-field breakdown), and gravity with any of them.  More than
one Paul trap raises :class:`UnsupportedSetup`.
"""

from __future__ import annotations

import json
import math
import time
from typing import Any, Iterable

import numpy as np

from . import __version__
from .materials import get_material
from .rates import rates_block
from .setup import SetupError, parse, unknown_keys

__all__ = ["solve", "solve_json", "check_supported", "check_simple", "scan_box", "resolve_particle", "UnsupportedSetup",
           "RESULT_VERSION", "WANTS", "pattern_result"]

RESULT_VERSION = 1
WANTS = ("curves", "pattern")
SCAN_RANGES = (1.5e-6, 1.5e-6, 3e-6)  # half-widths [m] searched for the equilibrium (x, y, z)
SCAN_POINTS = 61


class UnsupportedSetup(NotImplementedError):
    """The setup is valid but this version of the engine cannot compute it yet."""


def check_supported(s: dict) -> None:
    """Raise :class:`UnsupportedSetup` unless this engine computes the parsed setup."""
    fields = s["trap"]["fields"]
    others = sorted({f["kind"] for f in fields if f["kind"] not in ("beam", "gravity", "paul")})
    if others:
        raise UnsupportedSetup(f"{', '.join(others)} fields are not computed yet")
    beams = [f for f in fields if f["kind"] == "beam"]
    pauls = [f for f in fields if f["kind"] == "paul"]
    if len(pauls) > 1:
        raise UnsupportedSetup("more than one Paul trap is not computed yet")
    if not beams and not pauls:
        raise UnsupportedSetup("a setup without a beam or a Paul trap does not trap")
    if not beams:
        return
    wl = {b["wavelength"] for b in beams}
    if len(wl) > 1 and s["particle"]["material"] is None:
        # one n, k given by hand cannot hold at two wavelengths
        raise UnsupportedSetup("beams of different wavelengths need a particle material "
                               "(a hand-given n and k hold at one wavelength)")


def check_simple(s: dict) -> None:
    """The original engine's limits, still those of :mod:`levtrap.api` (the
    current web page): one beam, or two coherent beams, along +z with the
    focus at the origin."""
    check_supported(s)
    fields = s["trap"]["fields"]
    if any(f["kind"] == "paul" for f in fields):
        raise UnsupportedSetup("paul fields are not computed by this page")
    beams = [f for f in fields if f["kind"] == "beam"]
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


def scan_box(beams: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Centre and half-widths [m] of the region searched for the equilibrium:
    around the mean of the foci, 3 um along each beam's axis and 1.5 um across
    it, plus the spread of the foci."""
    pos = np.array([b["position"] for b in beams], dtype=float)
    centre = pos.mean(axis=0)
    ranges = np.array(SCAN_RANGES[:2] + (SCAN_RANGES[0],), dtype=float)
    for b in beams:
        d = np.abs(np.asarray(b["direction"], dtype=float))
        d = d / np.linalg.norm(d)
        ranges = np.maximum(ranges, SCAN_RANGES[0] + (SCAN_RANGES[2] - SCAN_RANGES[0]) * d)
    ranges = ranges + np.abs(pos - centre).max(axis=0)
    return centre, ranges


def resolve_particle(s: dict) -> dict:
    """Fill the particle's missing n, k and density from its material at the
    beam wavelength (in place); returns the particle.  Without a beam only the
    density is needed and taken from the material."""
    p = s["particle"]
    beam = next((f for f in s["trap"]["fields"] if f["kind"] == "beam"), None)
    if beam is None:
        if p["density"] is None:
            p["density"] = get_material(p["material"], 1.064e-6)["density"]
        return p
    wl = beam["wavelength"]
    if p["material"] is not None and (p["n"] is None or p["k"] is None or p["density"] is None):
        m = get_material(p["material"], wl)
        if not m["valid"] and p["n"] is None:
            raise SetupError("particle.material", f"no refractive-index data for {p['material']} at "
                                                  f"{wl * 1e9:.0f} nm; give n and k")
        for key in ("n", "k", "density"):
            if p[key] is None:
                p[key] = m[key]
    return p


def _particle_at(given: dict, wavelength: float) -> dict:
    """The particle (as given in the setup) with n, k and density at a wavelength."""
    p = dict(given)
    if p["material"] is not None and (p["n"] is None or p["k"] is None or p["density"] is None):
        m = get_material(p["material"], wavelength)
        if not m["valid"] and p["n"] is None:
            raise SetupError("particle.material", f"no refractive-index data for {p['material']} at "
                                                  f"{wavelength * 1e9:.0f} nm; give n and k")
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
        force along x, y and z through the equilibrium; ``"pattern"`` adds the
        radiation pattern at the equilibrium (:func:`pattern_result`).

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
    * ``paul`` — for a Paul trap: Mathieu ``a`` and ``q`` per axis, the
      ``secular`` frequencies [Hz] (``pseudopotential`` and ``exact``),
      ``stable`` (every axis in the first stability region) and the
      ``micromotion`` amplitude [m] per axis at the equilibrium.  ``optical``
      and ``rates`` are ``None`` for a trap without light.
    * ``breakdown`` — hybrid traps (beam + Paul trap) only: per field (a
      coherent group of beams counts as one), its ``force`` [N] and its
      ``stiffness`` [N/m] along each mode axis at the equilibrium; the shares
      add up to the trap's.
    * ``rates`` — gas damping [1/s], and per mode the gas, recoil and total
      reheating [phonons/s], Q, coherence time [s], coherent oscillations and
      the pressure [Pa] where recoil equals gas heating (:mod:`levtrap.rates`).
    * ``models``, ``warnings`` — what was used and what to be careful about.
    """
    # late imports: api and the fields pull in the whole engine
    from .api import _single_beam, _tmatrix
    from .derived import KB, mie_efficiencies, sphere_mass
    from .fields import GravityField
    from .optics import is_simple, optical_fields
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
    given = dict(s["particle"])  # before the material fills n, k: other wavelengths need it
    p = resolve_particle(s)
    env = s["environment"]
    nm, temp = float(env["medium_index"]), float(env["temperature"])
    mass = sphere_mass(float(p["radius"]), float(p["density"]))

    beams = [f for f in s["trap"]["fields"] if f["kind"] == "beam"]
    gravity = [GravityField(mass, f["g"]) for f in s["trap"]["fields"] if f["kind"] == "gravity"]
    paul_setup = next((f for f in s["trap"]["fields"] if f["kind"] == "paul"), None)
    if paul_setup is not None and not beams:
        return _solve_paul(s, paul_setup, gravity, mass, p, warnings, want, t0)
    optical = optical_fields(s, _single_beam, lambda wl: _tmatrix(_particle_at(given, wl), wl, nm)[0])
    paul = None
    if paul_setup is not None:
        from .fields.paul import E_CHARGE, PaulField
        paul = PaulField(paul_setup, float(p["charge"]) * E_CHARGE, mass)
    fields = optical + ([paul] if paul else []) + gravity
    P = sum(float(b["power"]) for b in beams)
    n_p = complex(float(p["n"]), float(p["k"] or 0.0))
    centre, ranges = scan_box(beams)
    along_z = all(b["direction"][0] == 0 and b["direction"][1] == 0 for b in beams)

    trap = find_trap(fields, mass, centre=centre, ranges=ranges, points=SCAN_POINTS)
    if paul is not None and not trap.stable:
        trap = _hybrid_wide_search(fields, mass, paul, trap, ranges)
        if trap.equilibrium is not None:
            centre = trap.equilibrium
    warnings += trap.warnings
    r_eq = trap.equilibrium
    if r_eq is None:
        warnings.append("No stable trap: the force along the beam axis (z) never restores the particle."
                        if along_z else
                        "No stable trap: nowhere in the searched region does the force vanish and pull the "
                        "particle back.")
    elif not trap.stable:
        loose = [m["name"] for m in trap.modes if m["stiffness"] <= 0]
        warnings.append("No stable trap: the particle is pushed away along " + ", ".join(loose) + ".")
    modes = [dict(name=m["name"], axis=[float(v) for v in m["axis"]], frequency=m["frequency"],
                  stiffness=m["stiffness"], depth=m["depth"]) for m in trap.modes]
    U = min(m["depth"] for m in trap.modes) if trap.stable else 0.0

    wl = beams[0]["wavelength"]
    eff = mie_efficiencies(float(p["radius"]), wl, n_p, nm)
    at = r_eq if r_eq is not None else centre
    parts = [f.scattering(at) for f in optical]
    sc = dict(P_sca=sum(x["P_sca"] for x in parts), P_abs=sum(x["P_abs"] for x in parts))
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
                     size_parameter=eff["x"],
                     Nmax=dict(beam=max(f.beam.Nmax for f in optical), particle=optical[0].T.Nmax[0])),
        models=[dict(quantity="modes", model="mie", validity="ok", notes=[]),
                dict(quantity="optical", model="mie", validity="ok", notes=[])],
        warnings=warnings,
    )
    q = eff["Qsca_multipoles"]
    rates, rate_models = rates_block(s, modes=modes, mass=mass, P_sca=sc["P_sca"], P_abs=sc["P_abs"],
                                     ed_fraction=q["ED"] / eff["Qsca"] if eff["Qsca"] > 0 else None)
    result["rates"] = rates
    result["models"] += rate_models
    if paul is not None:
        _add_hybrid(result, s, paul, fields, trap, mass, temp, warnings)
    if "curves" in want:
        result["curves"] = _curves(fields, at, ranges, SCAN_POINTS)
    if "pattern" in want:
        if len(optical) > 1 or not is_simple(beams):
            raise UnsupportedSetup("the radiation pattern is computed only for beams along +z "
                                   "through one focus that interfere")
        result["pattern"] = pattern_result(s, r_eq if r_eq is not None else np.zeros(3))
        result["models"].append(dict(quantity="pattern", model="mie", validity="ok", notes=[]))
        if r_eq is None:
            result["warnings"].append("Radiation pattern taken with the particle at the focus "
                                      "(there is no equilibrium).")
    result["time"] = time.perf_counter() - t0
    return result


def _hybrid_wide_search(fields, mass, paul, near, optical_ranges):
    """Second, two-scale search for a hybrid trap when none was found near the
    optical focus: scan the Paul trap's own region (r0, r0, z0 around its
    centre) at its own length scale, then refine on the optical scale around
    what was found.  Returns the better of the two searches."""
    from .solver import find_trap
    wide = find_trap(fields, mass, centre=np.zeros(3), ranges=(paul.r0, paul.r0, paul.z0),
                     points=SCAN_POINTS, length_scale=paul.length_scale / 100)
    if wide.equilibrium is None:
        return near
    fine = find_trap(fields, mass, centre=wide.equilibrium, ranges=optical_ranges, points=SCAN_POINTS)
    if fine.converged and (fine.stable or not near.converged):
        return fine
    return near if near.converged else wide


def _add_hybrid(result, s, paul, fields, trap, mass, temp, warnings) -> None:
    """Hybrid trap: the ``paul`` block, the per-field ``breakdown`` at the
    equilibrium and the excess-micromotion warning (in place)."""
    from .derived import KB
    from .solver import stiffness

    sec = paul.secular()
    model = paul.model()
    r_eq = trap.equilibrium
    result["particle"]["charge"] = s["particle"]["charge"]
    result["paul"] = dict(a=sec["a"], q=sec["q"], stable=sec["all_stable"],
                          secular=dict(pseudopotential=sec["pseudopotential"], exact=sec["exact"]),
                          micromotion=paul.micromotion(r_eq) if r_eq is not None else None)
    result["models"].append(dict(quantity="paul", **model.as_dict()))
    warnings += model.notes

    # which setup fields each solver field stands for
    setup_fields = s["trap"]["fields"]
    beam_idx = [i for i, f in enumerate(setup_fields) if f["kind"] == "beam"]
    from .optics import coherent_groups
    groups = [[beam_idx[j] for j in g] for g in coherent_groups([setup_fields[i] for i in beam_idx])]
    labels = ([dict(kind="beam", fields=g) for g in groups]
              + [dict(kind="paul", fields=[i for i, f in enumerate(setup_fields) if f["kind"] == "paul"])]
              + [dict(kind="gravity", fields=[i]) for i, f in enumerate(setup_fields) if f["kind"] == "gravity"])
    if r_eq is not None:
        h = min(f.length_scale for f in fields if f.length_scale) / 200
        breakdown = []
        for f, lab in zip(fields, labels):
            K, F = stiffness([f], r_eq, h)
            Ks = 0.5 * (K + K.T)
            breakdown.append(dict(**lab, force=[float(v) for v in F],
                                  stiffness={m["name"]: float(np.asarray(m["axis"]) @ Ks @ np.asarray(m["axis"]))
                                             for m in result["modes"]}))
        result["breakdown"] = breakdown

    # an optical focus off the RF null drags the particle into micromotion
    w2 = paul.omega2_pseudo
    foci = np.array([setup_fields[i]["position"] for i in beam_idx], dtype=float)
    focus = foci.mean(axis=0)
    off = []
    for i, ax in enumerate("xyz"):
        if w2[i] > 0:
            sigma = math.sqrt(KB * temp / (mass * w2[i]))
            if abs(focus[i]) > sigma:
                off.append(f"{ax} by {abs(focus[i]) * 1e6:.3g} um (thermal extent {sigma * 1e6:.3g} um)")
    if off:
        warnings.append("The optical focus is displaced from the Paul trap centre along " + "; ".join(off)
                        + ": expect excess micromotion.")


def _curves(fields, centre, ranges, points) -> dict:
    """Force cuts along x, y, z through ``centre``: the ``curves`` block."""
    from .fields import total_force
    out = {}
    for j, name in enumerate("xyz"):
        ss = np.linspace(-ranges[j], ranges[j], points)
        line = np.tile(centre, (points, 1))
        line[:, j] += ss
        out[name] = dict(position=(centre[j] + ss).tolist(), force=total_force(fields, line)[:, j].tolist())
    return out


def _solve_paul(s, f, gravity, mass, p, warnings, want, t0) -> dict:
    """Paul trap (plus gravity): see :mod:`levtrap.fields.paul`."""
    from .derived import KB
    from .fields.paul import E_CHARGE, PaulField
    from .solver import find_trap

    bad = [w for w in want if w != "curves"]
    if bad:
        raise UnsupportedSetup(f"{bad[0]} needs a beam; a Paul trap alone has no light")
    temp = float(s["environment"]["temperature"])
    paul = PaulField(f, float(p["charge"]) * E_CHARGE, mass)
    sec = paul.secular()
    model = paul.model()
    fields = [paul] + gravity
    ranges = (paul.r0, paul.r0, paul.z0)
    trap = find_trap(fields, mass, ranges=ranges, points=SCAN_POINTS)
    warnings += trap.warnings + model.notes
    r_eq = trap.equilibrium
    unstable = [ax for ax, ok in sec["stable"].items() if not ok]
    if unstable:
        warnings.append("No stable trap: outside the first Mathieu stability region along "
                        + ", ".join(unstable) + ".")
    elif r_eq is None:
        warnings.append("No stable trap: the Paul trap does not confine the particle here.")
    elif not trap.stable:
        loose = [m["name"] for m in trap.modes if m["stiffness"] <= 0]
        warnings.append("No stable trap: the particle is pushed away along " + ", ".join(loose) + ".")
    stable = bool(trap.stable and not unstable)

    use_exact = model.name == "mathieu"
    modes = []
    for m in trap.modes:
        freq, k = m["frequency"], m["stiffness"]
        aligned = max(abs(v) for v in m["axis"]) > 1 - 1e-9
        if use_exact and aligned and sec["exact"].get(m["name"]) is not None:
            freq = sec["exact"][m["name"]]
            k = mass * (2 * math.pi * freq) ** 2
        modes.append(dict(name=m["name"], axis=[float(v) for v in m["axis"]], frequency=freq,
                          stiffness=k, depth=m["depth"]))
    U = min(m["depth"] for m in modes) if stable else 0.0
    result: dict[str, Any] = dict(
        version=RESULT_VERSION,
        engine=__version__,
        stable=stable,
        equilibrium=None if r_eq is None else [float(v) for v in r_eq],
        modes=modes,
        depth=dict(J=U, K=U / KB, kT=U / (KB * temp)),
        particle=dict(n=p["n"], k=p["k"], density=p["density"], mass=mass, charge=p["charge"]),
        optical=None,
        paul=dict(a=sec["a"], q=sec["q"], stable=sec["all_stable"],
                  secular=dict(pseudopotential=sec["pseudopotential"], exact=sec["exact"]),
                  micromotion=paul.micromotion(r_eq) if r_eq is not None else None),
        rates=None,
        models=[dict(quantity="modes", **model.as_dict())],
        warnings=warnings,
    )
    if "curves" in want:
        result["curves"] = _curves(fields, r_eq if r_eq is not None else np.zeros(3), ranges, SCAN_POINTS)
    result["time"] = time.perf_counter() - t0
    return result


def pattern_result(s: dict, r) -> dict:
    """``pattern`` block (see :func:`levtrap.pattern.pattern_block`) for the
    particle at r = [x, y, z] [m] in the beams of a parsed, resolved setup.

    ``trap_NA`` is the numerical aperture of the first beam's focusing optic
    (``n_medium sin(convergence angle)``): the cone a backward detector
    through the trapping lens collects.
    """
    from .api import _beam_angle, build_beam, build_tmatrix
    from .pattern import pattern_block

    beams = [f for f in s["trap"]["fields"] if f["kind"] == "beam"]
    optical_setup = dict(s, trap=dict(fields=beams))
    beam, _ = build_beam(optical_setup)
    T, _ = build_tmatrix(optical_setup)
    nm = float(s["environment"]["medium_index"])
    b0 = beams[0]
    m = [int(v) for v in b0["mode"]["indices"]]
    order = (2 * m[0] + abs(m[1])) if b0["mode"]["type"] == "lg" else (m[0] + m[1])
    angle = _beam_angle(b0["focus"], float(b0["wavelength"]), nm, order)
    r = np.asarray(r, dtype=float)
    ref = beam.translate_xyz(r) if np.any(r != 0) else beam
    return pattern_block(ref, T, n_medium=nm, trap_NA=nm * math.sin(angle))


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
