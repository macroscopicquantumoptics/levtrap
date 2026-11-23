"""#50: continuation, as a sweep follows one trap from value to value
(``solve(setup, start=...)``), and the flag when the followed trap vanishes.

The reference is the old lens-tilt page's sweep (:func:`levtrap.api.lens_sweep`),
which follows the equilibrium the same way.
"""

import copy
import json

import numpy as np
import pytest

from levtrap import api
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve

PARTICLE = dict(radius=100e-9, n=1.444, k=0, density=2200)


def asphere(tilt_y, diameter=2.5e-3):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"] = dict(PARTICLE)
    s["trap"]["fields"][0].update(wavelength=1.55e-6, power=0.5,
                                  focus=dict(kind="asphere", beam_diameter=diameter, tilt_deg=[0.0, tilt_y], decentre=[0.0, 0.0]))
    return s


def sweep(values):
    """The app's sweep: each solve starts from the last stable equilibrium."""
    start, out = None, []
    for v in values:
        r = solve(asphere(v), start=start)
        out.append(r)
        if r["stable"] and r["equilibrium"] is not None:
            start = r["equilibrium"]
    return out


def test_a_tilt_sweep_follows_the_same_trap_and_flags_the_same_jumps_as_the_old_page():
    values = [0.25 * i for i in range(11)]  # 0 to 2.5 degrees
    old = json.loads(api.lens_sweep(json.dumps(dict(wavelength=1.55e-6, power=0.5, particle=PARTICLE, lens=dict(diameter_mm=2.5))),
                                    "tilt_y_deg", json.dumps(values)))["points"]
    new = sweep(values)
    for v, o, n in zip(values, old, new):
        assert n["stable"] == o["stable"], v
        assert n.get("followed", {}).get("jumped", False) == o["jumped"], v
        if o["stable"]:
            np.testing.assert_allclose(np.asarray(n["equilibrium"]) * 1e6, o["eq_um"], atol=1e-6, err_msg=str(v))
    # the trap is lost at 1.5 degrees (a jump: the followed trap vanished) and found again at 2.5
    assert [n["stable"] for n in new] == [True] * 6 + [False] * 4 + [True]
    assert [n.get("followed", {}).get("jumped", False) for n in new] == [False] * 6 + [True] * 4 + [False]


def test_following_from_a_stable_trap_keeps_it():
    r0 = solve(asphere(0.3))
    r1 = solve(asphere(0.4), start=r0["equilibrium"])
    assert r1["followed"] == dict(start=r0["equilibrium"], jumped=False)
    fresh = solve(asphere(0.4))
    np.testing.assert_allclose(r1["equilibrium"], fresh["equilibrium"], atol=1e-12)
    assert sorted(m["frequency"] for m in r1["modes"]) == pytest.approx(sorted(m["frequency"] for m in fresh["modes"]), rel=1e-6)


def test_a_start_far_from_any_trap_jumps_and_searches_afresh():
    r = solve(DEFAULT_SETUP, start=[0.0, 0.0, 2e-6])
    fresh = solve(DEFAULT_SETUP)
    assert r["followed"]["jumped"] is True
    np.testing.assert_allclose(r["equilibrium"], fresh["equilibrium"], atol=1e-12)
    # no start, no block
    assert "followed" not in fresh


def test_a_start_reaches_a_trap_beyond_the_first_searched_box():
    """A 5 mm beam on the asphere at 1550 nm traps 3.2 um upstream, beyond the
    3 um the first search covers along the beam; a sweep that started near it
    follows it. (Since #59 a fresh search finds it too: tests/test_trap_search.py.)"""
    s = asphere(0.0, diameter=5e-3)
    r = solve(s, start=[0.0, 0.0, -3.0e-6])
    assert r["stable"] and r["followed"]["jumped"] is False
    assert r["equilibrium"][2] == pytest.approx(-3.1635e-6, abs=1e-9)


def test_the_json_wrapper_takes_a_start():
    from levtrap.solve import solve_json
    out = json.loads(solve_json(json.dumps(DEFAULT_SETUP), "[]", json.dumps([0.0, 0.0, 2.2e-7])))
    assert out["ok"] and out["result"]["followed"]["jumped"] is False
