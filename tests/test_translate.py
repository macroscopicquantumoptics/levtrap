"""Ported tests/utils/testTranslateZ.m and testWignerRotationMatrix.m."""

import numpy as np
from scipy import sparse

from levtrap.bsc import BscPmGauss
from levtrap.special import combined_index, rotx, rotz
from levtrap.translate import translate_z, wigner_rotation_matrix


def dense(x):
    return x.toarray() if sparse.issparse(x) else np.asarray(x)


def test_translate_z_values():
    tol = 1e-3
    Aeye, Beye = translate_z(5, 0.0)
    sz = int(combined_index(5, 5))
    assert Aeye.shape == (sz, sz)
    np.testing.assert_allclose(dense(Aeye), np.eye(sz), atol=tol)
    np.testing.assert_allclose(dense(Beye), np.zeros((sz, sz)), atol=tol)
    A, B = translate_z(5, np.pi / 2)
    targetA = np.zeros(sz, dtype=complex)
    targetA[np.array([1, 5, 11, 19, 29]) - 1] = [-0.0786, 0.1411, 0.1964, -0.0217, -0.2398]
    np.testing.assert_allclose(dense(A)[0], targetA, atol=tol)
    targetB = np.zeros(sz, dtype=complex)
    targetB[np.array([1, 5, 11, 19, 29]) - 1] = [-0.1306j, -0.1357j, 0.1181j, 0.2770j, 0.1312j]
    np.testing.assert_allclose(dense(B)[0], targetB, atol=tol)


def _check_different_nmax(dz):
    tol = 1e-3
    Afull, Bfull = (dense(x) for x in translate_z(7, dz))
    sz1 = int(combined_index(5, 5))
    sz2 = int(combined_index(7, 7))
    A, B = (dense(x) for x in translate_z([5, 7], dz))
    assert A.shape == (sz1, sz2)
    np.testing.assert_allclose(A, Afull[:sz1, :sz2], atol=tol)
    np.testing.assert_allclose(B, Bfull[:sz1, :sz2], atol=tol)
    A, B = (dense(x) for x in translate_z([7, 5], dz))
    assert A.shape == (sz2, sz1)
    np.testing.assert_allclose(A, Afull[:sz2, :sz1], atol=tol)
    np.testing.assert_allclose(B, Bfull[:sz2, :sz1], atol=tol)


def test_translate_z_different_nmax():
    _check_different_nmax(np.pi / 2)


def test_translate_z_negative_different_nmax():
    _check_different_nmax(-np.pi / 2)


def test_large_translations():
    beam = BscPmGauss().with_power(1.0)
    tbeam = beam.translate_xyz([300, 0, 0])
    assert abs(tbeam.power) < 1e-6


def test_negative_translations():
    # OTT also checks method 'videen'; only the default 'gumerov' is ported.
    A1, B1 = (dense(x) for x in translate_z(1, 1e-6))
    A2, B2 = (dense(x) for x in translate_z(1, -1e-6))
    C1 = np.block([[A1, B1], [B1, A1]])
    C2 = np.block([[A2, B2], [B2, A2]])
    np.testing.assert_allclose(C1 @ C2, np.eye(C1.shape[0]), atol=1e-5)


def test_wigner_eye():
    tol = 1e-6
    np.testing.assert_allclose(dense(wigner_rotation_matrix(1, np.eye(3))), np.eye(3), atol=tol)
    for nmax in (2, 20):
        n = int(combined_index(nmax, nmax))
        np.testing.assert_allclose(dense(wigner_rotation_matrix(nmax, np.eye(3))), np.eye(n), atol=tol)


def test_wigner_arbitrary_value():
    tol = 1e-4
    n1 = np.array([[0.8788 - 0.2855j, 0.1158 + 0.3564j, -0.0723 + 0.0235j],
                   [0.0000 + 0.3747j, 0.8480 + 0.0000j, 0.0000 + 0.3747j],
                   [-0.0723 - 0.0235j, -0.1158 + 0.3564j, 0.8788 + 0.2855j]])
    n2 = np.array([
        [0.6908 - 0.5019j, 0.2878 + 0.3961j, -0.1391 + 0.1011j, -0.0237 - 0.0326j, 0.0047 - 0.0034j],
        [0.1513 + 0.4657j, 0.6117 - 0.1988j, 0.1701 + 0.5235j, -0.1948 + 0.0633j, -0.0124 - 0.0383j],
        [-0.1720 + 0.0000j, 0.0000 + 0.5504j, 0.5788 + 0.0000j, 0.0000 + 0.5504j, -0.1720 + 0.0000j],
        [0.0124 - 0.0383j, -0.1948 - 0.0633j, -0.1701 + 0.5235j, 0.6117 + 0.1988j, -0.1513 + 0.4657j],
        [0.0047 + 0.0034j, 0.0237 - 0.0326j, -0.1391 - 0.1011j, -0.2878 + 0.3961j, 0.6908 + 0.5019j]])
    n3 = np.array([
        [0.4637 - 0.6383j, 0.4483 + 0.3257j, -0.1477 + 0.2033j, -0.0673 - 0.0489j, 0.0121 - 0.0167j, 0.0030 + 0.0022j, -0.0003 + 0.0004j],
        [0.3257 + 0.4483j, 0.3759 - 0.2731j, 0.3513 + 0.4836j, -0.2638 + 0.1917j, -0.0663 - 0.0913j, 0.0212 - 0.0154j, 0.0022 + 0.0030j],
        [-0.2389 + 0.0776j, 0.1847 + 0.5685j, 0.2872 - 0.0933j, 0.1841 + 0.5665j, -0.3300 + 0.1072j, -0.0349 - 0.1073j, 0.0196 - 0.0064j],
        [0.0000 - 0.0832j, -0.3261 + 0.0000j, 0.0000 + 0.5957j, 0.2527 + 0.0000j, 0.0000 + 0.5957j, -0.3261 + 0.0000j, 0.0000 - 0.0832j],
        [0.0196 + 0.0064j, 0.0349 - 0.1073j, -0.3300 - 0.1072j, -0.1841 + 0.5665j, 0.2872 + 0.0933j, -0.1847 + 0.5685j, -0.2389 - 0.0776j],
        [-0.0022 + 0.0030j, 0.0212 + 0.0154j, 0.0663 - 0.0913j, -0.2638 - 0.1917j, -0.3513 + 0.4836j, 0.3759 + 0.2731j, -0.3257 + 0.4483j],
        [-0.0003 - 0.0004j, -0.0030 + 0.0022j, 0.0121 + 0.0167j, 0.0673 - 0.0489j, -0.1477 - 0.2033j, -0.4483 + 0.3257j, 0.4637 + 0.6383j]])
    val = dense(wigner_rotation_matrix(3, rotx(32) @ rotz(18)))
    np.testing.assert_allclose(val[0:3, 0:3], n1, atol=tol)
    np.testing.assert_allclose(val[3:8, 3:8], n2, atol=tol)
    np.testing.assert_allclose(val[8:, 8:], n3, atol=tol)
