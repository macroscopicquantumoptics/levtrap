"""#70: levtrap's filled objective against an independent Richards-Wolf focus.

Both tweezer papers levtrap is compared with (Jain 2016, #61; Zheng 2020,
#70) find the axial frequency softer, against the transverse, than levtrap's
ideal NA 0.9 objective. This pins down that the ideal objective itself is
right: the Debye (Richards-Wolf) integral of an aplanatic lens, x-polarised,
its pupil filled by a Gaussian of 1/e^2 radius ``filling`` x the aperture
radius, written out here from the textbook expressions (Novotny & Hecht,
Principles of Nano-Optics, Sec. 3.6) and integrated directly, gives the
focal intensity levtrap's beam carries (``focus.filling``, #63: the
vector-spherical-wave expansion of the same far field).

The gap to the papers is then the real objective; docs/validation/focus.md.
"""

import copy

import numpy as np
import pytest
from scipy.integrate import trapezoid
from scipy.special import jv

from levtrap.api import _single_beam
from levtrap.setup import DEFAULT_SETUP, parse

WL = 1.064e-6
K = 2 * np.pi / WL
NA = 0.9


def richards_wolf(points, filling, spherical_waves=0.0):
    """E (up to one constant) at ``points`` [m] near the focus. ``spherical_waves``:
    rms primary spherical aberration of the pupil, Zernike-normalised, in waves."""
    t = np.linspace(0, np.arcsin(NA), 3000)
    s, c = np.sin(t), np.cos(t)
    pupil = np.exp(-(s / (filling * NA)) ** 2) * np.sqrt(c)  # Gaussian fill, aplanatic apodisation
    r = s / NA
    pupil = pupil * np.exp(2j * np.pi * spherical_waves * np.sqrt(5) * (6 * r**4 - 6 * r**2 + 1))
    out = []
    for x, y, z in points:
        rho, phi = np.hypot(x, y), np.arctan2(y, x)
        e = pupil * np.exp(1j * K * z * c)
        i0 = trapezoid(e * s * (1 + c) * jv(0, K * rho * s), t)
        i1 = trapezoid(e * s**2 * jv(1, K * rho * s), t)
        i2 = trapezoid(e * s * (1 - c) * jv(2, K * rho * s), t)
        out.append([i0 + i2 * np.cos(2 * phi), i2 * np.sin(2 * phi), -2j * i1 * np.cos(phi)])
    return np.array(out)


def levtrap_beam(filling):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["trap"]["fields"][0].update(wavelength=WL, focus={"kind": "lens", "NA": NA, "filling": filling})
    return _single_beam(parse(s)["trap"]["fields"][0], 1.0)


def intensity(E):
    return np.sum(np.abs(E) ** 2, axis=1)


def axes_points(reach=0.6e-6, n=13):
    u = np.linspace(-reach, reach, n)
    zero = 0 * u
    return np.concatenate([np.stack([u, zero, zero], 1), np.stack([zero, u, zero], 1),
                           np.stack([zero, zero, 2 * u], 1), np.stack([u, u, u], 1) / np.sqrt(3)])


def curvature_ratios(field, h=20e-9):
    """sqrt of the intensity curvature ratios at the focus: f_y/f_x and f_y/f_z of a dipole there."""
    p = np.array([[0, 0, 0], [h, 0, 0], [-h, 0, 0], [0, h, 0], [0, -h, 0], [0, 0, h], [0, 0, -h]])
    I = intensity(field(p))
    cx, cy, cz = (2 * I[0] - I[1] - I[2], 2 * I[0] - I[3] - I[4], 2 * I[0] - I[5] - I[6])
    return np.sqrt(cy / cx), np.sqrt(cy / cz)


@pytest.mark.parametrize("filling", [0.7, 1.25])
def test_the_filled_objective_is_the_richards_wolf_focus(filling):
    pts = axes_points()
    I_rw = intensity(richards_wolf(pts, filling))
    I_lt = intensity(levtrap_beam(filling).em_field_xyz(pts))
    # the same focal intensity, to a constant, over the whole focal volume
    scale = I_lt.max() / I_rw.max()
    np.testing.assert_allclose(I_lt, scale * I_rw, atol=2e-4 * I_lt.max())
    # and the same dipole frequency ratios
    np.testing.assert_allclose(curvature_ratios(levtrap_beam(filling).em_field_xyz),
                               curvature_ratios(lambda p: richards_wolf(p, filling)), rtol=1e-3)


def test_the_ideal_objective_gives_the_ratios_levtrap_reports():
    """Zheng's objective (filling 1.25): f_y/f_x 1.311 and f_y/f_z 2.879 in the dipole
    limit (levtrap's 75 nm sphere: 1.302, 2.859). Measured: 1.27 and 3.07."""
    yx, yz = curvature_ratios(lambda p: richards_wolf(p, 1.25))
    assert yx == pytest.approx(1.311, abs=2e-3)
    assert yz == pytest.approx(2.879, abs=2e-3)


def test_spherical_aberration_softens_the_axis():
    """A real objective is not ideal: a little primary spherical aberration
    lowers the axial curvature far more than the transverse ones. About 0.08 to
    0.09 waves rms (near the Marechal limit, 0.07) brings f_y/f_z to the measured
    3.07 for Zheng's objective; docs/validation/focus.md."""
    ideal = curvature_ratios(lambda p: richards_wolf(p, 1.25))
    # the intensity maximum moves off the paraxial focus with the aberration: follow it along z
    def ratios_at_peak(w):
        zs = np.linspace(-150e-9, 150e-9, 61)
        I = intensity(richards_wolf(np.stack([0 * zs, 0 * zs, zs], 1), 1.25, w))
        z0 = zs[int(np.argmax(I))]
        return curvature_ratios(lambda p: richards_wolf(np.asarray(p) + [0, 0, z0], 1.25, w))
    aberrated = ratios_at_peak(0.09)
    assert aberrated[1] == pytest.approx(3.07, rel=0.01)
    assert abs(aberrated[0] / ideal[0] - 1) < 0.02  # the transverse ratio hardly moves
