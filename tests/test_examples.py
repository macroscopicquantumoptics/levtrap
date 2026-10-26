"""M4: ported tests/testExamples.m (testCube is out of scope: non-spherical)."""

import numpy as np
import pytest

from levtrap.bsc import BscPmGauss
from levtrap.force import forcetorque
from levtrap.tmatrix import TmatrixMie
from levtrap.traps import axial_equilibrium, find_equilibrium


def test_axial_equilibrium():
    n_medium, n_particle = 1.34, 1.59
    wl = 1064.0e-9
    radius = 1.5 * wl / n_medium
    beam = BscPmGauss(angle_deg=50, polarisation=(1, 0), index_medium=n_medium,
                      wavelength0=wl, power=1.0)
    T = TmatrixMie(radius, index_medium=n_medium, index_particle=n_particle, wavelength0=wl)
    z, kz = axial_equilibrium(T, beam)
    beam = beam.translate_z(z)
    beam, _ = beam.rotate_y(np.pi / 2)
    x, kx = axial_equilibrium(T, beam)
    assert abs(x - 0.0) < 1e-9
    assert kx == pytest.approx(-2.450214062064871e05, rel=0.01)
    assert abs(z - 4.023474767793779e-07) < 1e-9
    assert kz == pytest.approx(-6.258368435930368e04, rel=0.01)


FR_TARGET = [
    [0.000044433787344, 0.000083238173655, 0.000273170525965, 0.000730342126549,
     0.001386727616596, 0.006564585296498, 0.028535350073358, 0.131448283401034,
     0.067949468062682, 0.001883673983584, 0.001883673983584, 0.067949468062682,
     0.131448283401034, 0.028535350073358, 0.006564585296498, 0.001386727616596,
     0.000730342126549, 0.000273170525965, 0.000083238173655, 0.000044433787344],
    [0.004701026373629, 0.008546824420202, 0.014118834900474, 0.020515811480778,
     0.023190400451052, 0.015981070354735, 0.000737396239011, -0.009038328405627,
     -0.010507385325924, -0.003761950950816, -0.003761950950816, -0.010507385325924,
     -0.009038328405627, 0.000737396239011, 0.015981070354735, 0.023190400451052,
     0.020515811480778, 0.014118834900474, 0.008546824420203, 0.004701026373629],
    [0.000010117098003, 0.000041306173553, 0.000091951242659, 0.000910668824001,
     0.005802261157539, 0.007680208357796, 0.017103312085298, 0.028525744768119,
     0.019069772279068, 0.009485957013539, 0.009485957013539, 0.019069772279068,
     0.028525744768119, 0.017103312085298, 0.007680208357793, 0.005802261157539,
     0.000910668824001, 0.000091951242659, 0.000041306173553, 0.000010117098003],
]


@pytest.fixture(scope="module")
def sphere_setup():
    n_medium, n_particle = 1.33, 1.59
    wl0 = 1064e-9
    wlm = wl0 / n_medium
    T = TmatrixMie(1.0 * wlm, wavelength0=wl0, index_medium=n_medium, index_particle=n_particle)
    NA = 1.02
    angle = np.arcsin(NA / n_medium)
    beams = [
        BscPmGauss(NA=NA, polarisation=(1, 1j), index_medium=n_medium, wavelength0=wl0),
        BscPmGauss("lg", (0, 3), polarisation=(1, 1j), angle=angle, index_medium=n_medium, wavelength0=wl0),
        BscPmGauss("hg", (2, 3), polarisation=(1, 1j), angle=angle, index_medium=n_medium, wavelength0=wl0),
    ]
    return T, beams, wlm


@pytest.mark.parametrize("ii", [0, 1, 2], ids=["gaussian", "lg03", "hg23"])
def test_sphere(sphere_setup, ii):
    T, beams, wlm = sphere_setup
    warning_status = [False, False, True]
    beam = beams[ii].with_power(1.0)
    npts = 20
    z = np.array([[0], [0], [1]]) * np.linspace(-8, 8, npts) * wlm
    fz = forcetorque(beam, T, position=z)[0]
    zeq = find_equilibrium(z[2], fz[2])
    assert (zeq.size == 0) == warning_status[ii]
    zeq = 0.0 if zeq.size == 0 else zeq[0]
    r = np.array([[1], [0], [0]]) * np.linspace(-4, 4, npts) * wlm + np.array([[0], [0], [zeq]])
    fr = forcetorque(beam, T, position=r)[0]
    np.testing.assert_allclose(fr[2], FR_TARGET[ii], rtol=0.01)
