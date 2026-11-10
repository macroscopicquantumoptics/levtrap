"""solve(): the OTT benchmark through the Setup/Result contract and the generic solver,\nagreement with api.analyse, and gravity."""

import copy
import json

import pytest

from levtrap import api
from levtrap.derived import C
from levtrap.setup import DEFAULT_SETUP, SetupError
from levtrap.solve import RESULT_VERSION, UnsupportedSetup, solve, solve_json

# tests/testExamples.m (OTT v1): see tests/test_examples.py
WL, N_MEDIUM, N_PARTICLE = 1064.0e-9, 1.34, 1.59
OTT = dict(
    particle={"radius": 1.5 * WL / N_MEDIUM, "n": N_PARTICLE, "density": 1050.0},
    environment={"medium_index": N_MEDIUM},
    trap={"fields": [{"kind": "beam", "wavelength": WL, "power": 1.0,
                      "focus": {"angle_deg": 50}, "polarisation": "x"}]},
)


@pytest.fixture(scope="module")
def ott():
    return solve(OTT)


def test_ott_benchmark(ott):
    """z_eq and the stiffnesses of OTT's sphere example; k [N/m] = -dQ/dx n P / c."""
    assert ott["stable"]
    x, y, z = ott["equilibrium"]
    assert x == 0 and y == 0
    assert abs(z - 4.023474767793779e-07) < 1e-9
    k = {m["name"]: m["stiffness"] for m in ott["modes"]}
    assert k["z"] == pytest.approx(6.258368435930368e04 * N_MEDIUM / C, rel=0.01)
    assert k["x"] == pytest.approx(2.450214062064871e05 * N_MEDIUM / C, rel=0.01)


def test_result_shape(ott):
    assert ott["version"] == RESULT_VERSION
    assert [m["name"] for m in ott["modes"]] == ["x", "y", "z"]
    assert ott["modes"][2]["axis"] == [0.0, 0.0, 1.0]
    assert all(m["frequency"] > 0 and m["depth"] > 0 for m in ott["modes"])
    assert ott["depth"]["J"] == pytest.approx(min(m["depth"] for m in ott["modes"]))
    assert ott["warnings"] == []
    assert "curves" not in ott
    json.dumps(ott)  # plain JSON


def test_matches_analyse():
    """The generic solver reproduces the validated on-axis path (api.analyse):
    equilibrium and frequencies within 0.1 %.  The depth is integrated on a
    line through the equilibrium rather than through the focus, which is
    closer to the converged value; it agrees within 1 %."""
    r = solve(DEFAULT_SETUP, want=["curves"])
    ref = api.analyse(*api.prepare(dict(setup=DEFAULT_SETUP)), detail=False)
    assert r["stable"] == ref["stable"]
    assert r["equilibrium"][2] == pytest.approx(ref["z_eq"], rel=1e-3)
    for m in r["modes"]:
        assert m["frequency"] == pytest.approx(ref["freq"][m["name"]], rel=1e-3)
        assert m["stiffness"] == pytest.approx(ref["stiffness"][m["name"]], rel=2e-3)
        assert m["depth"] == pytest.approx(ref["depth"][m["name"]], rel=1e-2)
    assert r["depth"]["kT"] == pytest.approx(ref["depth"]["kT"], rel=1e-2)
    assert r["optical"]["P_sca"] == pytest.approx(ref["at"]["P_sca"], rel=1e-4)
    assert r["particle"]["mass"] == ref["mass"]
    for a in "xyz":
        c = r["curves"][a]
        assert len(c["position"]) == len(c["force"])
    # the z curve passes through the equilibrium with zero force
    zc = r["curves"]["z"]
    i = len(zc["position"]) // 2
    assert zc["position"][i] == pytest.approx(r["equilibrium"][2])
    assert abs(zc["force"][i]) < 1e-6 * max(abs(f) for f in zc["force"])


def test_gravity_sags_a_tweezer_by_g_over_omega_squared():
    """Gravity along -y shifts the equilibrium by g / Omega_y^2 (A2 acceptance, 2 %)."""
    import math
    s = copy.deepcopy(DEFAULT_SETUP)
    s["trap"]["fields"][0]["power"] = 0.01  # weak trap: a sag of a few nm, still harmonic
    r0 = solve(s)
    s["trap"]["fields"].append({"kind": "gravity"})
    r1 = solve(s)
    assert r1["stable"]
    f_y = {m["name"]: m["frequency"] for m in r0["modes"]}["y"]
    sag = 9.81 / (2 * math.pi * f_y) ** 2
    assert r1["equilibrium"][1] - r0["equilibrium"][1] == pytest.approx(-sag, rel=0.02)
    assert r1["equilibrium"][0] == pytest.approx(r0["equilibrium"][0], abs=1e-12)


def test_no_stable_trap_is_reported():
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"].update(material=None, n=1.45, k=2.0, density=2200)  # strongly absorbing: pushed out
    s["trap"]["fields"][0]["focus"] = {"NA": 0.2}
    r = solve(s)
    assert not r["stable"]
    assert r["depth"]["kT"] == 0
    assert any(w.startswith("No stable trap") for w in r["warnings"])


def test_unknown_keys_become_warnings():
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["shape"] = "rod"
    assert "particle.shape: unknown key, ignored" in solve(s)["warnings"]


@pytest.mark.parametrize("change", [
    lambda s: s["trap"]["fields"].append({"kind": "paul", "geometry": "ring", "rf_voltage": 100,
                                          "rf_frequency": 1e3, "r0": 1e-3, "z0": 1e-3}) or
              s["particle"].update(charge=100),
    lambda s: s["trap"]["fields"][0].update(direction=[0, 0, -1]),
    lambda s: s["trap"]["fields"][0].update(position=[0, 0, 1e-6]),
    lambda s: s["trap"]["fields"].append({**s["trap"]["fields"][0], "id": "beam2"}),
])
def test_unsupported_setups_say_so(change):
    s = copy.deepcopy(DEFAULT_SETUP)
    change(s)
    with pytest.raises(UnsupportedSetup):
        solve(s)


def test_material_without_data():
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["material"] = "WS2"  # tabulated at 1550 nm only
    with pytest.raises(SetupError) as err:
        solve(s)
    assert err.value.path == "particle.material"


def test_json_wrapper_and_dispatch():
    out = json.loads(api.handle("solve", json.dumps(DEFAULT_SETUP)))
    assert out["ok"] and out["result"]["stable"]
    bad = json.loads(solve_json(json.dumps({**DEFAULT_SETUP, "particle": {"radius": -1}})))
    assert bad == dict(ok=False, kind="setup", path="particle.radius", error=bad["error"])
    s = copy.deepcopy(DEFAULT_SETUP)
    s["trap"]["fields"][0]["direction"] = [1, 0, 0]
    assert json.loads(solve_json(json.dumps(s)))["kind"] == "unsupported"
    assert json.loads(solve_json(json.dumps(DEFAULT_SETUP), '["nonsense"]'))["kind"] == "setup"
