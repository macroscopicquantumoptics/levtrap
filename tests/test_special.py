"""M1: special functions spot-checked against SciPy; small OTT util tests."""

import numpy as np
import pytest
from scipy import special as sp

from levtrap.special import (
    combined_index, ka2nmax, legendrerow, rotation_matrix, rotx, roty, rotz,
    sbesselh1, sbesselh2, sbesselj, spharm,
)
from levtrap.vswf import vswfcart


def test_sbessel_vs_scipy():
    n = np.arange(0, 30)
    x = np.array([1e-3, 0.3, 1.0, 5.5, 20.0, 47.3])
    J = sbesselj(n, x)
    ref = sp.spherical_jn(n[None, :], x[:, None])
    np.testing.assert_allclose(J, ref, rtol=1e-10, atol=1e-300)
    H1 = sbesselh1(n, x[2:])
    refy = sp.spherical_yn(n[None, :], x[2:, None])
    np.testing.assert_allclose(H1, ref[2:] + 1j * refy, rtol=1e-10)
    np.testing.assert_allclose(sbesselh2(n, x[2:]), ref[2:] - 1j * refy, rtol=1e-10)


def test_sbesselj_complex_and_zero():
    z = np.array([2.0 + 0.3j, 7.0 + 0.01j])
    np.testing.assert_allclose(sbesselj([1, 4], z), sp.spherical_jn(np.array([1, 4])[None, :], z[:, None]),
                               rtol=1e-10)
    j0 = sbesselj([0, 1, 2], 0.0)
    np.testing.assert_allclose(j0, [[1.0, 0.0, 0.0]])


def test_sbessel_derivative_form():
    # OTT returns j_{n-1} - n/x j_n = j_n' + j_n/x
    n = np.arange(1, 10)
    x = np.array([0.7, 3.2])
    _, dj = sbesselj(n, x, derivative=True)
    ref = sp.spherical_jn(n[None, :], x[:, None], derivative=True) + sp.spherical_jn(n[None, :], x[:, None]) / x[:, None]
    np.testing.assert_allclose(dj, ref, rtol=1e-10)


@pytest.mark.parametrize("n", [0, 1, 2, 5, 12])
def test_spharm_vs_scipy(n):
    rng = np.random.default_rng(1)
    theta = rng.uniform(0.01, np.pi - 0.01, 7)
    phi = rng.uniform(0, 2 * np.pi, 7)
    m = np.arange(-n, n + 1)
    Y, Yt, Yp = spharm(n, m, theta, phi)
    # scipy: sph_harm_y(n, m, theta, phi) orthonormal with Condon-Shortley phase
    try:
        ref = sp.sph_harm_y(n, m[None, :], theta[:, None], phi[:, None])
    except AttributeError:  # older scipy
        ref = sp.sph_harm(m[None, :], n, phi[:, None], theta[:, None])
    # OTT's harmonics omit the Condon-Shortley phase: Y_OTT = (-1)^m Y_SciPy
    phase = (-1.0) ** m
    np.testing.assert_allclose(Y, ref * phase, atol=1e-12)
    # Yphi = 1/sin(theta) dY/dphi = i m Y / sin(theta)
    if n > 0:
        np.testing.assert_allclose(Yp, 1j * m[None, :] * Y / np.sin(theta)[:, None], atol=1e-10)
        # finite-difference theta derivative
        h = 1e-6
        Yp1 = spharm(n, m, theta + h, phi)[0]
        Ym1 = spharm(n, m, theta - h, phi)[0]
        np.testing.assert_allclose(Yt, (Yp1 - Ym1) / (2 * h), atol=1e-6)


def test_legendrerow_shape():
    assert legendrerow(0, [0.1, 0.2]).shape == (1, 2)
    assert legendrerow(4, [0.1, 0.2, 0.3]).shape == (5, 3)


def test_combined_index_roundtrip():
    ci = np.arange(1, 121)
    n, m = combined_index(ci)
    np.testing.assert_array_equal(combined_index(n, m), ci)
    assert combined_index(3, -3) == 9


def test_ka2nmax():
    # OTT ka2nmax: ceil(ka + 3 ka^(1/3))
    assert ka2nmax(1.0) == 4
    assert ka2nmax(10.0) == int(np.ceil(10 + 3 * 10 ** (1 / 3)))


# --- ported tests/utils/testVswfCart.m ------------------------------------

def test_vswfcart_finite_at_zero():
    M, N = vswfcart(1, 0, 0.0, 0.0, 0.0, "regular")
    assert np.all(np.isfinite(M)) and np.all(np.isfinite(N))


# --- ported tests/utils/testRotations.m ----------------------------------

def test_rotations():
    tol = 1e-4
    rotz45 = np.array([[0.7071, -0.7071, 0], [0.7071, 0.7071, 0], [0, 0, 1.0]])
    roty45 = np.array([[0.7071, 0, 0.7071], [0, 1.0, 0], [-0.7071, 0, 0.7071]])
    rotx45 = np.array([[1.0, 0, 0], [0, 0.7071, -0.7071], [0, 0.7071, 0.7071]])
    np.testing.assert_allclose(rotz(45), rotz45, atol=tol)
    np.testing.assert_allclose(roty(45), roty45, atol=tol)
    np.testing.assert_allclose(rotx(45), rotx45, atol=tol)
    np.testing.assert_allclose(rotz(90), [[0, -1, 0], [1, 0, 0], [0, 0, 1]], atol=tol)
    np.testing.assert_allclose(roty(180), [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], atol=tol)
    np.testing.assert_allclose(rotx(90), [[1, 0, 0], [0, 0, -1], [0, 1, 0]], atol=tol)
    np.testing.assert_allclose(rotation_matrix([0, 0, 1], np.pi / 4), rotz45, atol=tol)
