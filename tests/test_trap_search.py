"""#59: the trap search finds traps the first seed misses.

The first search (``_seed`` + Newton in the box ``solve`` gives it) is
unchanged; only when it finds no stable trap does the fallback try every
restoring zero on the three lines of a box twice as large, nearest first.
"""

import copy

import numpy as np
import pytest

from levtrap.fields import ModelInfo
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve
from levtrap.solver import WIDER, find_trap

MASS = 1e-17  # kg
BOX = (1.5e-6, 1.5e-6, 3e-6)  # the box solve() searches first for a beam along z


class GaussianWell:
    """U = -U0 exp(-|r - c|^2 / (2 w^2)): one stable equilibrium, at c."""
    kind = "test"

    def __init__(self, U0, w, c):
        self.U0, self.w, self.length_scale = U0, w, w
        self.c = np.asarray(c, dtype=float)

    def force(self, r):
        d = np.atleast_2d(r) - self.c
        return -self.U0 / self.w**2 * d * np.exp(-np.sum(d**2, 1) / (2 * self.w**2))[:, None]

    def model(self):
        return ModelInfo("exact")


def test_a_trap_the_first_search_finds_is_kept_as_it_was():
    t = find_trap([GaussianWell(1e-20, 0.5e-6, (0, 0, 1e-6))], MASS, ranges=BOX)
    assert t.stable and not t.wider
    np.testing.assert_allclose(t.equilibrium, [0, 0, 1e-6], atol=1e-15)


def test_a_trap_beyond_the_first_box_is_found_in_the_wider_one():
    c = (0, 0, 4.5e-6)  # beyond 3 um along z, within twice that
    t = find_trap([GaussianWell(1e-20, 0.5e-6, c)], MASS, ranges=BOX)
    assert t.stable and t.wider
    np.testing.assert_allclose(t.equilibrium, c, atol=1e-15)
    # beyond the wider box too: no trap, and the first search's answer stands
    far = find_trap([GaussianWell(1e-20, 0.5e-6, (0, 0, (WIDER + 0.5) * 3e-6))], MASS, ranges=BOX)
    assert not far.stable and not far.wider


def test_a_trap_off_the_first_seed_line_is_found_from_another_line():
    """A narrow well beside the z axis: the z line's zero (0, 0, 0.2 um) lies
    2.5 widths to the side of it, beyond its inflection, so Newton from there
    leaves; the x line's zero (1 um, 0, 0) is half a width from it."""
    c = (1.0e-6, 0, 0.2e-6)
    t = find_trap([GaussianWell(1e-20, 0.4e-6, c)], MASS, ranges=BOX)
    assert t.stable and t.wider
    np.testing.assert_allclose(t.equilibrium, c, atol=1e-15)


# --- the two cases of the issue, on the real lens ---------------------------------------------

def asphere(tilt_y, diameter, wavelength, power, particle=None):
    s = copy.deepcopy(DEFAULT_SETUP)
    if particle:
        s["particle"] = dict(particle)
    s["trap"]["fields"][0].update(wavelength=wavelength, power=power,
                                  focus=dict(kind="asphere", beam_diameter=diameter, tilt_deg=[0.0, tilt_y],
                                             decentre=[0.0, 0.0]))
    return s


def test_the_5mm_beam_at_1550nm_traps_beyond_3um_without_a_start():
    """It traps 3.16 um upstream of the focus (the old page found it on its
    axis scan); the first search covers 3 um."""
    s = asphere(0.0, 5e-3, 1.55e-6, 0.5, particle=dict(radius=100e-9, n=1.444, k=0, density=2200))
    r = solve(s)
    assert r["stable"]
    assert r["equilibrium"][2] == pytest.approx(-3.1635e-6, abs=1e-9)
    # the trap a start at -3 um follows (#50) is this one
    followed = solve(s, start=[0.0, 0.0, -3.0e-6])
    np.testing.assert_allclose(followed["equilibrium"], r["equilibrium"], atol=1e-12)


def test_the_tilted_tweezer_finds_the_trap_beside_the_axis():
    """The default tweezer on the asphere, tilted 0.333 degrees: the trap near
    the axis (0.03, 0, -0.31) um at 0.3 degrees has vanished by 0.31 degrees,
    but a stable trap 1.5 um to the side, there from 0.3 degrees on, remains;
    the first seed (on the z line) cannot reach it."""
    s = asphere(0.333, 5e-3, 1.064e-6, DEFAULT_SETUP["trap"]["fields"][0]["power"])
    r = solve(s)
    assert r["stable"]
    np.testing.assert_allclose(np.asarray(r["equilibrium"]) * 1e6, [-1.485, 0.0, -0.735], atol=2e-3)
    assert all(m["frequency"] for m in r["modes"])
    # an equilibrium indeed: following it from itself does not jump, and lands on it
    again = solve(s, start=r["equilibrium"])
    assert again["followed"]["jumped"] is False
    np.testing.assert_allclose(again["equilibrium"], r["equilibrium"], atol=1e-12)
