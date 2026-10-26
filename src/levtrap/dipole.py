"""Dipole (Rayleigh) reference model for the teaching overlay.

The force on a point dipole with polarisability alpha in a time-harmonic
field is (time averaged)

    F_i = 1/2 Re[ alpha  sum_j E_j d_i E_j^* ],

which contains both the gradient and the scattering (radiation pressure)
force when ``alpha`` includes the radiative correction

    alpha = 4 pi eps0 n_m^2 r^3 beta / (1 - i (2/3) k^3 r^3 beta),
    beta = (m^2 - 1)/(m^2 + 2),  m = n_particle / n_medium.

Using the field normalisation of :mod:`levtrap.derived`
(I = P/P_ott * 4 k^2 |E_ott|^2, |E_SI|^2 = 2 I / (c eps0 n_m)), the force
in OTT units (``n P / c``) is

    Q_i = 16 pi k^2 r^3 / P_ott * Re[ alpha' sum_j E_j d_i E_j^* ],
    alpha' = beta / (1 - i (2/3) k^3 r^3 beta),

evaluated with the beam's own (vector, non-paraxial) field.
"""

from __future__ import annotations

import numpy as np

from .bsc import Bsc

__all__ = ["dipole_polarisability", "dipole_force"]


def dipole_polarisability(radius: float, k_medium: float, m_rel: complex,
                          radiative: bool = True) -> complex:
    """Dimensionless alpha' = beta/(1 - i 2/3 (kr)^3 beta) (or beta)."""
    beta = (m_rel**2 - 1) / (m_rel**2 + 2)
    if not radiative:
        return beta
    return beta / (1 - 1j * 2 / 3 * (k_medium * radius) ** 3 * beta)


def dipole_force(beam: Bsc, radius: float, m_rel: complex, positions,
                 radiative: bool = True, h: float | None = None) -> np.ndarray:
    """Dipole-approximation force at ``positions`` (shape (N, 3), metres).

    Returns Q of shape (3, N) in units of n P / c, directly comparable to
    :func:`levtrap.force.forcetorque` for the same beam.
    """
    pos = np.atleast_2d(np.asarray(positions, dtype=float))
    k = beam.k_medium
    h = (2 * np.pi / k) * 1e-3 if h is None else h
    alpha = dipole_polarisability(radius, k, m_rel, radiative)
    E0 = beam.em_field_xyz(pos)
    out = np.zeros((3, pos.shape[0]))
    for i in range(3):
        d = np.zeros(3)
        d[i] = h
        dE = (beam.em_field_xyz(pos + d) - beam.em_field_xyz(pos - d)) / (2 * h)
        out[i] = np.real(alpha * np.sum(E0 * np.conj(dE), axis=1))
    return 16 * np.pi * k**2 * radius**3 / beam.power * out
