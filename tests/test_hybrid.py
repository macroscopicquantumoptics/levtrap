"""B3: a Paul trap, light and gravity in one setup (issue #12).

References are the limits the hybrid must reduce to (the Paul trap alone,
the optical trap alone), the additivity of stiffnesses, and the Mathieu
equation itself; no fitted numbers.
"""

import copy
import math

import numpy as np
import pytest

from levtrap.fields.paul import floquet_beta, mathieu_beta
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve

BEAM = DEFAULT_SETUP["trap"]["fields"][0]
LINEAR = {"kind": "paul", "geometry": "linear", "rf_voltage": 300, "rf_frequency": 5e3, "endcap_voltage": 5,
          "r0": 1e-3, "z0": 2e-3, "geometry_factors": {"radial": 1.0, "axial": 0.3}}


def setup(beams=(), paul=None, gravity=False, charge=30):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["charge"] = charge
    s["trap"]["fields"] = [{**copy.deepcopy(BEAM), **b} for b in beams]
    if paul is not None:
        s["trap"]["fields"].append({**LINEAR, **paul})
    if gravity:
        s["trap"]["fields"].append({"kind": "gravity"})
    return s


def by_name(r, key="stiffness"):
    return {m["name"]: m[key] for m in r["modes"]}


# --- the Mathieu equation with a static force --------------------------------------


def test_floquet_beta_is_mathieu_beta_in_the_first_region():
    for a, q in [(0.0, 0.3), (-0.01, 0.5), (0.1, 0.2), (0.0, 0.85)]:
        assert floquet_beta(a, q) == pytest.approx(mathieu_beta(a, q), rel=1e-9)


def test_floquet_beta_far_above_the_first_region():
    # a static confinement much stronger than the RF: beta -> sqrt(a + q^2 / 2)
    assert floquet_beta(83.0, 0.53) == pytest.approx(math.sqrt(83.0 + 0.53**2 / 2), rel=1e-3)
    assert floquet_beta(0.5, 0.0) == pytest.approx(math.sqrt(0.5))
    # the first parametric resonance (a = 1) is unstable for any q > 0
    assert floquet_beta(1.0, 0.3) is None


# --- limits ----------------------------------------------------------------------


def test_no_optical_power_is_the_paul_trap_alone():
    pure = solve(setup(paul={}, gravity=True))
    dark = solve(setup([{"power": 0.0}], paul={}, gravity=True))
    assert [m["frequency"] for m in dark["modes"]] == [m["frequency"] for m in pure["modes"]]
    assert dark["equilibrium"] == pure["equilibrium"]
    assert dark["paul"]["q"] == pure["paul"]["q"]


def test_no_rf_is_the_optical_trap_alone():
    optical = solve(setup([{}], gravity=True))
    hybrid = solve(setup([{}], paul={"rf_voltage": 0.0, "endcap_voltage": 0.0}, gravity=True))
    assert hybrid["stable"]
    assert hybrid["equilibrium"] == pytest.approx(optical["equilibrium"], abs=1e-12)
    for name, f in by_name(optical, "frequency").items():
        assert by_name(hybrid, "frequency")[name] == pytest.approx(f, rel=1e-6)


def test_stiffnesses_add():
    """A weak optical trap centred in a Paul trap: k_total = k_paul + k_optical per
    axis. Two opposing, incoherent beams hold the particle at their common focus
    (B1), so the optical and the Paul equilibria coincide."""
    beams = [{"power": 1e-6}, {"id": "beam2", "power": 1e-6, "direction": [0, 0, -1]}]
    optical = solve(setup(beams))
    paul = solve(setup(paul={}))
    hybrid = solve(setup(beams, paul={}))
    assert hybrid["stable"] and np.max(np.abs(hybrid["equilibrium"])) < 1e-12
    for name in "xyz":
        k_opt, k_paul = by_name(optical)[name], by_name(paul)[name]
        assert k_opt > 0.2 * k_paul  # both matter
        assert by_name(hybrid)[name] == pytest.approx(k_opt + k_paul, rel=0.01)


def test_the_breakdown_says_which_field_sets_which_frequency():
    beams = [{"power": 1e-6}, {"id": "beam2", "power": 1e-6, "direction": [0, 0, -1]}]
    r = solve(setup(beams, paul={}, gravity=True))
    parts = r["breakdown"]
    assert [p["kind"] for p in parts] == ["beam", "beam", "paul", "gravity"]
    assert [p["fields"] for p in parts] == [[0], [1], [2], [3]]
    # the forces balance at the equilibrium
    total = np.sum([p["force"] for p in parts], axis=0)
    weight = r["particle"]["mass"] * 9.81
    assert np.max(np.abs(total)) < 1e-6 * weight
    # and the stiffnesses add up to the modes' (pseudopotential model, q = 0.32)
    for name, k in by_name(r).items():
        assert sum(p["stiffness"][name] for p in parts) == pytest.approx(k, rel=1e-3)


# --- two scales --------------------------------------------------------------------


def test_a_1_um_waist_inside_a_1_mm_paul_trap():
    """2 mW at a 1 um waist cannot hold the particle by itself (the scattering
    force wins), but inside a Paul trap it is held, tens of um down the beam."""
    beam = {"power": 2e-3, "focus": {"kind": "lens", "waist": 1e-6}}
    assert not solve(setup([beam]))["stable"]
    r = solve(setup([beam], paul={}, gravity=True))
    assert r["stable"]
    x, y, z = r["equilibrium"]
    assert 1e-6 < z < 1e-4  # pushed along the beam, held by the end caps and the light
    assert abs(x) < 1e-9
    assert np.max(np.abs(np.sum([p["force"] for p in r["breakdown"]], axis=0))) < 1e-6 * r["particle"]["mass"] * 9.81


def test_a_focus_far_from_the_centre_leaves_the_paul_trap():
    far = solve(setup([{"power": 1e-6, "focus": {"kind": "lens", "waist": 1e-6}, "position": [0, 0, 5e-4]}],
                      paul={}, gravity=True))
    pure = solve(setup(paul={}, gravity=True))
    for name, f in by_name(pure, "frequency").items():
        assert by_name(far, "frequency")[name] == pytest.approx(f, rel=1e-3)


def test_a_focus_off_the_rf_axis_warns_of_micromotion():
    r = solve(setup([{"power": 2e-3, "position": [1e-6, 0, 0]}], paul={}))
    assert r["stable"]
    assert any("excess micromotion" in w and "along x" in w for w in r["warnings"])
    # along the linear trap's own axis the RF field is zero: no micromotion
    r = solve(setup([{"power": 2e-3, "position": [0, 0, 1e-6]}], paul={}))
    assert not any("micromotion" in w for w in r["warnings"])


def test_a_strong_tweezer_in_a_paul_trap_is_stable_beyond_the_first_region():
    """The light's curvature puts a_eff far above the first Mathieu region; the
    motion is still stable, and its frequency is the light's."""
    r = solve(setup([{"power": 2e-3}], paul={}, gravity=True))
    assert r["stable"] and r["paul"]["stable"]
    assert r["paul"]["a_effective"]["x"] > 10
    optical = solve(setup([{"power": 2e-3}], gravity=True))
    assert by_name(r, "frequency")["x"] == pytest.approx(by_name(optical, "frequency")["x"], rel=1e-3)
