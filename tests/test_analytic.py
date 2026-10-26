"""Analytic / self-consistency checks (plan section 5)."""

import numpy as np
import pytest

from levtrap.bsc import BscPmGauss
from levtrap.derived import power_balance, mie_efficiencies
from levtrap.dipole import dipole_force
from levtrap.force import forcetorque
from levtrap.tmatrix import TmatrixMie

WL = 1064e-9


@pytest.fixture(scope="module")
def setup():
    beam = BscPmGauss(NA=0.8, index_medium=1.0, wavelength0=WL, polarisation=(1, 0), power=1.0)
    T = TmatrixMie(150e-9, index_medium=1.0, index_particle=1.45, wavelength0=WL)
    return beam, T


def test_force_linear_in_power(setup):
    beam, T = setup
    pos = np.array([0.1e-6, -0.05e-6, 0.2e-6])
    f1 = forcetorque(beam, T, position=pos)[0]
    f3 = forcetorque(beam.with_power(3.0), T, position=pos)[0]
    np.testing.assert_allclose(f3, 3 * f1, rtol=1e-10, atol=1e-16)


def test_zero_radial_force_on_axis(setup):
    beam, T = setup
    z = np.array([[0, 0, zz] for zz in np.linspace(-1e-6, 1e-6, 5)]).T
    f = forcetorque(beam, T, position=z)[0]
    assert np.max(np.abs(f[:2])) < 1e-10 * np.max(np.abs(f[2]))


def test_convergence_with_nmax(setup):
    beam, T = setup
    pos = np.array([[0.15e-6, 0, 0.1e-6], [0, 0, 0.3e-6]]).T
    f0 = forcetorque(beam, T, position=pos)[0]
    T2 = TmatrixMie(150e-9, index_medium=1.0, index_particle=1.45, wavelength0=WL, Nmax=2 * T.Nmax[0])
    b2 = BscPmGauss(NA=0.8, index_medium=1.0, wavelength0=WL, polarisation=(1, 0), power=1.0,
                    Nmax=2 * beam.Nmax).shrink_Nmax(1e-12)
    f1 = forcetorque(b2, T2, position=pos)[0]
    rel = np.max(np.abs(f1 - f0)) / np.max(np.abs(f0))
    assert rel < 1e-4, rel


def test_small_sphere_dipole_limit():
    r = 20e-9
    m = 1.45
    beam = BscPmGauss(NA=0.8, index_medium=1.0, wavelength0=WL, polarisation=(1, 0), power=1.0)
    T = TmatrixMie(r, index_medium=1.0, index_particle=m, wavelength0=WL)
    pos = np.array([[0, 0, 0.3e-6], [0.2e-6, 0, 0], [0, 0.15e-6, 0.1e-6]])
    fm = forcetorque(beam, T, position=pos.T)[0]
    fd = dipole_force(beam, r, m, pos)
    big = np.abs(fm) > 1e-3 * np.abs(fm).max()
    np.testing.assert_allclose(fd[big], fm[big], rtol=0.03)


def test_beam_power_balance_lossless_and_absorbing():
    beam = BscPmGauss(NA=0.8, index_medium=1.0, wavelength0=WL, power=1.0)
    for m, lossy in ((1.45, False), (1.45 + 0.05j, True)):
        T = TmatrixMie(200e-9, index_medium=1.0, index_particle=m, wavelength0=WL)
        s, _ = beam.scatter(T)
        pb = power_balance(beam, s)
        assert pb["sca"] > 0
        if lossy:
            assert pb["abs"] > 0
        else:
            assert abs(pb["abs"]) < 1e-10


def test_plane_wave_scattered_power_matches_mie():
    from levtrap.bsc import BscPlane
    k = 2 * np.pi
    r = 0.4
    pw = BscPlane(0.0, 0.0, polarisation=(1, 0), Nmax=30, k_medium=k)
    T = TmatrixMie(r, k_medium=k, index_relative=1.5 + 0.02j)
    s, _ = pw.scatter(T)
    pb = power_balance(pw, s)
    E0 = np.sum(np.abs(pw.em_field_xyz(np.zeros((1, 3)))) ** 2)
    I = 4 * k**2 * E0  # intensity per unit OTT power (levtrap.derived)
    eff = mie_efficiencies(r, 1.0, 1.5 + 0.02j)
    sigma = np.pi * r**2
    np.testing.assert_allclose(pb["sca"] * pw.power / I, eff["Qsca"] * sigma, rtol=1e-8)
    np.testing.assert_allclose(pb["abs"] * pw.power / I, eff["Qabs"] * sigma, rtol=1e-8)
