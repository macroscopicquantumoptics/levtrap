"""M4: ported tests/testForceTorque.m."""

import numpy as np
import pytest
from scipy import sparse

from levtrap.bsc import BscPlane, BscPmGauss
from levtrap.force import forcetorque, forcetorque_beams
from levtrap.special import combined_index, roty, rotz
from levtrap.tmatrix import Tmatrix, TmatrixMie


@pytest.fixture(scope="module")
def data():
    return dict(beam=BscPmGauss(power=1.0), T=TmatrixMie(1.0, index_relative=1.2),
                Tnocont=TmatrixMie(1.0, index_relative=1.0))


def test_simple(data):
    s, _ = data["beam"].scatter(data["T"])
    f, t, _ = forcetorque_beams(data["beam"], s)
    assert f.shape == (3, 1)


def test_uneven_nmax(data):
    beam, T0 = data["beam"], data["T"]
    T = T0.set_Nmax([beam.Nmax + 2, beam.Nmax + 1])
    f0 = forcetorque(beam, T0)[0]
    f1 = forcetorque(beam, T)[0]
    f2 = forcetorque(beam, [T, T])[0]
    np.testing.assert_allclose(f1, f0, atol=1e-6)
    np.testing.assert_allclose(f2[:3], f0, atol=1e-6)
    np.testing.assert_allclose(f2[3:], f0, atol=1e-6)


def test_large_particles(data):
    beam, T0 = data["beam"], data["T"]
    T = T0.set_Nmax(beam.Nmax + 2)
    f0 = forcetorque(beam, T0)[0]
    np.testing.assert_allclose(forcetorque(beam, T)[0], f0, atol=1e-6)
    f2 = forcetorque(beam, [T, T])[0]
    np.testing.assert_allclose(f2[:3], f0, atol=1e-6)
    np.testing.assert_allclose(f2[3:], f0, atol=1e-6)


def test_multi_particle(data):
    beam, T = data["beam"], data["T"]
    T1 = TmatrixMie(0.8, index_relative=1.2)
    f = forcetorque(beam, [T, T1])[0]
    np.testing.assert_allclose(forcetorque(beam, T)[0], f[:3], atol=1e-6)
    np.testing.assert_allclose(forcetorque(beam, T1)[0], f[3:], atol=1e-6)


def test_plane_wave(data):
    Nmax = 12
    beam = BscPlane(0.0, 0.0, Nmax=Nmax, polarisation=(1, -1j)).with_power(1.0)
    rng = np.random.default_rng(42)
    R = np.hstack([rotz(rng.random() * 360) @ roty(rng.random() * 180) for _ in range(10)])
    f, _, _ = forcetorque(beam, data["Tnocont"], rotation=R)
    np.testing.assert_allclose(np.linalg.norm(f, axis=0), 0, atol=1e-3)
    T = Tmatrix(-0.5 * sparse.eye(2 * int(combined_index(Nmax, Nmax))), "scattered")
    f, t, s = forcetorque(beam, T, rotation=R)
    np.testing.assert_allclose(np.linalg.norm(f, axis=0), 0.9231, atol=1e-3)
    np.testing.assert_allclose(np.linalg.norm(t, axis=0), 1.0, atol=1e-3)
    np.testing.assert_allclose(np.linalg.norm(s, axis=0), 0.9231, atol=1e-3)


def test_multi_beam(data):
    tol = 1e-6
    T, beam = data["T"], data["beam"]
    pbeam = beam.append(beam.translate_z(np.pi / 2))
    assert pbeam.Nbeams == 2 and pbeam.Nmax == beam.Nmax
    sbeam, _ = pbeam.scatter(T)
    assert sbeam.Nbeams == 2
    assert sbeam.Nmax == min(T.Nmax[0], beam.Nmax)
    pos = np.array([[0, 0, 0], [0, 0, np.pi / 2]]).T
    f = forcetorque(beam, T, position=pos)[0]
    f1 = forcetorque_beams(pbeam.beam(0), sbeam.beam(0))[0][:, 0]
    f2 = forcetorque_beams(pbeam.beam(1), sbeam.beam(1))[0][:, 0]
    assert f.shape == (3, 2)
    np.testing.assert_allclose(f[:, 0], f1, atol=tol)
    np.testing.assert_allclose(f[:, 1], f2, atol=tol)
    f = forcetorque_beams(pbeam, sbeam)[0]
    np.testing.assert_allclose(f[:, 0], f1, atol=tol)
    np.testing.assert_allclose(f[:, 1], f2, atol=tol)
    f = forcetorque(pbeam, T, position=pos)[0]
    assert f.shape == (3, 2, 2)
    b3 = pbeam.beam(0).translate_z(np.pi / 2)
    b4 = pbeam.beam(1).translate_z(np.pi / 2)
    f3 = forcetorque_beams(b3, b3.scatter(T)[0])[0][:, 0]
    f4 = forcetorque_beams(b4, b4.scatter(T)[0])[0][:, 0]
    # MATLAB column-major f(1:3), f(4:6), f(7:9), f(10:12)
    flat = f.reshape(3, -1, order="F")
    np.testing.assert_allclose(flat[:, 0], f1, atol=tol)
    np.testing.assert_allclose(flat[:, 1], f2, atol=tol)
    np.testing.assert_allclose(flat[:, 2], f3, atol=tol)
    np.testing.assert_allclose(flat[:, 3], f4, atol=tol)


def test_coherent(data):
    # OTT 1.5.9's test calls Bsc.mergeBeams (added in OTT 1.6); here it is
    # the coherent column sum.
    T, beam = data["T"], data["beam"]
    pbeam = beam.append(beam.translate_z(np.pi / 2))
    pos = np.array([[0, 0, 0], [0, 0, np.pi / 2]]).T
    f = forcetorque(pbeam, T, position=pos, coherent=True)[0]
    b1 = pbeam.merge_beams()
    b2 = pbeam.translate_z(np.pi / 2).merge_beams()
    f1 = forcetorque(b1, T)[0]
    f2 = forcetorque(b2, T)[0]
    np.testing.assert_allclose(f.ravel(order="F"), np.concatenate([f1, f2]), atol=1e-6)
