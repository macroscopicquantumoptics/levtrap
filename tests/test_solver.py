"""A2: the generic solver on analytic fields (exact references)."""

import math

import numpy as np
import pytest

from levtrap.fields import GravityField, ModelInfo, total_force
from levtrap.solver import find_trap
from levtrap.special import rotation_matrix

MASS = 1e-17  # kg
G = 9.81


class Harmonic:
    """F = -K (r - r0): exact equilibrium r0, stiffness matrix K."""
    kind = "test"

    def __init__(self, K, r0=(0, 0, 0), length_scale=1e-6):
        self.K = np.asarray(K, dtype=float)
        self.r0 = np.asarray(r0, dtype=float)
        self.length_scale = length_scale

    def force(self, r):
        return -(np.atleast_2d(r) - self.r0) @ self.K.T

    def model(self):
        return ModelInfo("exact")


class GaussianWell:
    """U = -U0 exp(-|r|^2 / (2 w^2)): depth U0 along every axis."""
    kind = "test"

    def __init__(self, U0, w):
        self.U0, self.w, self.length_scale = U0, w, w

    def force(self, r):
        r = np.atleast_2d(r)
        return -self.U0 / self.w**2 * r * np.exp(-np.sum(r**2, 1) / (2 * self.w**2))[:, None]

    def model(self):
        return ModelInfo("exact")


def rotated(k_diag, angles):
    R = rotation_matrix([0, 0, 1], angles[0]) @ rotation_matrix([0, 1, 0], angles[1])
    return R @ np.diag(k_diag) @ R.T, R


def test_rotated_harmonic_well():
    k = np.array([1e-6, 4e-6, 9e-6])
    K, R = rotated(k, (0.4, 0.3))
    t = find_trap([Harmonic(K, r0=(1e-7, -2e-7, 3e-7))], MASS)
    assert t.stable and t.converged
    np.testing.assert_allclose(t.equilibrium, [1e-7, -2e-7, 3e-7], atol=1e-15)
    got = sorted(t.modes, key=lambda m: m["stiffness"])
    for i, m in enumerate(got):
        assert m["stiffness"] == pytest.approx(k[i], rel=1e-6)
        assert m["frequency"] == pytest.approx(math.sqrt(k[i] / MASS) / (2 * math.pi), rel=1e-6)
        assert abs(abs(m["axis"] @ R[:, i]) - 1) < 1e-6  # eigen-axis recovered
    assert t.warnings == []


def test_harmonic_plus_gravity_sags_by_g_over_omega_squared():
    k = np.array([2e-6, 3e-6, 1e-6])
    fields = [Harmonic(np.diag(k)), GravityField(MASS, (0, -G, 0))]
    t = find_trap(fields, MASS)
    assert t.stable
    Omega_y2 = k[1] / MASS
    assert t.equilibrium[1] == pytest.approx(-G / Omega_y2, rel=1e-6)
    assert abs(t.equilibrium[0]) < 1e-15 and abs(t.equilibrium[2]) < 1e-15
    # gravity is uniform: it shifts the trap but not its stiffness
    assert {m["name"]: m["stiffness"] for m in t.modes}["y"] == pytest.approx(k[1], rel=1e-6)
    np.testing.assert_allclose(total_force(fields, t.equilibrium)[0], 0, atol=1e-20)


def test_gaussian_well_depth():
    U0, w = 1e-19, 0.5e-6
    t = find_trap([GaussianWell(U0, w)], MASS, ranges=(4 * w, 4 * w, 4 * w), points=401)
    assert t.stable
    for m in t.modes:
        assert m["stiffness"] == pytest.approx(U0 / w**2, rel=1e-4)
        assert m["depth"] == pytest.approx(U0, rel=1e-3)  # trapezoid on 401 points, edge at 4 w
        assert m["bounded"] is False  # the barrier is at infinity: a lower bound


def test_saddle_is_not_stable():
    t = find_trap([Harmonic(np.diag([1e-6, -1e-6, 2e-6]))], MASS)
    assert t.converged and not t.stable
    m = {m["name"]: m for m in t.modes}
    assert m["y"]["frequency"] is None and m["y"]["depth"] == 0


def test_no_restoring_force_found():
    t = find_trap([Harmonic(-np.eye(3) * 1e-6)], MASS)  # pure anti-trap
    assert not t.stable and t.equilibrium is None


def test_uniform_force_alone_cannot_trap():
    with pytest.raises(ValueError):
        find_trap([GravityField(MASS)], MASS)


def test_nonconservative_force_is_flagged():
    K = np.diag([1e-6, 1e-6, 1e-6])
    K[0, 1], K[1, 0] = 0.2e-6, -0.2e-6  # curl: a rotational force
    t = find_trap([Harmonic(K)], MASS)
    assert any("not conservative" in w for w in t.warnings)
