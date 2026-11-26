"""``solve(setup) -> result``: the one entry point of the engine.

See ``docs/ARCHITECTURE.md`` §4 (Setup) and §6 (Result).  Everything is SI.

The setup becomes a list of fields (:mod:`levtrap.fields`) and the generic
solver (:mod:`levtrap.solver`) finds the equilibrium, modes and depth of
their summed force.  Computed: any number of beams in any direction with
any focus position (:mod:`levtrap.optics`: incoherent beams add their
forces, coherent groups interfere), a Paul trap, and gravity with either.
A Paul trap together with a beam (B3) raises :class:`UnsupportedSetup`.
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
WANTS = ("curves", "dipole", "pattern", "field", "lens")
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
    for i, b in enumerate(beams):
        optic = {"asphere": "an asphere", "parabolic_mirror": "a parabolic mirror"}.get(b["focus"]["kind"])
        if optic:
            if s["environment"]["medium_index"] != 1:
                raise UnsupportedSetup(f"a beam focused by {optic} is computed in vacuum or a gas (medium index 1)")
            if b["mode"]["type"] != "lg" or list(b["mode"]["indices"]) != [0, 0]:
                raise UnsupportedSetup(f"{optic} is computed for a Gaussian beam (mode LG 0 0)")
    if pauls:
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


def solve(setup: dict | str, want: Iterable[str] = (), start=None) -> dict:
    """Compute the result of a setup.

    Parameters
    ----------
    setup : dict or JSON text, see :mod:`levtrap.setup`.
    start : a lab position [m] to follow the equilibrium from (continuation,
        as a sweep does): the search starts there, and the result's
        ``followed`` block says whether the trap stayed (``jumped`` false) or
        the followed equilibrium vanished and the trap was searched afresh.
        A Paul trap alone ignores it.
    want : extra blocks to compute, from :data:`WANTS`.  ``"curves"`` adds the
        force along each eigen-axis of the trap through the equilibrium
        (:func:`_curves`); ``"dipole"`` adds to each curve the same force with
        the light in the dipole approximation (implies ``"curves"``);
        ``"pattern"`` adds the radiation pattern at the equilibrium
        (:func:`pattern_result`).

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
    * ``rates`` — gas damping [1/s], and per mode the gas, recoil and total
      reheating [phonons/s], Q, coherence time [s], coherent oscillations and
      the pressure [Pa] where recoil equals gas heating (:mod:`levtrap.rates`).
    * ``coherent`` — for each coherent pair of beams (only when there is
      one): its ``fields``, the ``dark_split`` (fraction of the pair's power
      in the second beam that darkens the first beam's focus) and the
      ``residual`` brightness there (:func:`_coherent_pairs`, #79).
    * ``models``, ``warnings`` — what was used and what to be careful about.
    """
    # late imports: api and the fields pull in the whole engine
    from .api import _single_beam, _tmatrix
    from .derived import KB, mie_efficiencies, sphere_mass
    from .fields import GravityField
    from .optics import optical_fields
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
    if paul_setup is not None and not any(float(b["power"]) > 0 for b in beams):
        # a beam without power exerts no force: this is the Paul trap alone
        return _solve_paul(s, paul_setup, gravity, mass, p, warnings, want, t0)
    # a beam focused by a real lens (E1): its field is about the lens's best focus P*, which a tilt or a
    # decentre moves away from the beam's position (the focus of the aligned lens)
    lensed = _place_aspheres(s)
    mirrored = _mirrors(s)
    beams = [f for f in s["trap"]["fields"] if f["kind"] == "beam"]

    def unit_beam(b, n_medium):
        if id(b) in lensed:
            return lensed[id(b)]["beam"]
        if id(b) in mirrored:
            return mirrored[id(b)]["beam"]
        return _single_beam(b, n_medium)

    optical = optical_fields(s, unit_beam, lambda wl: _tmatrix(_particle_at(given, wl), wl, nm)[0])
    paul = None
    if paul_setup is not None:
        from .fields.paul import E_CHARGE, PaulField
        paul = PaulField(paul_setup, float(p["charge"]) * E_CHARGE, mass)
    fields = optical + ([paul] if paul else []) + gravity
    P = sum(float(b["power"]) for b in beams)
    n_p = complex(float(p["n"]), float(p["k"] or 0.0))
    centre, ranges = scan_box(beams)
    along_z = all(b["direction"][0] == 0 and b["direction"][1] == 0 for b in beams)

    trap = find_trap(fields, mass, centre=centre, ranges=ranges, points=SCAN_POINTS, start=start)
    if paul is not None and not trap.stable:
        # Two scales: the optical focus (um) was searched first. Now scan the
        # electrodes (mm) for a seed, and search a box of the optical size
        # around it (Newton steps are limited to the optical scale).
        from .solver import _seed
        box = np.array([paul.r0, paul.r0, paul.z0])
        seed = _seed(fields, np.zeros(3), box, SCAN_POINTS)
        if seed is not None:
            fine = np.maximum(ranges, 2 * box / (SCAN_POINTS - 1))
            wide = find_trap(fields, mass, centre=seed, ranges=fine, points=SCAN_POINTS)
            if wide.stable or trap.equilibrium is None:
                trap, centre, ranges = wide, seed, fine
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
    stable = trap.stable
    paul_block = paul_model = None
    if paul is not None:
        stable, paul_block, paul_model = _hybrid_paul(paul, fields, trap, modes, mass, temp, warnings)
    U = min(m["depth"] for m in modes) if stable else 0.0

    wl = beams[0]["wavelength"]
    eff = mie_efficiencies(float(p["radius"]), wl, n_p, nm)
    at = r_eq if r_eq is not None else centre
    parts = [f.scattering(at) for f in optical]
    sc = dict(P_sca=sum(x["P_sca"] for x in parts), P_abs=sum(x["P_abs"] for x in parts))
    # the scattered power per multipole for these beams at the equilibrium (#80): the fields
    # are incoherent with each other, so their splits add
    split = {k: sum(x["P_sca_multipoles"][k] for x in parts) for k in parts[0]["P_sca_multipoles"]}
    result: dict[str, Any] = dict(
        version=RESULT_VERSION,
        engine=__version__,
        stable=stable,
        equilibrium=None if r_eq is None else [float(v) for v in r_eq],
        modes=modes,
        depth=dict(J=U, K=U / KB, kT=U / (KB * temp)),
        particle=dict(n=p["n"], k=p["k"], density=p["density"], mass=mass, charge=p["charge"]),
        optical=dict(P_sca=sc["P_sca"], P_abs=sc["P_abs"], power=P,
                     Qext=eff["Qext"], Qsca=eff["Qsca"], Qabs=eff["Qabs"],
                     size_parameter=eff["x"],
                     # plane-wave Q_sca per multipole (Mie), and the beams' own split of P_sca (#80)
                     Qsca_multipoles=eff["Qsca_multipoles"], P_sca_multipoles=split,
                     Nmax=dict(beam=max(f.beam.Nmax for f in optical), particle=optical[0].T.Nmax[0])),
        models=[dict(quantity="modes", **paul_model.as_dict()) if paul_model else
                dict(quantity="modes", model="mie", validity="ok", notes=[]),
                dict(quantity="optical", model="mie", validity="ok", notes=[])],
        warnings=warnings,
    )
    if paul_block is not None:
        result["paul"] = paul_block
    pairs = _coherent_pairs(s, unit_beam)
    if pairs:
        result["coherent"] = pairs
    if start is not None:
        result["followed"] = dict(start=[float(v) for v in start], jumped=bool(trap.jumped))
    if r_eq is not None:
        result["breakdown"] = breakdown(s, fields, optical, paul, r_eq, modes, trap)
    q = eff["Qsca_multipoles"]
    rates, rate_models = rates_block(s, modes=modes, mass=mass, P_sca=sc["P_sca"], P_abs=sc["P_abs"],
                                     ed_fraction=q["ED"] / eff["Qsca"] if eff["Qsca"] > 0 else None,
                                     scattering=_recoil_parts(beams, parts))
    result["rates"] = rates
    result["models"] += rate_models
    if "curves" in want or "dipole" in want:
        radius = float(p["radius"])

        def dipole(line):
            return sum((f.dipole_force(line, radius) if f in optical else f.force(line)) for f in fields)

        result["curves"] = _curves(fields, at, ranges, SCAN_POINTS, modes, dipole if "dipole" in want else None)
    if "field" in want:
        result["field"] = _field_block(optical, at, ranges)
    if "pattern" in want:
        if lensed or mirrored:
            raise UnsupportedSetup("the radiation pattern is not computed yet for a beam focused by an asphere "
                                   "or a parabolic mirror")
        result["pattern"] = pattern_result(s, r_eq if r_eq is not None else np.zeros(3), optical)
        result["models"].append(dict(quantity="pattern", model="mie", validity="ok", notes=[]))
        if r_eq is None:
            result["warnings"].append("Radiation pattern taken with the particle at the focus "
                                      "(there is no equilibrium).")
    if mirrored:
        result["mirrors"] = [dict(field=e["index"], **e["info"]) for e in sorted(mirrored.values(), key=lambda e: e["index"])]
        result["models"].append(dict(quantity="mirror", model="paraboloid far field", validity="ok",
                                     notes=["geometric optics on the mirror; far field projected on VSWFs"]))
    if lensed:
        result["lenses"] = _lens_block(s, lensed, modes, detail="lens" in want)
        result["models"].append(dict(quantity="lens", model="ray-trace", validity="ok",
                                     notes=["Thorlabs 354330-C, Zemax prescription; far field projected on VSWFs"]))
    result["time"] = time.perf_counter() - t0
    return result


def _coherent_pairs(s: dict, unit_beam) -> list[dict]:
    """Per coherent pair of beams, the power split that darkens the focus (#79).

    ``fields`` are the pair's indices into ``trap.fields`` (in setup order);
    ``dark_split`` the fraction of the pair's total power in the second beam
    that nulls the field at the first beam's focus when the two are
    antiparallel there, and ``residual`` the |E|^2 left at that split over
    the two beams' intensities added (:func:`levtrap.optics.dark_split`).
    Groups of three or more beams have no single split and are left out.
    """
    from .optics import coherent_groups, dark_split

    nm = float(s["environment"]["medium_index"])
    fields = s["trap"]["fields"]
    index = [i for i, f in enumerate(fields) if f["kind"] == "beam"]
    beams = [fields[i] for i in index]
    out = []
    for group in coherent_groups(beams):
        if len(group) != 2:
            continue
        specs = [beams[i] for i in group]
        d = dark_split(specs, [unit_beam(b, nm) for b in specs])
        out.append(dict(fields=[index[i] for i in group],
                        dark_split=None if d is None else d["split"],
                        residual=None if d is None else d["residual"]))
    return out


def _recoil_parts(beams: list[dict], parts: list[dict]) -> list[dict] | None:
    """Per optical field, its Mie scattered pattern at the equilibrium and the
    beams whose photons it scatters (direction, power weight), for
    :func:`levtrap.rates.rates_block` (#78). ``None`` (the dipole fallback)
    when a field has no pattern (it scatters nothing)."""
    from .optics import coherent_groups
    groups = coherent_groups(beams)
    if len(groups) != len(parts) or any("second" not in p for p in parts):
        return None
    out = []
    for group, p in zip(groups, parts):
        w = np.array([max(float(beams[i]["power"]), 0.0) for i in group])
        w = w / w.sum() if w.sum() > 0 else np.full(len(group), 1 / len(group))
        out.append(dict(P_sca=p["P_sca"], mean=p["mean"], second=p["second"],
                        beams=[(beams[i]["direction"], float(wi)) for i, wi in zip(group, w)]))
    return out


def _mirrors(s: dict) -> dict:
    """For each beam focused by a parabolic mirror: the mirror's beam (about
    the focus, the beam's position) and its numbers, by ``id`` of the beam's dict."""
    from .api import mirror_focus
    out = {}
    for i, f in enumerate(s["trap"]["fields"]):
        if f["kind"] == "beam" and f["focus"]["kind"] == "parabolic_mirror":
            out[id(f)] = dict(mirror_focus(f), index=i)
    return out


def _place_aspheres(s: dict) -> dict:
    """For each beam focused by a real lens: move its ``position`` to the lens's
    best focus (in place, on the parsed copy) and keep the lens's beam and
    numbers, by ``id`` of the beam's dict."""
    from .api import asphere_focus
    from .optics import beam_rotation
    out = {}
    for i, f in enumerate(s["trap"]["fields"]):
        if f["kind"] != "beam" or f["focus"]["kind"] != "asphere":
            continue
        a = asphere_focus(f)
        R = beam_rotation(f["direction"])
        shift = R @ a["offset"]
        f["position"] = [float(v) for v in np.asarray(f["position"], dtype=float) + shift]
        out[id(f)] = dict(a, index=i, shift=shift, direction=np.asarray(f["direction"], dtype=float))
    return out


def _lens_block(s: dict, lensed: dict, modes: list[dict], detail: bool = False) -> list[dict]:
    """The ``lenses`` block: per beam focused by a real lens, where the focus
    went, the light lost on the lens, and how far the trap's axis tilts; with
    ``detail`` (``want=["lens"]``) also its traced ``rays`` and ``wavefront``
    (:func:`levtrap.api.lens_detail`)."""
    from .api import lens_detail
    from .optics import beam_rotation
    out = []
    for entry in sorted(lensed.values(), key=lambda e: e["index"]):
        d = entry["direction"] / np.linalg.norm(entry["direction"])
        # the trap axis: the mode most nearly along the beam
        axial = max(modes, key=lambda m: abs(float(np.dot(m["axis"], d))), default=None)
        tilt = None if axial is None else float(np.arccos(min(1.0, abs(float(np.dot(axial["axis"], d))))) * 1e3)
        out.append(dict(field=entry["index"], focus_shift=[float(v) for v in entry["shift"]],
                        trap_axis_tilt_mrad=tilt, **entry["info"]))
        if detail:
            f = s["trap"]["fields"][entry["index"]]
            # the beam's position was moved to the lens's focus: the aligned focus is where it was
            aligned = np.asarray(f["position"], dtype=float) - entry["shift"]
            out[-1].update(lens_detail(entry, beam_rotation(entry["direction"]), aligned))
    return out


FIELD_POINTS = 81


def _field_block(optical, centre, ranges, points: int | None = None) -> dict:
    """The ``field`` block: the light's intensity [W/m^2] on the three lab
    planes through ``centre`` (the equilibrium, or the searched centre),
    over the box the force curves cover.

    ``planes`` maps "xz", "yz" and "xy" to ``{u, v, I}``: ``u`` and ``v``
    [m] are the coordinates along the plane's first and second lab axes
    (absolute, not from the centre), and ``I[j][i]`` is the intensity at
    ``(u[i], v[j])``. Beams that do not interfere add their intensities; a
    coherent group is one field. ``I = 4 k^2 sum |E|^2`` with each beam
    scaled to watts, as :func:`levtrap.api.field3d`.
    """
    points = points or FIELD_POINTS
    centre = np.asarray(centre, dtype=float)
    axes = {"xz": (0, 2), "yz": (1, 2), "xy": (0, 1)}
    out: dict[str, Any] = dict(centre=[float(v) for v in centre], planes={})
    peak = 0.0
    for name, (a, b) in axes.items():
        u = centre[a] + np.linspace(-ranges[a], ranges[a], points)
        v = centre[b] + np.linspace(-ranges[b], ranges[b], points)
        U, V = np.meshgrid(u, v)  # rows: v
        pts = np.tile(centre, (U.size, 1))
        pts[:, a], pts[:, b] = U.ravel(), V.ravel()
        I = np.zeros(U.size)
        for f in optical:
            E = f.beam.em_field_xyz(f._own(pts))
            I += 4 * f.beam.k_medium ** 2 * np.sum(np.abs(E) ** 2, axis=1)
        I = I.reshape(U.shape)
        peak = max(peak, float(I.max()))
        out["planes"][name] = dict(u=u.tolist(), v=v.tolist(), I=I.tolist())
    out["max"] = peak
    return out


def _curves(fields, centre, ranges, points, modes=(), dipole=None) -> dict:
    """The ``curves`` block: force cuts through ``centre`` along each eigen-axis
    of the trap (along x, y and z when there are no modes, or two share a name).

    Each cut is keyed by its mode's name and holds ``axis`` (unit vector),
    ``position`` [m] (the coordinate along the axis, ``centre . axis + s``) and
    ``force`` [N] (along the axis); with ``dipole`` (a function of lab
    positions (N, 3) -> forces (N, 3)) also ``dipole`` [N], the same force
    with the light in the dipole approximation. The range along an axis is
    that of the lab axis it is closest to.
    """
    from .fields import total_force
    names = [m["name"] for m in modes]
    if len(modes) == 3 and len(set(names)) == 3:
        axes = [(m["name"], np.asarray(m["axis"], dtype=float)) for m in modes]
    else:
        axes = [(name, np.eye(3)[j]) for j, name in enumerate("xyz")]
    centre = np.asarray(centre, dtype=float)
    out = {}
    for name, u in axes:
        u = u / np.linalg.norm(u)
        j = int(np.argmax(np.abs(u)))
        ss = np.linspace(-ranges[j], ranges[j], points)
        line = centre + ss[:, None] * u
        entry = dict(axis=[float(v) for v in u], position=(float(centre @ u) + ss).tolist(),
                     force=(total_force(fields, line) @ u).tolist())
        if dipole is not None:
            entry["dipole"] = (np.asarray(dipole(line)) @ u).tolist()
        out[name] = entry
    return out


def _solve_paul(s, f, gravity, mass, p, warnings, want, t0) -> dict:
    """Paul trap (plus gravity): see :mod:`levtrap.fields.paul`."""
    from .derived import KB
    from .fields.paul import E_CHARGE, PaulField
    from .solver import find_trap

    bad = [w for w in want if w not in ("curves", "dipole", "field")]
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
    if "curves" in want or "dipole" in want:
        # no light: nothing to approximate, the curves have no dipole key
        result["curves"] = _curves(fields, r_eq if r_eq is not None else np.zeros(3), ranges, SCAN_POINTS, modes)
    result["time"] = time.perf_counter() - t0
    if "field" in want:
        result["field"] = None  # no light
    return result


def _hybrid_paul(paul, fields, trap, modes, mass, temp, warnings):
    """A Paul trap with light: frequencies and stability (``docs/ARCHITECTURE.md`` §5, B3).

    The optical, gravity and DC forces are static, so near the equilibrium
    they add a static curvature to the Mathieu equation of each axis:
    a_eff = a + 4 k_static / (m Omega^2), with k_static the stiffness of
    everything but the RF pseudopotential. Stability is the Floquet
    criterion for (a_eff, q) in any band (light usually puts a_eff far above
    the first region; only narrow parametric resonances are then unstable),
    and the exact secular frequency is beta(a_eff, q) Omega / 2. With q = 0
    this is sqrt(k / m) (the optical trap alone); with no light it is the
    Paul trap's own result.

    Returns ``(stable, paul block, model)`` and updates ``modes`` in place.
    """
    from .fields.paul import floquet_beta
    from .derived import KB

    model = paul.model()
    warnings += [n for n in model.notes if n not in warnings]
    k_rf = mass * (paul.Omega / 2) ** 2 * paul.q ** 2 / 2  # pseudopotential stiffness of the RF, per axis
    a_eff, exact, ok = {}, {}, {}
    for i, ax in enumerate("xyz"):
        mode = next((m for m in modes if max(range(3), key=lambda j: abs(m["axis"][j])) == i), None)
        aligned = mode is not None and abs(mode["axis"][i]) > 1 - 1e-6
        if not aligned:  # eigen-axes turned away from the electrodes' axes: pseudopotential only
            continue
        k_static = mode["stiffness"] - k_rf[i]
        a_eff[ax] = float(4 * k_static / (mass * paul.Omega ** 2))
        beta = floquet_beta(a_eff[ax], float(paul.q[i]))
        ok[ax] = beta is not None
        exact[ax] = beta * paul.Omega / (4 * math.pi) if beta is not None else None
        if model.name == "mathieu" and exact[ax] is not None:
            mode["frequency"] = exact[ax]
            mode["stiffness"] = mass * (2 * math.pi * exact[ax]) ** 2
    unstable = [ax for ax, good in ok.items() if not good and abs(float(paul.q["xyz".index(ax)])) > 0]
    stable = bool(trap.stable and not unstable)
    if unstable:
        warnings.append("No stable trap: the RF drives a parametric resonance along "
                        + ", ".join(unstable) + ", even with the light's restoring force.")
    r_eq = trap.equilibrium
    sec = paul.secular()
    block = dict(a=sec["a"], q=sec["q"], stable=not unstable, a_effective=a_eff,
                 secular=dict(pseudopotential=sec["pseudopotential"], exact=sec["exact"], with_light=exact),
                 micromotion=paul.micromotion(r_eq) if r_eq is not None else None)
    # a focus away from the Paul trap's centre holds the particle where the RF field is not zero
    # (only along axes where the RF field acts: a linear trap has none along its own axis)
    if r_eq is not None and stable:
        for m in modes:
            i = max(range(3), key=lambda j: abs(m["axis"][j]))
            if paul.q[i] == 0:
                continue
            spread = math.sqrt(KB * temp / m["stiffness"]) if m["stiffness"] > 0 else math.inf
            off = abs(float(r_eq[i]))
            if off > spread:
                warnings.append(f"The particle sits {off * 1e9:.0f} nm from the Paul trap's centre along "
                                f"{'xyz'[i]}, more than its thermal spread ({spread * 1e9:.0f} nm): expect "
                                f"excess micromotion (amplitude {block['micromotion'][i] * 1e9:.2g} nm).")
                break
    return stable, block, model


def breakdown(s: dict, fields, optical, paul, r_eq, modes, trap) -> list[dict]:
    """Each field's share at the equilibrium: its force [N] and its stiffness
    [N/m] along each mode's axis, so one sees which field sets which frequency."""
    from .solver import _scale

    h = _scale(fields) / 200
    names, beams = [], [i for i, f in enumerate(s["trap"]["fields"]) if f["kind"] == "beam"]
    from .optics import coherent_groups
    groups = coherent_groups([s["trap"]["fields"][i] for i in beams])
    for f in fields:
        if f in optical:
            names.append(("beam", [beams[j] for j in groups[optical.index(f)]]))
        elif f is paul:
            names.append(("paul", [i for i, g in enumerate(s["trap"]["fields"]) if g["kind"] == "paul"]))
        else:
            names.append(("gravity", [i for i, g in enumerate(s["trap"]["fields"]) if g["kind"] == "gravity"]))
    out = []
    for f, (kind, idx) in zip(fields, names):
        stiff = {}
        for m in modes:
            e = np.asarray(m["axis"], float)
            fp, fm = f.force(r_eq + h * e)[0], f.force(r_eq - h * e)[0]
            stiff[m["name"]] = float(-(fp - fm) @ e / (2 * h))
        out.append(dict(kind=kind, fields=idx, force=[float(v) for v in f.force(r_eq)[0]], stiffness=stiff))
    return out


def pattern_result(s: dict, r, optical=None) -> dict:
    """``pattern`` block (see :func:`levtrap.pattern.pattern_block`) for the
    particle at r = [x, y, z] [m] in the beams of a parsed, resolved setup.

    One pattern per optical field (#76): a coherent group, with beams in any
    direction and through any focus, scatters its summed incident beam (the
    one the force uses, :func:`levtrap.optics.optical_fields`); fields that
    do not interfere add their patterns, collected powers and information.
    Each field's incident beam is taken about the particle in the lab
    orientation (:meth:`levtrap.fields.OpticalField.incident_at`), so the
    pattern is in the lab frame. ``optical`` are the setup's optical fields
    (built here from the beams if not given).

    "The trapping lens" is the one the first beam goes through: ``trap_axis``
    is the first beam's direction, and ``trap_NA`` the largest numerical
    aperture (``n_medium sin(convergence angle)``, at most ``n_medium``) among
    the beams that go the same way as the first (same direction, not merely
    the same axis; :func:`trap_lens`, #97). Beams that share one objective
    need it as wide as the widest of them, so the first beam's own NA would
    understate what the lens collects. ``trap_NA_fields`` are those beams
    (indices into ``trap.fields``) and ``trap_NA_field`` the one whose NA it
    is. ``at_trap_NA`` is what a cone of that NA collects looking back
    through the lens (``backward``, about minus the first beam's direction)
    and opposite it (``forward``). For one beam along +z these are the lab's
    -z and +z, as before.

    Without ``optical``, the fields are built here from ``s``, whose particle
    must be as given (not yet through :func:`resolve_particle`): a material's
    n and k are then taken at each field's own wavelength, as :func:`solve`
    does; a resolved particle would carry the first beam's n to every field.
    """
    from .api import _single_beam, _tmatrix
    from .optics import optical_fields
    from .pattern import pattern_block

    nm = float(s["environment"]["medium_index"])
    if optical is None:
        optical = optical_fields(s, _single_beam, lambda wl: _tmatrix(_particle_at(s["particle"], wl), wl, nm)[0])
    r = np.asarray(r, dtype=float)
    parts = [(f.incident_at(r), f.T) for f in optical]
    lens = trap_lens(s)
    out = pattern_block(parts, n_medium=nm, trap_NA=lens["NA"], trap_axis=lens["axis"])
    if "trap_NA" in out:
        out["trap_NA_fields"] = lens["fields"]
        out["trap_NA_field"] = lens["field"]
    return out


def beam_NA(b: dict, n_medium: float) -> float:
    """Numerical aperture of a beam's focusing optic: ``n_medium sin(convergence
    angle)``, from its focus block (NA, angle or waist), at most ``n_medium``."""
    from .api import _beam_angle

    m = [int(v) for v in b["mode"]["indices"]]
    order = (2 * m[0] + abs(m[1])) if b["mode"]["type"] == "lg" else (m[0] + m[1])
    angle = _beam_angle(b["focus"], float(b["wavelength"]), n_medium, order)
    return min(n_medium, n_medium * math.sin(min(angle, math.pi / 2)))


def trap_lens(s: dict) -> dict:
    """The trapping lens of a parsed setup (#97): the lens the first beam goes
    through. Beams going the same way as the first (unit directions equal, so
    not a beam along -z when the first goes +z) share it, and it must be as
    wide as the widest of them: its NA is the largest of their NAs
    (:func:`beam_NA`), at most ``n_medium``.

    Returns ``NA``, ``axis`` (the first beam's direction, unit), ``fields``
    (indices into ``trap.fields`` of the beams going that way, the first beam
    first) and ``field`` (the index of the beam whose NA it is; the first such
    beam on a tie)."""
    nm = float(s["environment"]["medium_index"])
    fields = s["trap"]["fields"]
    idx = [i for i, f in enumerate(fields) if f["kind"] == "beam"]
    axis = np.asarray(fields[idx[0]]["direction"], dtype=float)
    axis = axis / np.linalg.norm(axis)

    def same_way(f):
        d = np.asarray(f["direction"], dtype=float)
        return float(d @ axis) / np.linalg.norm(d) > 1 - 1e-9

    group = [i for i in idx if same_way(fields[i])]
    nas = [beam_NA(fields[i], nm) for i in group]
    k = int(np.argmax(nas))
    return dict(NA=nas[k], axis=[float(v) for v in axis], fields=group, field=group[k])


def solve_json(setup_json: str, want_json: str = "[]", start_json: str = "null") -> str:
    """JSON wrapper for the web worker: ``{"ok": true, "result": …}`` or
    ``{"ok": false, "error": …, "kind": "setup" | "unsupported" | "internal", "path": …}``.
    ``start_json``: null, or a lab position [m] to follow (see :func:`solve`)."""
    try:
        return json.dumps(dict(ok=True, result=solve(setup_json, json.loads(want_json), json.loads(start_json))))
    except SetupError as exc:
        return json.dumps(dict(ok=False, kind="setup", path=exc.path, error=exc.message))
    except UnsupportedSetup as exc:
        return json.dumps(dict(ok=False, kind="unsupported", error=str(exc)))
    except Exception as exc:  # report to the UI rather than crash the worker
        return json.dumps(dict(ok=False, kind="internal", error=f"{type(exc).__name__}: {exc}"))
