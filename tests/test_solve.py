"""solve(): the OTT benchmark through the Setup/Result contract, and agreement with api.analyse."""

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
    """solve() must give exactly the numbers of the validated legacy entry point."""
    r = solve(DEFAULT_SETUP, want=["curves"])
    silica = api.get_material("SiO2", 1.064e-6)
    ref = api.analyse(dict(
        wavelength=1.064e-6, medium_index=1.0, temperature=300.0,
        particle=dict(radius=1e-7, n=silica["n"], k=silica["k"], density=silica["density"]),
        beams=[dict(type="lg", mode=[0, 0], NA=0.8, power=0.2, polarisation="x", phase=0.0)]),
        detail=False)
    assert r["stable"] == ref["stable"]
    assert r["equilibrium"][2] == ref["z_eq"]
    for m in r["modes"]:
        assert m["frequency"] == ref["freq"][m["name"]]
        assert m["stiffness"] == ref["stiffness"][m["name"]]
    assert r["depth"]["kT"] == ref["depth"]["kT"]
    assert r["optical"]["P_sca"] == ref["at"]["P_sca"]
    assert r["particle"]["mass"] == ref["mass"]
    assert r["curves"]["z"]["force"] == ref["lines"]["Fz"][2]
    assert len(r["curves"]["x"]["position"]) == len(r["curves"]["x"]["force"])


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
    lambda s: s["trap"]["fields"].append({"kind": "gravity"}),
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
    s["trap"]["fields"].append({"kind": "gravity"})
    assert json.loads(solve_json(json.dumps(s)))["kind"] == "unsupported"
    assert json.loads(solve_json(json.dumps(DEFAULT_SETUP), '["nonsense"]'))["kind"] == "setup"
