"""Setup files: validation, defaults, round trip and the frozen v1 fixture."""

import copy
import json
import pathlib

import pytest

from levtrap.setup import DEFAULT_SETUP, VERSION, SetupError, dumps, parse, unknown_keys

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "setup_v1.json"


def edited(path, value, base=DEFAULT_SETUP):
    """Copy of ``base`` with the key at ``path`` (a tuple) set, or removed if value is ``...``."""
    s = copy.deepcopy(base)
    d = s
    for key in path[:-1]:
        d = d[key]
    if value is ...:
        del d[path[-1]]
    else:
        d[path[-1]] = value
    return s


def test_fixture_v1_keeps_loading():
    """A setup file saved by version 1 must open in every later version."""
    s = parse(FIXTURE.read_text())
    assert s["version"] == VERSION
    assert s["particle"]["radius"] == 1e-7
    beam = s["trap"]["fields"][0]
    assert beam["kind"] == "beam" and beam["focus"]["NA"] == 0.8 and beam["power"] == 0.2


def test_defaults_are_filled():
    s = parse({"particle": {"radius": 5e-8, "n": 1.45, "density": 2200},
               "trap": {"fields": [{"kind": "beam", "wavelength": 1.55e-6, "power": 1,
                                    "focus": {"NA": 0.6}}]}})
    assert s["version"] == VERSION
    assert s["particle"]["k"] == 0.0 and s["particle"]["charge"] == 0
    assert s["environment"] == dict(pressure=1e-4, temperature=300.0, gas="N2", medium_index=1.0)
    b = s["trap"]["fields"][0]
    assert b["direction"] == [0, 0, 1] and b["position"] == [0, 0, 0]
    assert b["mode"] == dict(type="lg", indices=[0, 0]) and b["polarisation"] == "x"
    assert b["focus"]["kind"] == "lens" and b["coherent_with"] is None


@pytest.mark.parametrize("setup", [DEFAULT_SETUP, json.loads(FIXTURE.read_text())])
def test_round_trip(setup):
    once = parse(setup)
    assert parse(once) == once
    assert parse(json.loads(json.dumps(once))) == once
    assert parse(dumps(setup)) == once


def test_parse_does_not_modify_its_input():
    before = copy.deepcopy(DEFAULT_SETUP)
    parse(DEFAULT_SETUP)
    assert DEFAULT_SETUP == before


@pytest.mark.parametrize("path, value, where", [
    (("particle", "radius"), -1, "particle.radius"),
    (("particle", "radius"), "100 nm", "particle.radius"),
    (("particle", "radius"), ..., "particle.radius"),
    (("particle", "material"), "unobtainium", "particle.material"),
    (("particle", "material"), ..., "particle.n"),
    (("environment", "gas"), "Xe", "environment.gas"),
    (("environment", "temperature"), 0, "environment.temperature"),
    (("trap", "fields"), [], "trap.fields"),
    (("trap", "fields", 0, "kind"), "magnet", "trap.fields[0].kind"),
    (("trap", "fields", 0, "power"), -0.1, "trap.fields[0].power"),
    (("trap", "fields", 0, "wavelength"), ..., "trap.fields[0].wavelength"),
    (("trap", "fields", 0, "focus", "NA"), 1.2, "trap.fields[0].focus.NA"),
    (("trap", "fields", 0, "focus"), {"NA": 0.8, "waist": 1e-6}, "trap.fields[0].focus"),
    (("trap", "fields", 0, "focus"), {"kind": "lens"}, "trap.fields[0].focus"),
    (("trap", "fields", 0, "mode", "indices"), [0.5, 0], "trap.fields[0].mode.indices"),
    (("trap", "fields", 0, "polarisation"), "diagonal", "trap.fields[0].polarisation"),
    (("trap", "fields", 0, "direction"), [0, 0, 0], "trap.fields[0].direction"),
    (("trap", "fields", 0, "position"), [0, 0], "trap.fields[0].position"),
    (("trap", "fields", 0, "coherent_with"), "nobody", "trap.fields[0].coherent_with"),
    (("version",), 99, "version"),
])
def test_invalid_setups_name_the_key(path, value, where):
    with pytest.raises(SetupError) as err:
        parse(edited(path, value))
    assert err.value.path == where
    assert where in str(err.value)


def test_not_json():
    with pytest.raises(SetupError):
        parse("{not json")


def test_paul_trap_needs_charge():
    paul = {"kind": "paul", "geometry": "linear", "rf_voltage": 300, "rf_frequency": 5e3,
            "r0": 1e-3, "z0": 2e-3}
    s = edited(("trap", "fields"), [paul])
    with pytest.raises(SetupError) as err:
        parse(s)
    assert err.value.path == "particle.charge"
    s["particle"]["charge"] = 50
    f = parse(s)["trap"]["fields"][0]
    assert f["geometry_factors"] == dict(radial=1.0, axial=1.0) and f["dc_voltage"] == 0.0


def test_coherent_beams_share_a_wavelength():
    b1 = DEFAULT_SETUP["trap"]["fields"][0]
    b2 = {**b1, "id": "beam2", "coherent_with": "beam1"}
    assert parse(edited(("trap", "fields"), [b1, b2]))["trap"]["fields"][1]["coherent_with"] == "beam1"
    with pytest.raises(SetupError):
        parse(edited(("trap", "fields"), [b1, {**b2, "wavelength": 1.55e-6}]))
    with pytest.raises(SetupError):
        parse(edited(("trap", "fields"), [b1, {**b2, "id": "beam1"}]))  # duplicate id


def test_unknown_keys_are_kept_and_reported():
    s = copy.deepcopy(DEFAULT_SETUP)
    s["note"] = "from the future"
    s["particle"]["shape"] = "rod"
    s["trap"]["fields"][0]["focus"]["tilt"] = 0.1
    assert unknown_keys(s) == ["note", "particle.shape", "trap.fields[0].focus.tilt"]
    p = parse(s)
    assert p["note"] == "from the future" and p["particle"]["shape"] == "rod"
    assert p["trap"]["fields"][0]["focus"]["tilt"] == 0.1
    assert unknown_keys(parse(DEFAULT_SETUP)) == []
