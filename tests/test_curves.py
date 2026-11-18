"""The ``curves`` block (D5, issue #21): force cuts along the trap's eigen-axes,
and the same force with the light in the dipole approximation."""

import copy
import math

import numpy as np
import pytest

from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve


def tweezer(**particle):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"].update(particle)
    return s


def slope_at_equilibrium(curve, eq):
    """-dF/ds at the equilibrium, from the two samples either side of it."""
    s = np.asarray(curve["position"]) - np.dot(eq, curve["axis"])
    f = np.asarray(curve["force"])
    i = int(np.argmin(np.abs(s)))
    return -(f[i + 1] - f[i - 1]) / (s[i + 1] - s[i - 1])


def test_curves_run_along_the_eigen_axes_through_the_equilibrium():
    r = solve(DEFAULT_SETUP, want=["curves"])
    eq = np.asarray(r["equilibrium"])
    assert set(r["curves"]) == {"x", "y", "z"}
    for m in r["modes"]:
        c = r["curves"][m["name"]]
        assert c["axis"] == pytest.approx(m["axis"])
        assert len(c["position"]) == len(c["force"])
        # the force vanishes at the equilibrium, and its slope there is the stiffness
        s = np.asarray(c["position"]) - eq @ np.asarray(c["axis"])
        assert np.interp(0.0, s, c["force"]) == pytest.approx(0.0, abs=1e-3 * max(np.abs(c["force"])))
        assert slope_at_equilibrium(c, eq) == pytest.approx(m["stiffness"], rel=0.03)
    assert "dipole" not in r["curves"]["x"]


def test_a_tilted_beam_has_tilted_curves():
    s = copy.deepcopy(DEFAULT_SETUP)
    t = math.radians(20)
    s["trap"]["fields"][0]["direction"] = [0.0, math.sin(t), math.cos(t)]
    r = solve(s, want=["curves"])
    eq = np.asarray(r["equilibrium"])
    beam_axis = next(m for m in r["modes"] if m["name"] == "z")
    assert abs(np.dot(beam_axis["axis"], [0, math.sin(t), math.cos(t)])) == pytest.approx(1, abs=1e-3)
    for m in r["modes"]:
        c = r["curves"][m["name"]]
        assert c["axis"] == pytest.approx(m["axis"])
        assert slope_at_equilibrium(c, eq) == pytest.approx(m["stiffness"], rel=0.03)


def test_the_dipole_curve_matches_mie_for_a_small_sphere_and_not_for_a_large_one():
    def worst(radius):
        r = solve(tweezer(radius=radius), want=["dipole"])
        out = 0.0
        for c in r["curves"].values():
            f, d = np.asarray(c["force"]), np.asarray(c["dipole"])
            out = max(out, np.max(np.abs(f - d)) / np.max(np.abs(f)))
        return out

    assert worst(20e-9) < 0.01  # x = 0.12: Rayleigh
    assert worst(300e-9) > 0.2  # x = 1.8: Mie theory matters


def test_a_paul_trap_alone_has_curves_but_no_dipole():
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["charge"] = 30
    s["trap"]["fields"] = [{"kind": "paul", "geometry": "linear", "rf_voltage": 300, "rf_frequency": 5e3,
                            "endcap_voltage": 5, "r0": 1e-3, "z0": 2e-3}]
    r = solve(s, want=["dipole"])
    assert set(r["curves"]) == {"x", "y", "z"}
    assert all("dipole" not in c for c in r["curves"].values())
