"""#83: a real objective's wavefront error (``focus.aberration``).

Zernike terms in waves rms over the pupil of a filled objective (``filling``,
#63): rho = sin(theta) / NA, phi the azimuth on the pupil from x. The field is
checked against an independent Richards-Wolf integral in
tests/test_focus_richards_wolf.py; here: the schema, and what the terms do to
the trap.
"""

import copy

import pytest

from levtrap.bsc import ZERNIKE
from levtrap.setup import ABERRATION_MAX, ABERRATIONS, DEFAULT_SETUP, SetupError, dumps, loads, parse, unknown_keys
from levtrap.solve import solve


def tweezer(focus, radius=50e-9):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["radius"] = radius
    s["trap"]["fields"][0]["focus"] = focus
    return s


def objective(aberration, NA=0.9, filling=1.0):
    return {"kind": "lens", "NA": NA, "filling": filling, "aberration": aberration}


def test_the_schema_and_the_beam_know_the_same_terms():
    assert ABERRATIONS == tuple(ZERNIKE)


def test_an_aberration_needs_a_filled_objective():
    for focus in ({"kind": "lens", "NA": 0.9}, {"kind": "lens", "NA": 0.9, "mapping": "sine"},
                  {"kind": "lens", "waist": 1e-6}):
        with pytest.raises(SetupError, match="needs a filled objective") as e:
            parse(tweezer({**focus, "aberration": {"spherical": 0.05}}))
        assert e.value.path == "trap.fields[0].focus.aberration"


def test_unknown_terms_and_large_amplitudes_are_refused():
    with pytest.raises(SetupError, match="unknown term") as e:
        parse(tweezer(objective({"trefoil": 0.1})))
    assert e.value.path == "trap.fields[0].focus.aberration.trefoil"
    with pytest.raises(SetupError) as e:
        parse(tweezer(objective({"coma_x": 1.5 * ABERRATION_MAX})))
    assert e.value.path == "trap.fields[0].focus.aberration.coma_x"
    with pytest.raises(SetupError):
        parse(tweezer(objective(["spherical"])))


def test_an_aberration_is_kept_through_a_file():
    s = tweezer(objective({"spherical": 0.08, "astigmatism_45": -0.02}))
    assert not unknown_keys(s)
    back = loads(dumps(s))
    assert back["trap"]["fields"][0]["focus"]["aberration"] == {"spherical": 0.08, "astigmatism_45": -0.02}


def test_spherical_aberration_softens_the_axis_and_coma_moves_the_trap_sideways():
    plain = solve(tweezer(objective({})))
    spherical = solve(tweezer(objective({"spherical": 0.09})))
    coma = solve(tweezer(objective({"coma_x": 0.05})))
    f = lambda r: {m["name"]: m["frequency"] for m in r["modes"]}
    p, s = f(plain), f(spherical)
    # the focus dims as a whole (Strehl), and the axis loses more than the transverse directions:
    # f_y/f_z rises by about 5 % while f_y/f_x stays (docs/validation/focus.md)
    assert s["y"] < p["y"] and s["z"] < p["z"]
    assert (s["y"] / s["z"]) / (p["y"] / p["z"]) > 1.04
    assert abs(s["y"] / s["x"] / (p["y"] / p["x"]) - 1) < 0.02
    # coma along x moves the trap along x (the sign is the term's), and keeps it on y = 0
    assert abs(coma["equilibrium"][0]) > 10e-9 and abs(coma["equilibrium"][1]) < 1e-12
    assert abs(plain["equilibrium"][0]) < 1e-12
