"""M3: ported tests/testBsc.m, testBscPlane.m, testBscPmGauss.m + beam checks."""

import numpy as np
import pytest

from levtrap.bsc import Bsc, BscPlane, BscPmGauss, make_beam_vector


@pytest.fixture(scope="module")
def beam():
    return BscPmGauss().with_power(1.0)


def test_translation_variants(beam):
    dz = np.pi / 2
    t1 = beam.translate_z(dz)
    A, B = beam.translate_z_matrices(dz)
    t2 = beam.apply(np.block([[A.toarray(), B.toarray()], [B.toarray(), A.toarray()]]))
    t3 = beam.translate(A, B)
    for t in (t2, t3):
        np.testing.assert_allclose(t.a, t1.a, atol=1e-6)
        np.testing.assert_allclose(t.b, t1.b, atol=1e-6)


def test_uneven_translation(beam):
    assert beam.translate_z(np.pi / 2, Nmax=beam.Nmax - 5).Nmax == beam.Nmax - 5


def test_translate_xyz_consistency(beam):
    # translating along +x equals rotating the beam, translating along z, rotating back
    d = 0.3
    t1 = beam.translate_xyz([d, 0, 0])
    rb, D = beam.rotate_yz(np.pi / 2, 0.0)
    t2 = rb.translate_z(d).rotate_wigner(D.conj().T)
    np.testing.assert_allclose(t1.a, t2.a, atol=1e-10)


def test_make_beam_vector():
    a, b = make_beam_vector([], [], [], [], 1)
    assert a.shape == (3, 1)
    a = np.array([1, 2, 3.0])
    bb = np.array([4, 5, 6.0])
    nn, mm = [1, 2, 3], [0, 0, 0]
    a1, b1 = make_beam_vector(a, bb, nn, mm)
    a2, b2 = make_beam_vector(a + 6, bb + 6, nn, mm)
    ac, bc = make_beam_vector(np.stack([a, a + 6], 1), np.stack([bb, bb + 6], 1), nn, mm)
    np.testing.assert_array_equal(np.concatenate([ac[:, 0], bc[:, 0]]), np.concatenate([a1[:, 0], b1[:, 0]]))
    np.testing.assert_array_equal(np.concatenate([ac[:, 1], bc[:, 1]]), np.concatenate([a2[:, 0], b2[:, 0]]))


def test_sum():
    b1 = BscPmGauss(polarisation=(0, 1j))
    b2 = BscPmGauss(polarisation=(1, 0))
    b3 = b1 + b2
    bu = b1.append(b2)
    np.testing.assert_allclose(bu.merge_beams().a, b3.a)
    np.testing.assert_allclose(bu.merge_beams().b, b3.b)


def test_plane_construct_and_multiple():
    beam = BscPlane([0.0, np.pi / 4], [0.0, 0.0], radius=1.0)
    assert beam.Nbeams == 2
    assert BscPlane([0.0, np.pi / 4], [0.0, 0.0], Nmax=12).Nmax == 12
    assert beam.translate_z(0.5).Nbeams == 2
    Nmax = 10
    t1, t2, p1, p2 = 0.2 * np.pi / 2, 0.6 * np.pi / 2, 0.1 * np.pi / 2, 0.3 * np.pi / 2
    b1 = BscPlane(t1, p1, Nmax=Nmax)
    b2 = BscPlane(t2, p2, Nmax=Nmax)
    bc = BscPlane([t1, t2], [p1, p2], Nmax=Nmax)
    np.testing.assert_allclose(bc.beam(0).a, b1.a, atol=1e-14)
    np.testing.assert_allclose(bc.beam(1).b, b2.b, atol=1e-14)


def test_plane_wave_field_is_plane_wave():
    k = 2 * np.pi
    pw = BscPlane(0.0, 0.0, polarisation=(1, 0), Nmax=25, k_medium=k)
    z = np.linspace(-0.5, 0.5, 7)
    xyz = np.stack([0.1 * np.ones_like(z), -0.05 * np.ones_like(z), z], 1)
    E = pw.em_field_xyz(xyz)
    # |E0| = 1 and phase exp(-ikz): in OTT, BscPlane(theta=0) travels
    # towards -z (it pushes an absorbing sphere along -z; see test_force)
    np.testing.assert_allclose(np.abs(E[:, 0]), 1, atol=1e-8)
    np.testing.assert_allclose(E[:, 0] / E[0, 0], np.exp(-1j * k * (z - z[0])), atol=1e-8)


def test_lg_mode_errors():
    with pytest.raises(ValueError):
        BscPmGauss("lg", (-2, 0))
    with pytest.raises(ValueError):
        BscPmGauss("lg", (1.5, 0))
    with pytest.raises(ValueError):
        BscPmGauss("lg", (0, 0.5))
    with pytest.raises(ValueError):
        BscPmGauss("lg", (0, 0, 5))
    with pytest.raises(ValueError):
        BscPmGauss("hg", (0, 0, 5))


def test_lg_on_axis_null():
    for l in (1, 2, 3):
        beam = BscPmGauss("lg", (0, l), NA=0.9, index_medium=1.0, wavelength0=1.0, power=1.0)
        g = BscPmGauss("lg", (0, 0), NA=0.9, index_medium=1.0, wavelength0=1.0, power=1.0)
        z = np.array([[0, 0, 0.0], [0, 0, 0.3], [0, 0, -0.4]])
        I = np.sum(np.abs(beam.em_field_xyz(z)) ** 2, 1)
        I0 = np.sum(np.abs(g.em_field_xyz(np.zeros((1, 3)))) ** 2)
        assert np.all(I / I0 < 1e-10), (l, I / I0)
        # and the ring is bright
        xs = np.linspace(0.05, 0.8, 16)
        ring = np.sum(np.abs(beam.em_field_xyz(np.stack([xs, 0 * xs, 0 * xs], 1))) ** 2, 1).max()
        assert ring / I0 > 1e-2


def test_hg_beam_power_and_symmetry():
    # y-polarised HG10: Ey and Ez are odd in x and vanish on the plane x = 0
    # (the weak cross-polarised Ex of a tight focus is even in x)
    beam = BscPmGauss("hg", (1, 0), NA=0.9, index_medium=1.0, wavelength0=1.0, polarisation=(0, 1), power=1.0)
    assert abs(beam.power - 1) < 1e-12
    ys = np.linspace(-0.5, 0.5, 11)
    I_plane = np.sum(np.abs(beam.em_field_xyz(np.stack([0 * ys, ys, 0 * ys], 1))[:, 1:]) ** 2, 1).max()
    xs = np.linspace(0.05, 0.6, 12)
    I_lobe = np.sum(np.abs(beam.em_field_xyz(np.stack([xs, 0 * xs, 0 * xs], 1))) ** 2, 1).max()
    assert I_plane / I_lobe < 1e-8


def test_empty_beam():
    e = Bsc(np.zeros((0, 0)), np.zeros((0, 0)), basis="incoming")
    assert e.shrink_Nmax().a.shape == (0, 0)
