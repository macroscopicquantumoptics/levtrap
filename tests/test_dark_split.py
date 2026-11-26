"""The power split of a coherent pair that darkens the focus (#79).

levtrap.optics.dark_split moves the helper of examples/paper_2607_09896.py
into the engine, and solve reports it per coherent pair (``coherent``), so
the app's "Darken the focus" button can use it. The reference is OTT's own
split for the bottle beam of arXiv:2607.09896 (tests/fixtures/ott_dark_trap.json);
the rest checks the field at the focus directly.
"""

import json
import math
import pathlib

import numpy as np
import pytest

from levtrap.api import _single_beam
from levtrap.optics import _group_beam, dark_split, focus_field
from levtrap.setup import parse
from levtrap.solve import solve

REF = json.loads((pathlib.Path(__file__).parent / "fixtures" / "ott_dark_trap.json").read_text())
INP = REF["inputs"]


def bottle(split=(0.5, 0.5), phase=math.pi, polarisation="circular+", extra=()):
    """The paper's LG00 + LG10 pair (OTT's inputs), with the second beam's phase and polarisation."""
    fields = list(extra)
    for i, (w, mode, frac) in enumerate(zip(INP["waists"], INP["modes"], split)):
        f = dict(kind="beam", id=f"b{i + 1}", wavelength=INP["wavelength"], power=INP["power"] * frac,
                 focus=dict(kind="lens", waist=w), mode=dict(type="lg", indices=list(mode)),
                 polarisation="circular+" if i == 0 else polarisation, phase=0.0 if i == 0 else phase)
        if i:
            f["coherent_with"] = "b1"
        fields.append(f)
    return dict(version=1,
                particle=dict(material="WS2", radius=INP["radius"], n=INP["n"], k=INP["k"], density=7500.0),
                environment=dict(medium_index=INP["medium_index"], temperature=300.0),
                trap=dict(fields=fields))


def pair(setup):
    s = parse(setup)
    specs = [f for f in s["trap"]["fields"] if f["kind"] == "beam"]
    nm = float(s["environment"]["medium_index"])
    return specs, [_single_beam(b, nm) for b in specs], nm


def test_the_dark_split_of_the_bottle_beam_is_otts():
    """OTT's split for the paper's pair (MATLAB, scripts/ott/dark_trap_reference.m), as the script computed it."""
    specs, units, _ = pair(bottle())
    d = dark_split(specs, units)
    assert [1 - d["split"], d["split"]] == pytest.approx(REF["split"], rel=1e-9)
    assert d["residual"] == pytest.approx(0, abs=1e-9)


def test_at_the_dark_split_the_focus_is_dark():
    """The coherent sum the engine traps with (optics._group_beam) has no field at the focus at the dark split,
    while an even split leaves a bright one."""
    specs, units, _ = pair(bottle())
    s = dark_split(specs, units)["split"]
    intensity = {}
    for name, frac in (("dark", s), ("even", 0.5)):
        for spec, p in zip(specs, (1 - frac, frac)):
            spec["power"] = p
        beam = _group_beam(specs, units, np.zeros(3), 0)
        intensity[name] = float(np.sum(np.abs(beam.em_field_xyz(np.zeros((1, 3)))) ** 2))
    assert intensity["dark"] < 1e-12 * intensity["even"]


def measured_residual(specs, units, split):
    """|E|^2 at the first beam's focus in the field the engine traps with (the group rescaled to its
    total power, optics._group_beam), over the two beams' intensities there added."""
    specs = [dict(s, power=p) for s, p in zip(specs, (1 - split, split))]
    origin = np.asarray(specs[0]["position"], dtype=float)
    E = _group_beam(specs, units, origin, 0).em_field_xyz(np.zeros((1, 3)))[0]
    a, b = (focus_field(s, u, origin) for s, u in zip(specs, units))
    added = specs[0]["power"] * np.vdot(a, a).real + specs[1]["power"] * np.vdot(b, b).real
    return float(np.vdot(E, E).real / added)


@pytest.mark.parametrize("phase, polarisation", [
    (math.pi, "circular+"),  # antiparallel: a null
    (0.0, "circular+"),  # in phase: bright
    (0.3, "circular+"),  # the review's case: the group's rescaling doubles the brightness here
    (math.pi / 2, "circular+"),  # in quadrature
    (math.pi, "circular-"),  # opposite helicities are orthogonal at the focus
])
def test_the_residual_is_the_brightness_the_engine_traps_with(phase, polarisation):
    """The split equalises the two intensities whatever the phase; only antiparallel fields then cancel.
    The residual is the focus's brightness in the group the engine builds, rescaled to its total power
    (overlapping modes make that power depend on the phase), not in the bare sum of the two beams."""
    specs, units, _ = pair(bottle(phase=phase, polarisation=polarisation))
    d = dark_split(specs, units)
    assert d["split"] == pytest.approx(REF["split"][1], rel=1e-9)
    assert d["residual"] == pytest.approx(measured_residual(specs, units, d["split"]), rel=1e-6, abs=1e-9)
    if phase == math.pi and polarisation == "circular+":
        assert d["residual"] == pytest.approx(0, abs=1e-9)


def counter(phase, offset=0.0):
    common = dict(kind="beam", wavelength=1.064e-6, power=0.05, focus=dict(kind="lens", NA=0.6), polarisation="x")
    return dict(version=1, particle=dict(material="SiO2", radius=5e-8), trap=dict(fields=[
        dict(common, id="a"),
        dict(common, id="b", coherent_with="a", direction=[0, 0, -1], position=[0, 0, offset], phase=phase)]))


@pytest.mark.parametrize("phase, residual", [(0.0, 2.0), (math.pi, 0.0)])
def test_two_opposing_beams_split_evenly(phase, residual):
    """Two equal opposing beams polarised x in their frames (the lab's x for both, #71) at one focus: by symmetry
    the dark split is even; in phase they make an antinode there, opposite in phase a node."""
    specs, units, _ = pair(counter(phase))
    d = dark_split(specs, units)
    assert d["split"] == pytest.approx(0.5, abs=1e-12)
    assert d["residual"] == pytest.approx(measured_residual(specs, units, 0.5), rel=1e-6, abs=1e-9)
    if residual == 0.0:
        assert d["residual"] == pytest.approx(0, abs=1e-9)
    else:
        assert d["residual"] > 1  # an antinode: brighter than the two beams added


def test_the_field_of_a_moved_turned_beam_is_the_engines():
    """focus_field places a beam as optics._group_beam does (turned to its direction, moved to its focus, its
    phase applied) without re-expanding it."""
    specs, units, _ = pair(counter(0.7, offset=0.3e-6))
    spec, unit = specs[1], units[1]
    spec["power"] = 1.0
    placed = _group_beam([spec], [unit], np.zeros(3), 0)
    assert np.allclose(focus_field(spec, unit, np.zeros(3)), placed.em_field_xyz(np.zeros((1, 3)))[0], rtol=1e-6, atol=1e-9)


def test_solve_reports_the_split_per_coherent_pair():
    """The Result's coherent block names the pair by its indices into trap.fields (a gravity field first shifts
    them), and is absent when no beams interfere."""
    r = solve(bottle(extra=[dict(kind="gravity")]))
    (entry,) = r["coherent"]
    assert entry["fields"] == [1, 2]
    assert entry["dark_split"] == pytest.approx(REF["split"][1], rel=1e-9)
    assert entry["residual"] == pytest.approx(0, abs=1e-9)
    single = bottle()
    single["trap"]["fields"] = single["trap"]["fields"][:1]
    assert "coherent" not in solve(single)
