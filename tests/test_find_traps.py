"""M4: ported tests/testFindTraps.m."""

import numpy as np
import pytest

from levtrap.traps import find_traps

T1 = 1e-2


def lin(a, b, n=100):
    x = np.linspace(a, b, n)
    return x[1:-1]


def test_one_sinusoid():
    x = lin(-1, 1)
    traps = find_traps(x, -2 * np.sin(np.pi * x))
    assert len(traps) == 1
    t = traps[0]
    assert t["stiffness"] == pytest.approx(-2 * np.pi, abs=T1)
    assert t["position"] == pytest.approx(0, abs=1e-6)
    assert t["depth"] == pytest.approx(2, abs=T1)
    np.testing.assert_allclose(t["minmax_force"], [2, -2], atol=T1)
    np.testing.assert_allclose(t["minmax_position"], [-0.5, 0.5], atol=T1)
    assert t["range"] == [-np.inf, np.inf]


def test_two_sinusoid():
    x = lin(-2, 2, 200)
    traps = find_traps(x, 2 * np.sin(np.pi * x))
    assert len(traps) == 2
    dy = lambda v: 2 * np.pi * np.cos(np.pi * v)  # noqa: E731
    assert traps[0]["stiffness"] == pytest.approx(dy(-1), abs=T1)
    assert traps[1]["stiffness"] == pytest.approx(dy(1), abs=T1)
    assert traps[0]["position"] == pytest.approx(-1, abs=1e-6)
    assert traps[1]["position"] == pytest.approx(1, abs=1e-6)
    for t in traps:
        assert t["depth"] == pytest.approx(2, abs=T1)
        np.testing.assert_allclose(t["minmax_force"], [2, -2], atol=T1)
    np.testing.assert_allclose(traps[0]["minmax_position"], [-1.5, -0.5], atol=T1)
    np.testing.assert_allclose(traps[1]["minmax_position"], [0.5, 1.5], atol=T1)
    np.testing.assert_allclose(traps[0]["range"], [-np.inf, 0], atol=1e-6)
    np.testing.assert_allclose(traps[1]["range"], [0, np.inf], atol=1e-6)


def test_one_negative_sinusoid():
    x = lin(-1, 1)
    traps = find_traps(x, 2 * np.sin(np.pi * x), keep_unstable=True)
    assert len(traps) == 1
    t = traps[0]
    assert t["stiffness"] == pytest.approx(2 * np.pi, abs=T1)
    assert t["position"] == pytest.approx(0, abs=1e-6)
    assert t["depth"] == pytest.approx(2, abs=T1)
    np.testing.assert_allclose(t["minmax_force"], [-2, 2], atol=T1)
    np.testing.assert_allclose(t["minmax_position"], [-0.5, 0.5], atol=T1)


def test_saw_tooth():
    x = [0, 1, 2, 3, 4]
    y = [1, -1, 1, -1, 1]
    traps = find_traps(x, y, keep_unstable=True)
    assert len(traps) == 4
    np.testing.assert_allclose([t["position"] for t in traps[1:3]], [1.5, 2.5], atol=1e-2)
    traps = find_traps(x, y, keep_unstable=False)
    assert len(traps) == 2
    assert traps[1]["position"] == pytest.approx(2.5, abs=1e-2)


def test_flat_centre_trap():
    y = [0.1, 0.5, 0, 0, -0.5, -0.1]
    x = [-3, -2, -1, 1, 2, 3]
    assert len(find_traps(x, y, keep_unstable=True)) == 1
    traps = find_traps(x, y, keep_unstable=False)
    assert len(traps) == 1
    assert traps[0]["position"] == pytest.approx(0.0, abs=1e-2)


def test_flat_centre_poly3_trap():
    x = np.linspace(-1, 1, 100)
    y = np.polyval([-1, 0, 0, 0], x)
    assert len(find_traps(x, y, keep_unstable=True)) == 1
    traps = find_traps(x, y, keep_unstable=False)
    assert len(traps) == 1
    assert traps[0]["position"] == pytest.approx(0.0, abs=1e-2)
    assert traps[0]["stiffness"] == pytest.approx(0.0, abs=1e-2)


def test_single_trap_group():
    y = [0.1, 1, -1, -0.1]
    x = np.arange(1, len(y) + 1)
    assert len(find_traps(x, y, keep_unstable=True)) == 1
    assert len(find_traps(x, y, keep_unstable=False)) == 1
    assert len(find_traps(x, y, keep_unstable=False, group_stable=True)) == 1


def test_double_trap_group():
    y = [0.1, 1, -1, 0.5, -0.5, 0.3, -2, -1]
    x = np.arange(1, len(y) + 1)
    assert len(find_traps(x, y, keep_unstable=True)) == 5
    assert len(find_traps(x, y, keep_unstable=False)) == 3
    assert len(find_traps(x, y, keep_unstable=False, group_stable=True)) == 1
