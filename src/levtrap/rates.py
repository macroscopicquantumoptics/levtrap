"""Rates: gas damping, photon-recoil heating, reheating and the crossover pressure.

Everything is SI.  Rates are angular rates [1/s] unless they are phonon rates
[phonons/s].  For each mode of angular frequency Omega:

* gas damping ``gamma`` [1/s]: m x'' = -m gamma x' - k x + noise.
* gas heating [phonons/s]: ``gamma k_B T / (hbar Omega)`` (the bath drives
  dn/dt = -gamma (n - n_th) with n_th ~ k_B T / (hbar Omega) >> 1).
* recoil heating [phonons/s]: from the momentum diffusion of scattered
  photons and of the photons taken out of the beam.
* reheating [phonons/s]: their sum; ``coherence_time = 1 / reheating``,
  ``coherent_oscillations = Omega / reheating``, ``Q = Omega / gamma``.
* ``crossover_pressure`` [Pa]: where gas heating equals recoil heating.

Direction-resolved recoil
-------------------------
The recoil rate needs the second moment ``<n n>`` (3x3) of the direction
``n`` of the scattered photons, weighted by the scattered power, and their
mean ``<n>`` for the forward/backward cross term.  A solve takes both from
the Mie scattered field at the equilibrium (``scattering`` in
:func:`rates_block`, from ``OpticalField.scattering``; #78), so a resonant
particle whose scattering is dominated by a magnetic or quadrupole multipole
gets its own pattern.  Without it (a caller that passes no ``scattering``)
the electric-dipole pattern of the beams' polarisation,
:func:`dipole_second_moment`, is the fallback, and its model says so.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

import numpy as np

from .derived import C, KB

__all__ = [
    "HBAR", "AMU", "GASES", "gas_properties", "mean_speed", "mean_free_path", "knudsen",
    "gas_damping", "epstein_damping", "stokes_damping", "gas_heating", "jones_vector",
    "dipole_second_moment", "recoil_heating", "recoil_tensors", "crossover_pressure", "mode_rates", "rates_block",
]

HBAR = 1.054_571_817e-34  # reduced Planck constant [J s] (CODATA 2018, exact h / 2 pi)
AMU = 1.660_539_066_60e-27  # atomic mass constant [kg] (CODATA 2018)

#: Gas species.  ``molar_mass`` [g/mol]: N2 from the IUPAC standard atomic
#: weight of N (14.0067); He from IUPAC (4.002602); air is the sea-level mean
#: molar mass of the U.S. Standard Atmosphere 1976 (28.9644).
#: Viscosity: variable-hard-sphere power law eta = eta_ref (T / T_ref)^omega
#: with T_ref = 273 K, eta_ref and omega from G. A. Bird, *Molecular Gas
#: Dynamics and the Direct Simulation of Gas Flows* (Oxford, 1994),
#: Appendix A, Table A1.
GASES: dict[str, dict] = {
    "N2": dict(molar_mass=28.0134, eta_ref=1.656e-5, omega=0.74),
    "He": dict(molar_mass=4.002602, eta_ref=1.865e-5, omega=0.66),
    "air": dict(molar_mass=28.9644, eta_ref=1.719e-5, omega=0.77),
}
T_REF = 273.0  # K, reference temperature of Bird's Table A1

# Beresnev-type interpolation constants (Beresnev, Chernyak & Fomyagin,
# J. Fluid Mech. 219, 405 (1990), in the form used by Li, Kheifets, Medellin
# & Raizen, Nat. Phys. 7, 527 (2011) and Gieseler et al., PRL 109, 103603 (2012)).
_A = 0.619
_CK = (0.31, 0.785, 1.152)


# ---------------------------------------------------------------------------
# gas
# ---------------------------------------------------------------------------


def gas_properties(gas: str, temperature: float) -> dict:
    """Molecular mass [kg] and dynamic viscosity [Pa s] of ``gas`` at ``temperature`` [K].

    eta(T) = eta_ref (T / 273 K)^omega  (Bird 1994, Table A1; a fit to
    measured viscosities, good from roughly 200 K to 1000 K).
    """
    g = GASES[gas]
    return dict(gas=gas, mass=g["molar_mass"] * AMU,
                viscosity=g["eta_ref"] * (temperature / T_REF) ** g["omega"])


def mean_speed(gas_mass: float, temperature: float) -> float:
    """Maxwell-Boltzmann mean molecular speed [m/s]: v = sqrt(8 k_B T / (pi m_g))."""
    return math.sqrt(8 * KB * temperature / (math.pi * gas_mass))


def mean_free_path(pressure: float, viscosity: float, gas_mass: float, temperature: float) -> float:
    """Mean free path [m]: l = (eta / p) sqrt(pi k_B T / (2 m_g)).

    The kinetic-theory relation between viscosity and mean free path,
    eta = (1/2) rho v l with rho = p m_g / (k_B T) and v the mean speed.
    With this l the Beresnev constant 0.619 reproduces Epstein's diffuse
    free-molecular drag (see :func:`gas_damping`).  Infinite at p = 0.
    """
    if pressure <= 0:
        return math.inf
    return viscosity / pressure * math.sqrt(math.pi * KB * temperature / (2 * gas_mass))


def knudsen(pressure: float, radius: float, viscosity: float, gas_mass: float, temperature: float) -> float:
    """Knudsen number Kn = l / R (dimensionless)."""
    return mean_free_path(pressure, viscosity, gas_mass, temperature) / radius


def stokes_damping(radius: float, mass: float, viscosity: float) -> float:
    """Continuum (Stokes) damping rate [1/s]: gamma = 6 pi eta R / m (Stokes 1851)."""
    return 6 * math.pi * viscosity * radius / mass


def epstein_damping(pressure: float, radius: float, density: float, gas_mass: float,
                    temperature: float, diffuse: bool = True) -> float:
    """Free-molecular (Epstein) damping rate [1/s].

    Epstein, Phys. Rev. 23, 710 (1924): F = -delta (4 pi / 3) R^2 N m_g v u,
    with N = p / (k_B T) and v the mean speed; delta = 1 + pi/8 for diffuse
    reflection with full accommodation, delta = 1 for specular reflection.
    For a sphere of density rho this gives

        gamma = delta 8 p / (pi rho R v).
    """
    delta = 1 + math.pi / 8 if diffuse else 1.0
    return delta * 8 * pressure / (math.pi * density * radius * mean_speed(gas_mass, temperature))


def gas_damping(pressure: float, radius: float, mass: float, viscosity: float, gas_mass: float,
                temperature: float) -> float:
    """Gas damping rate [1/s] of a sphere, free-molecular to continuum.

        gamma = (6 pi eta R / m) * 0.619 / (0.619 + Kn) * (1 + c_K),
        c_K   = 0.31 Kn / (0.785 + 1.152 Kn + Kn^2),   Kn = l / R

    (Beresnev, Chernyak & Fomyagin, J. Fluid Mech. 219, 405 (1990); as used in
    Li et al., Nat. Phys. 7, 527 (2011) and Gieseler et al., PRL 109, 103603
    (2012)), with l from :func:`mean_free_path`.

    Limits (tested): Kn -> 0 gives Stokes, 6 pi eta R / m; Kn -> inf gives
    Epstein's diffuse-reflection drag (1 + pi/8) 8 p / (pi rho R v) to 4e-5
    (0.619 is rounded).
    """
    if pressure <= 0:
        return 0.0
    kn = knudsen(pressure, radius, viscosity, gas_mass, temperature)
    a, b, c = _CK
    ck = a * kn / (b + c * kn + kn * kn)
    return stokes_damping(radius, mass, viscosity) * _A / (_A + kn) * (1 + ck)


def gas_heating(gamma: float, temperature: float, Omega: float) -> float:
    """Heating by the gas [phonons/s]: gamma k_B T / (hbar Omega).

    The thermal occupation n_th = k_B T / (hbar Omega) (high-temperature limit)
    times the damping rate; see e.g. Gieseler et al., PRL 109, 103603 (2012).
    """
    return gamma * KB * temperature / (HBAR * Omega)


# ---------------------------------------------------------------------------
# photon recoil
# ---------------------------------------------------------------------------


def jones_vector(polarisation) -> np.ndarray:
    """Unit 3-vector of the incident field in the beam frame (beam along +z).

    ``polarisation``: 'x', 'y', 'circular+', 'circular-', or a Jones vector
    as [[re, im], [re, im]] or two complex numbers.
    """
    if isinstance(polarisation, str):
        e = {"x": (1, 0), "y": (0, 1), "circular+": (1, 1j), "circular-": (1, -1j),
             "circular": (1, 1j)}[polarisation]
    else:
        e = [complex(c[0], c[1]) if isinstance(c, (list, tuple)) else complex(c) for c in polarisation]
    v = np.array([e[0], e[1], 0], dtype=complex)
    return v / np.linalg.norm(v)


def dipole_second_moment(polarisation) -> np.ndarray:
    """Second moment <n_i n_j> of the photon direction for electric-dipole scattering.

    A dipole p radiates dP/dOmega ~ |p|^2 - |n . p|^2.  With the angular
    averages <n_i n_j> = delta_ij / 3 and
    <n_i n_j n_k n_l> = (delta_ij delta_kl + delta_ik delta_jl + delta_il delta_jk) / 15:

        <n n> = (2/5) I - (1/5) Re(p p^*) / |p|^2.

    Linear polarisation along x: diag(1/5, 2/5, 2/5).  Trace 1.
    """
    p = jones_vector(polarisation)
    return 0.4 * np.eye(3) - 0.2 * np.real(np.outer(p, np.conj(p)))


def recoil_heating(P_sca: float, wavelength0: float, mass: float, Omega: float, axis: Sequence[float],
                   scattered_moment: np.ndarray, beam_direction: Sequence[float] = (0, 0, 1),
                   n_medium: float = 1.0, scattered_mean: Sequence[float] | None = None, *,
                   beam_moment: np.ndarray | None = None, cross_moment: np.ndarray | None = None) -> dict:
    """Photon-recoil heating of one mode [phonons/s].

    Scattering N = P_sca / (hbar omega) photons per second, each of momentum
    hbar k (k = n_medium omega / c), kicks the particle by hbar k (e_in - n)
    per photon: a photon taken out of the beam along e_in and sent out along
    n.  For independent (Poissonian) events the momentum along the unit
    vector ``u`` diffuses as d<p_u^2>/dt = (hbar k)^2 N A_u with

        A_u = <(u . (e_in - n))^2>
            = u . <n n> . u  +  (u . e_in)^2  -  2 (u . e_in)(u . <n>)

    The first term is the scattered photons (``scattered_moment`` = <n n>,
    from the Mie far field or :func:`dipole_second_moment`); the second is
    the shot noise of the photons removed from the beam, along its direction
    e_in (plane-wave limit; the angular spread of a focused beam is
    neglected); the third is their cross term (#78), which needs the mean
    direction ``scattered_mean`` = <n> and vanishes for any pattern symmetric
    under n -> -n (a dipole).  A forward-peaked Mie pattern (<n> . e_in > 0)
    makes it negative: a photon scattered forwards hardly kicks the particle.
    The energy grows at d<p_u^2>/dt / (2 m), so

        Gamma_u = A_u omega P_sca / (2 m c^2 Omega)  * n_medium^2.

    For the scattered part along an axis normal to a linear polarisation
    (A = 2/5) this is omega P_sca / (5 m c^2 Omega), the expression of Jain et
    al., PRL 116, 243601 (2016) (``derived.recoil_rate``).  Along the beam the
    incident shot noise adds A = 1 (Seberson & Robicheaux, PRA 102, 033505
    (2020)), giving 7/5 in total for a linearly polarised dipole.

    Several beams or fields: ``beam_moment`` = sum_b w_b e_b e_b^T replaces
    e_in e_in^T, and ``cross_moment`` = sum_f w_f e_f <n>_f^T replaces
    e_in <n>^T (see :func:`recoil_tensors`).

    Returns ``scattered``, ``incident`` (the beam photons), ``cross`` and
    ``total`` [phonons/s].
    """
    u = np.asarray(axis, float)
    u = u / np.linalg.norm(u)
    e = np.asarray(beam_direction, float)
    e = e / np.linalg.norm(e)
    B = np.outer(e, e) if beam_moment is None else np.asarray(beam_moment, float)
    if cross_moment is not None:
        X = np.asarray(cross_moment, float)
    elif scattered_mean is not None:
        X = np.outer(e, np.real(np.asarray(scattered_mean, float)))
    else:
        X = np.zeros((3, 3))
    omega = 2 * math.pi * C / wavelength0
    unit = omega * P_sca * n_medium**2 / (2 * mass * C**2 * Omega)
    sca = float(u @ np.real(scattered_moment) @ u) * unit
    inc = float(u @ B @ u) * unit
    cross = -2 * float(u @ X @ u) * unit
    return dict(scattered=sca, incident=inc, cross=cross, total=sca + inc + cross)


def recoil_tensors(parts: Sequence[dict]) -> dict:
    """The power-weighted tensors of :func:`recoil_heating` for several fields.

    ``parts``: one dict per optical field with ``P_sca`` [W], ``mean`` (<n>,
    lab frame), ``second`` (<n n>, lab frame) and ``beams``, a list of
    ``(direction, weight)`` of the beams the field's photons are taken from
    (weights summing to 1).  Incoherent fields scatter independently, so
    their patterns add weighted by their scattered power; within a coherent
    group the beam photons are averaged over the beams by power and taken as
    uncorrelated with the scattered direction (exact for one beam).

    Returns ``second`` (<n n>), ``mean`` (<n>), ``beam`` (sum w e e^T) and
    ``cross`` (sum w e_mean <n>^T), each weighted by P_sca / sum P_sca.
    """
    P = np.array([max(float(p["P_sca"]), 0.0) for p in parts])
    w = P / P.sum() if P.sum() > 0 else np.full(len(parts), 1 / len(parts))
    S, B, X, m = np.zeros((3, 3)), np.zeros((3, 3)), np.zeros((3, 3)), np.zeros(3)
    for wf, p in zip(w, parts):
        ebar = np.zeros(3)
        for d, wb in p["beams"]:
            e = np.asarray(d, float)
            e = e / np.linalg.norm(e)
            B += wf * wb * np.outer(e, e)
            ebar += wb * e
        mean = np.real(np.asarray(p["mean"], float))
        S += wf * np.real(np.asarray(p["second"], float))
        X += wf * np.outer(ebar, mean)
        m += wf * mean
    return dict(second=S, mean=m, beam=B, cross=X)


def crossover_pressure(recoil: float, Omega: float, radius: float, mass: float, gas: str,
                       temperature: float, p_min: float = 1e-12, p_max: float = 1e7) -> float | None:
    """Pressure [Pa] at which gas heating equals ``recoil`` [phonons/s].

    Gas heating rises monotonically with pressure up to the Stokes value; if
    ``recoil`` exceeds that there is no crossover and ``None`` is returned.
    Root-found on log p (bracket ``p_min`` .. ``p_max``).
    """
    from scipy.optimize import brentq

    g = gas_properties(gas, temperature)

    def f(logp):
        p = 10.0**logp
        gam = gas_damping(p, radius, mass, g["viscosity"], g["mass"], temperature)
        return math.log(gas_heating(gam, temperature, Omega) / recoil)

    if not (recoil > 0 and Omega > 0):
        return None
    lo, hi = math.log10(p_min), math.log10(p_max)
    if f(lo) > 0 or f(hi) < 0:
        return None
    return float(10.0 ** brentq(f, lo, hi, xtol=1e-12))


# ---------------------------------------------------------------------------
# Result block
# ---------------------------------------------------------------------------


def mode_rates(*, Omega: float | None, axis: Sequence[float], gamma: float, temperature: float,
               P_sca: float, wavelength0: float, mass: float, radius: float, gas: str,
               scattered_moment: np.ndarray, beam_direction=(0, 0, 1), n_medium: float = 1.0,
               scattered_mean=None, beam_moment=None, cross_moment=None) -> dict:
    """All rates of one mode; values are ``None`` when the mode is not trapped.

    ``recoil_scattered``, ``recoil_incident`` (the beam photons) and
    ``recoil_cross`` add up to ``recoil_heating`` (:func:`recoil_heating`).
    """
    keys = ("gas_heating", "recoil_heating", "recoil_scattered", "recoil_incident", "recoil_cross",
            "reheating", "Q", "coherence_time", "coherent_oscillations", "crossover_pressure")
    if Omega is None or not np.isfinite(Omega) or Omega <= 0:
        return dict.fromkeys(keys)
    rec = recoil_heating(P_sca, wavelength0, mass, Omega, axis, scattered_moment, beam_direction, n_medium,
                         scattered_mean, beam_moment=beam_moment, cross_moment=cross_moment)
    gh = gas_heating(gamma, temperature, Omega)
    tot = gh + rec["total"]
    return dict(
        gas_heating=gh,
        recoil_heating=rec["total"], recoil_scattered=rec["scattered"], recoil_incident=rec["incident"],
        recoil_cross=rec["cross"],
        reheating=tot,
        Q=(Omega / gamma) if gamma > 0 else None,
        coherence_time=(1 / tot) if tot > 0 else None,
        coherent_oscillations=(Omega / tot) if tot > 0 else None,
        crossover_pressure=crossover_pressure(rec["total"], Omega, radius, mass, gas, temperature),
    )


def _beam_moment(beams: Iterable[dict]) -> tuple[np.ndarray, bool]:
    """Power-weighted dipole <n n> of the beams; True if they share one polarisation."""
    beams = list(beams)
    moments = [dipole_second_moment(b["polarisation"]) for b in beams]
    w = np.array([b["power"] for b in beams], float)
    w = w / w.sum() if w.sum() > 0 else np.full(len(beams), 1 / len(beams))
    same = all(np.allclose(m, moments[0]) for m in moments)
    return sum(wi * m for wi, m in zip(w, moments)), same


def _usable(parts) -> bool:
    return bool(parts) and all(
        np.all(np.isfinite(np.asarray(p["second"], float))) and np.all(np.isfinite(np.asarray(p["mean"], float)))
        and np.isfinite(p["P_sca"]) for p in parts) and sum(max(p["P_sca"], 0.0) for p in parts) > 0


def _parallel(directions) -> bool:
    """All directions along one axis (either way)."""
    d = [np.asarray(v, float) / np.linalg.norm(v) for v in directions]
    return all(abs(abs(float(v @ d[0])) - 1) <= 1e-9 for v in d[1:])


def _same_way(directions) -> bool:
    """All directions the same, not merely along one axis (#78): opposing beams
    of one coherent group (a standing wave) average their beam photons to
    about zero, which drops their correlation with the scattered direction."""
    d = [np.asarray(v, float) / np.linalg.norm(v) for v in directions]
    return all(abs(float(v @ d[0]) - 1) <= 1e-9 for v in d[1:])


def rates_block(s: dict, *, modes: list[dict], mass: float, P_sca: float, P_abs: float,
                ed_fraction: float | None = None, scattering: Sequence[dict] | None = None
                ) -> tuple[dict, list[dict]]:
    """The Result's ``rates`` block for a parsed setup ``s``.

    ``modes``: the Result's modes (``axis``, ``frequency`` [Hz]).
    ``scattering``: per optical field, the Mie scattered pattern at the
    equilibrium (``P_sca``, ``mean``, ``second`` in the lab frame, and
    ``beams``: ``(direction, power weight)`` of the beams it scatters; see
    :func:`recoil_tensors`).  With it the recoil uses the Mie pattern
    (model ``mie-pattern``, #78); without it the electric-dipole pattern of
    the beams' polarisation (``dipole-pattern``), whose validity
    ``ed_fraction``, the electric-dipole share of the scattered power, sets.
    Returns ``(block, models)``.
    """
    env = s["environment"]
    T, p, gas = env["temperature"], env["pressure"], env["gas"]
    radius = s["particle"]["radius"]
    density = s["particle"]["density"]
    beams = [f for f in s["trap"]["fields"] if f["kind"] == "beam"]
    wl = beams[0]["wavelength"]
    n_medium = env["medium_index"]

    g = gas_properties(gas, T)
    kn = knudsen(p, radius, g["viscosity"], g["mass"], T)
    gamma = gas_damping(p, radius, mass, g["viscosity"], g["mass"], T)
    mie = _usable(scattering)
    validity = "ok"
    if mie:
        tens = recoil_tensors(scattering)
        pattern = dict(scattered_moment=tens["second"], scattered_mean=tens["mean"],
                       beam_moment=tens["beam"], cross_moment=tens["cross"])
        recoil_notes = ["scattered photons: Mie pattern at the equilibrium; "
                        "beam photons: plane-wave shot noise along each beam"]
        mixed = [p_ for p_ in scattering if len(p_["beams"]) > 1 and not _same_way([d for d, _ in p_["beams"]])]
        if mixed:
            validity = "approximate"
            recoil_notes.append("coherent beams in different directions (e.g. a standing wave): the beam photons "
                                "are averaged over the beams by power, as if uncorrelated with the scattered "
                                "direction")
    else:
        moment, same_pol = _beam_moment(beams)
        pattern = dict(scattered_moment=moment, beam_direction=beams[0]["direction"])
        recoil_notes = ["scattered photons: electric-dipole pattern; beam photons: plane-wave shot noise"]
        if ed_fraction is not None and ed_fraction < 0.95:
            validity = "approximate"
            recoil_notes.append(f"electric dipole carries {100 * ed_fraction:.0f}% of the scattered power; "
                                "the dipole pattern is approximate")
        if not _parallel([b["direction"] for b in beams]):
            validity = "approximate"
            recoil_notes.append("beams along different axes: recoil from the beam photons taken along "
                                "the first beam, scattered pattern from each beam's own polarisation")
        if not same_pol:
            validity = "approximate"
            recoil_notes.append("beams of different polarisation: patterns averaged by power, interference ignored")

    per_mode = []
    for m in modes:
        f = m.get("frequency")
        Om = 2 * math.pi * f if f else None
        r = mode_rates(Omega=Om, axis=m["axis"], gamma=gamma, temperature=T, P_sca=P_sca,
                       wavelength0=wl, mass=mass, radius=radius, gas=gas, n_medium=n_medium, **pattern)
        per_mode.append(dict(name=m.get("name"), axis=m["axis"], **r))

    if n_medium != 1:
        validity = "approximate"
        recoil_notes.append("photon momentum taken as n hbar omega / c in the medium")
    damping_notes = [f"Kn = {kn:.3g}"]
    damping_validity = "ok"
    if not 200 <= T <= 1000:
        damping_validity = "approximate"
        damping_notes.append("gas viscosity extrapolated outside about 200-1000 K")
    if n_medium != 1:
        damping_validity = "approximate"
        damping_notes.append("medium index is not 1 but the gas model assumes a dilute gas")

    block: dict[str, Any] = dict(
        gas=dict(species=gas, pressure=p, temperature=T, molecular_mass=g["mass"],
                 viscosity=g["viscosity"], mean_free_path=mean_free_path(p, g["viscosity"], g["mass"], T),
                 knudsen=kn),
        gas_damping=gamma,
        stokes_damping=stokes_damping(radius, mass, g["viscosity"]),
        epstein_damping=epstein_damping(p, radius, density, g["mass"], T),
        recoil_heating=[r["recoil_heating"] for r in per_mode],
        reheating_phonons_per_s=[r["reheating"] for r in per_mode],
        modes=per_mode,
        P_sca=P_sca,
        P_abs=P_abs,
    )
    if mie:
        # the scattered photons' direction moments (lab frame), for "how is this computed" (#78)
        block["scattered_moments"] = dict(mean=[float(v) for v in tens["mean"]],
                                          second=[[float(v) for v in row] for row in tens["second"]])
    models = [
        dict(quantity="gas_damping", model="knudsen-interpolation", validity=damping_validity,
             notes=damping_notes),
        dict(quantity="recoil_heating", model="mie-pattern" if mie else "dipole-pattern", validity=validity, notes=recoil_notes),
    ]
    return block, models
