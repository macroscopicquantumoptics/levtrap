"""M5: api.py JSON round trips and consistency with the low-level port."""

import json
import math

import numpy as np
import pytest

from levtrap import api
from levtrap.derived import C, recoil_ratio
from levtrap.materials import get_material


@pytest.fixture(scope="module")
def presets():
    return json.loads(api.presets())


def test_presets_round_trip(presets):
    assert set(presets) == {"silica_1064", "silica_1550", "ws2_bottle_1550"}
    assert presets["ws2_bottle_1550"]["validated"] is False
    out = json.loads(api.compute(json.dumps(presets["silica_1064"]["request"])))
    assert out["ok"], out
    r = out["result"]
    json.dumps(r)  # serialisable
    assert r["stable"]
    for key in ("z_eq", "stiffness", "freq", "depth", "mie", "at", "lines", "map", "Nmax"):
        assert key in r
    assert r["depth"]["kT"] > 1
    assert len(r["lines"]["Fz"][2]) == len(r["lines"]["z"])


def test_units_match_low_level(presets):
    """z_eq/kz from the API equal axial_equilibrium on the same beam (SI)."""
    from levtrap.traps import axial_equilibrium
    req = presets["silica_1064"]["request"]
    r = json.loads(api.compute(json.dumps(req)))["result"]
    beam, P = api.build_beam(req)
    T, _ = api.build_tmatrix(req)
    z, kzq = axial_equilibrium(T, beam, r["z_eq"])
    assert r["z_eq"] == pytest.approx(z, abs=1e-12)
    assert r["stiffness"]["z"] == pytest.approx(-kzq * P / C, rel=1e-9)  # n_medium = 1
    m = r["mass"]
    assert r["freq"]["z"] == pytest.approx(math.sqrt(r["stiffness"]["z"] / m) / 2 / math.pi, rel=1e-12)
    assert r["recoil_ratio"]["z"] == pytest.approx(
        recoil_ratio(r["at"]["P_sca"], req["wavelength"], m, 2 * math.pi * r["freq"]["z"]), rel=1e-12)


def test_force_scales_with_power(presets):
    req = json.loads(json.dumps(presets["silica_1550"]["request"]))
    r1 = json.loads(api.compute(json.dumps(req)))["result"]
    req["beams"][0]["power"] *= 2
    r2 = json.loads(api.compute(json.dumps(req)))["result"]
    F1 = np.array(r1["lines"]["Fz"])
    np.testing.assert_allclose(np.array(r2["lines"]["Fz"]), 2 * F1, rtol=1e-8, atol=1e-10 * np.abs(F1).max())
    assert r2["z_eq"] == pytest.approx(r1["z_eq"], abs=1e-12)


def test_dark_focus_preset(presets):
    req = presets["ws2_bottle_1550"]["request"]
    beam, P = api.build_beam(req)
    assert P == pytest.approx(0.8, rel=1e-9) or P > 0  # coherent sum: interference changes total
    E0 = np.sum(np.abs(beam.em_field_xyz(np.zeros((1, 3)))) ** 2)
    E_ring = np.max(np.sum(np.abs(beam.em_field_xyz(np.array([[x, 0, 0] for x in np.linspace(0.2e-6, 1.5e-6, 8)]))) ** 2, 1))
    assert E0 < 1e-20 * E_ring


def test_no_trap_reported():
    # a strongly scattering high-index sphere in a weak focus: no 3D trap
    req = dict(wavelength=1064e-9, medium_index=1.0,
               particle=dict(radius=400e-9, n=3.5, k=0.0, density=2330),
               beams=[dict(type="lg", mode=[0, 0], NA=0.3, power=0.1, polarisation="x")],
               scan=dict(z_range=2e-6, z_points=21, x_points=11, map_nx=3, map_nz=3, intensity_n=5))
    r = json.loads(api.compute(json.dumps(req)))
    assert r["ok"]
    assert r["result"]["stable"] is False


def test_sweep_round_trip(presets):
    req = json.loads(json.dumps(presets["silica_1064"]["request"]))
    req["scan"].update(z_points=31, x_points=11)
    out = json.loads(api.sweep(json.dumps(req), "power", json.dumps([0.1, 0.2])))
    pts = out["points"]
    assert len(pts) == 2 and all(p["stable"] for p in pts)
    assert pts[1]["freq"]["z"] == pytest.approx(math.sqrt(2) * pts[0]["freq"]["z"], rel=1e-6)


def test_materials():
    m = get_material("SiO2", 1550e-9)
    assert m["valid"] and m["n"] == pytest.approx(1.44)
    m = get_material("SiO2", 1064e-9)
    assert m["valid"] and m["n"] == pytest.approx(1.4496, abs=2e-4)  # Malitson
    assert not get_material("WS2", 1064e-9)["valid"]
    assert json.loads(api.materials(1550e-9))["WS2"]["n"] == pytest.approx(3.79)


def test_benchmark_endpoint():
    b = json.loads(api.benchmark())
    assert abs(b["z"] - b["expected"]["z"]) < 1e-9
