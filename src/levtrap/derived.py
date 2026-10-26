"""Derived physical quantities (SI units at the boundary).

Not part of OTT; these combine OTT-convention results with particle
properties.

Unit conventions
----------------
* OTT forces ``Q`` are in units of ``n_medium P / c``:  F [N] = Q n P / c.
* OTT stiffness ``kQ`` [1/m] -> k [N/m] = -kQ n P / c (sign: restoring > 0).
* Field normalisation (verified numerically against the plane-wave
  scattered power, see tests): a beam with OTT power ``P_ott`` and field
  ``E_ott`` has intensity ``I = (P / P_ott) * 4 k^2 |E_ott|^2`` [W/m^2],
  with ``k`` the wavenumber in the medium.
"""

from __future__ import annotations

import numpy as np

from .bsc import Bsc
from .tmatrix import mie_coefficients
from .special import ka2nmax

__all__ = [
    "C", "KB", "mie_efficiencies", "multipole_decomposition", "sphere_mass",
    "force_si", "stiffness_si", "trap_frequency", "recoil_rate", "recoil_ratio", "power_balance",
    "intensity_si",
]

C = 299_792_458.0  # speed of light [m/s]
KB = 1.380_649e-23  # Boltzmann constant [J/K]

_LABELS = {(1, "E"): "ED", (1, "M"): "MD", (2, "E"): "EQ", (2, "M"): "MQ",
           (3, "E"): "EO", (3, "M"): "MO"}


def mie_efficiencies(radius: float, wavelength0: float, n_particle: complex,
                     n_medium: float = 1.0, Nmax: int | None = None) -> dict:
    """Plane-wave Mie efficiencies of a sphere.

    Q_sca = 2/x^2 sum (2n+1)(|a_n|^2 + |b_n|^2)
    Q_ext = 2/x^2 sum (2n+1) Re(a_n + b_n)
    Q_abs = Q_ext - Q_sca,      x = 2 pi n_medium radius / wavelength0.

    ``a_n``, ``b_n`` are Bohren & Huffman coefficients, from OTT's
    T-matrix entries (``a_n = -T_N``, ``b_n = -T_M``).

    Returns a dict with ``Qext, Qsca, Qabs, x, a_n, b_n`` and per-multipole
    scattering contributions ``Qsca_multipoles`` (``{'ED':..., 'MD':...}``).
    """
    k = 2 * np.pi * n_medium / wavelength0
    x = k * radius
    if Nmax is None:
        Nmax = max(ka2nmax(x), 3)
    tM, tN, _, _ = mie_coefficients(radius, k, n_particle * 2 * np.pi / wavelength0, Nmax)
    a_n, b_n = -tN, -tM
    n = np.arange(1, Nmax + 1)
    qsca = 2 / x**2 * np.sum((2 * n + 1) * (np.abs(a_n) ** 2 + np.abs(b_n) ** 2))
    qext = 2 / x**2 * np.sum((2 * n + 1) * np.real(a_n + b_n))
    return dict(Qext=float(qext), Qsca=float(qsca), Qabs=float(qext - qsca), x=float(x),
                a_n=a_n, b_n=b_n, Nmax=Nmax,
                Qsca_multipoles=multipole_decomposition(a_n, b_n, x))


def multipole_decomposition(a_n, b_n, x: float) -> dict:
    """Scattering efficiency per multipole: Q = 2/x^2 (2n+1)|c_n|^2.

    ED: a_1, MD: b_1, EQ: a_2, MQ: b_2, EO/MO: n=3, 'higher': n>=4.
    """
    out = {}
    higher = 0.0
    for i, (a, b) in enumerate(zip(a_n, b_n)):
        n = i + 1
        qa = 2 / x**2 * (2 * n + 1) * abs(a) ** 2
        qb = 2 / x**2 * (2 * n + 1) * abs(b) ** 2
        if n <= 3:
            out[_LABELS[(n, "E")]] = float(qa)
            out[_LABELS[(n, "M")]] = float(qb)
        else:
            higher += qa + qb
    out["higher"] = float(higher)
    return out


def sphere_mass(radius: float, density: float) -> float:
    """Mass [kg] of a sphere, radius [m], density [kg/m^3]."""
    return 4 / 3 * np.pi * radius**3 * density


def force_si(Q, power: float, n_medium: float = 1.0):
    """F [N] = Q n_medium P / c."""
    return np.asarray(Q) * n_medium * power / C


def stiffness_si(kQ, power: float, n_medium: float = 1.0):
    """Spring constant [N/m] from OTT stiffness dQ/dx [1/m]: -kQ n P / c."""
    return -np.asarray(kQ) * n_medium * power / C


def trap_frequency(k_si: float, mass: float) -> float:
    """Angular trap frequency Omega = sqrt(k/m) [rad/s] (nan if k <= 0)."""
    return float(np.sqrt(k_si / mass)) if k_si > 0 else float("nan")


def recoil_rate(P_sca: float, wavelength0: float, mass: float, Omega: float) -> float:
    """Photon-recoil heating rate in phonons per second.

    Gamma = omega P_sca / (5 m c^2 Omega),  omega = 2 pi c / lambda0
    (Jain et al., PRL 116, 243601 (2016); arXiv:2607.09896).
    """
    omega = 2 * np.pi * C / wavelength0
    return float(omega * P_sca / (5 * mass * C**2 * Omega))


def recoil_ratio(P_sca: float, wavelength0: float, mass: float, Omega: float) -> float:
    """Gamma / Omega = omega P_sca / (5 m c^2 Omega^2) (dimensionless).

    Note: the project plan wrote this ratio as omega P_sca/(5 m c^2 Omega_0),
    which is Gamma itself; dividing once more by Omega reproduces the
    SiO2 reference value Gamma/Omega ~ 0.18 quoted in arXiv:2607.09896.
    """
    return recoil_rate(P_sca, wavelength0, mass, Omega) / Omega


def power_balance(ibeam: Bsc, sbeam: Bsc) -> dict:
    """Scattered and absorbed power fractions for a beam on a particle.

    With OTT conventions (regular incident coefficients a, b; 'scattered'
    coefficients p, q whose physical outgoing amplitude is 2p, 2q):

        P_inc = sum |a|^2 + |b|^2
        P_sca = sum |2p|^2 + |2q|^2
        P_abs = P_inc - sum |a + 2p|^2 + |b + 2q|^2

    Returns fractions of the incident beam power.
    """
    n = max(ibeam.Nmax, sbeam.Nmax)
    i, s = ibeam.set_Nmax(n), sbeam.set_Nmax(n)
    pin = np.sum(np.abs(i.a) ** 2 + np.abs(i.b) ** 2)
    psca = 4 * np.sum(np.abs(s.a) ** 2 + np.abs(s.b) ** 2)
    # P_inc - P_out expanded so the large |a|^2 terms cancel analytically:
    # |a|^2 - |a + 2p|^2 = -4 (Re(a* p) + |p|^2)
    pabs = -4 * np.sum(np.real(np.conj(i.a) * s.a) + np.abs(s.a) ** 2
                       + np.real(np.conj(i.b) * s.b) + np.abs(s.b) ** 2)
    return dict(sca=float(psca / pin), abs=float(pabs / pin))


def intensity_si(beam: Bsc, xyz, power: float) -> np.ndarray:
    """Intensity [W/m^2] of ``beam`` scaled to ``power`` [W] at points xyz [m]."""
    E = beam.em_field_xyz(xyz)
    return power / beam.power * 4 * beam.k_medium**2 * np.sum(np.abs(E) ** 2, axis=1)
