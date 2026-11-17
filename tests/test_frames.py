"""The fields and the forces of a beam use one frame.

OTT 1.5.9 (and levtrap's port of it until this test was written) reads beam
coefficients two ways: its spherical harmonics (fields, plane waves, point
matching, far-field projection) have no Condon-Shortley phase, while its
Wigner matrices and force formula assume one. The two readings differ by a
rotation of pi about z, so any beam that is not symmetric under it (moved
off axis, turned, or focused by a tilted lens) had its force mirrored in x
and y relative to its field. levtrap fixes this in
translate.wigner_rotation_matrix and force.forcetorque_beams.

The reference here is the dipole force, computed from the beam's own field:
for a small sphere it must equal the T-matrix force at every position.
"""

import numpy as np
import pytest

from levtrap.bsc import BscPlane, BscPmGauss
from levtrap.dipole import dipole_force
from levtrap.force import forcetorque
from levtrap.special import rotx, roty
from levtrap.tmatrix import TmatrixMie

WL, RADIUS, N = 1.064e-6, 3e-8, 1.45  # k r = 0.18: the dipole limit
T = TmatrixMie(RADIUS, index_medium=1.0, index_particle=N, wavelength0=WL)
GAUSS = BscPmGauss(angle_deg=50, polarisation=(1, 0), index_medium=1.0, wavelength0=WL, power=1.0)
POINTS = np.array([[0.2e-6, 0.1e-6, -0.15e-6], [-0.25e-6, 0.05e-6, 0.3e-6], [0.0, -0.2e-6, 0.1e-6]])


def agree(beam):
    mie = forcetorque(beam, T, position=POINTS.T)[0] / beam.power
    dip = dipole_force(beam, RADIUS, N, POINTS)
    assert np.max(np.abs(mie - dip)) < 0.02 * np.max(np.abs(dip))


def test_a_gaussian_beam():
    agree(GAUSS)


def test_a_moved_beam():
    agree(GAUSS.translate_xyz(np.array([0.3e-6, -0.2e-6, 0.1e-6])))


@pytest.mark.parametrize("R", [roty(30), rotx(-40) @ roty(20)])
def test_a_turned_beam(R):
    agree(GAUSS.rotate(R)[0])


def test_an_off_axis_mode():
    agree(BscPmGauss("hg", (1, 0), angle_deg=50, polarisation=(1, 1j), index_medium=1.0, wavelength0=WL, power=1.0))


def test_a_moved_beam_is_seen_from_the_new_origin():
    """translate_xyz(r): the beam as seen by a particle at r (its field at the
    new origin is the old field at r)."""
    r = np.array([0.3e-6, -0.1e-6, 0.2e-6])
    moved = GAUSS.translate_xyz(r, Nmax=GAUSS.Nmax + 8)
    assert np.allclose(moved.em_field_xyz(np.zeros((1, 3))), GAUSS.em_field_xyz(r[None]), rtol=1e-3, atol=1e-6)


def test_a_plane_wave_pushes_where_it_travels():
    """BscPlane(theta, phi) travels along -(sin t cos p, sin t sin p, cos t)
    (theta = 0 travels towards -z); the radiation pressure points the same way."""
    t, p = np.radians(30), np.radians(20)
    wave = BscPlane(t, p, polarisation=(1, 0), Nmax=12, index_medium=1.0, wavelength0=WL)
    f = forcetorque(wave, T)[0].ravel()
    travel = -np.array([np.sin(t) * np.cos(p), np.sin(t) * np.sin(p), np.cos(t)])
    assert f / np.linalg.norm(f) == pytest.approx(travel, abs=1e-6)
    # and the field's phase advances along the same direction
    h = 1e-9
    pts = np.array([-h * travel, h * travel])
    E = wave.em_field_xyz(pts)
    c = np.argmax(np.abs(E[0]))
    assert np.angle(E[1, c] / E[0, c]) > 0
