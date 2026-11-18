"""The displacement spectrum of a trapped particle (E4, issue #26).

Each normal mode i is a damped harmonic oscillator driven by white force noise,

    x'' + gamma x' + Omega^2 x = F(t) / m,

with gamma = gamma_gas + gamma_fb: the gas damping of :mod:`levtrap.rates`
plus an optional feedback damping ("cold damping", taken as ideal: it damps
without adding noise). The heating in :mod:`levtrap.rates` is the force
noise: the gas (gamma_gas n_th) and photon recoil, together the reheating
Gamma [phonons/s]. In the steady state the occupation balances heating and
damping,

    n = Gamma / gamma,         T_eff = n hbar Omega / k_B,

(the classical limit, n >> 1; with no feedback and no recoil, T_eff is the
gas temperature) and the single-sided displacement spectrum [m^2/Hz] is

    S_x(f) = 4 gamma k_B T_eff / m / ((Omega^2 - w^2)^2 + gamma^2 w^2),  w = 2 pi f,

a Lorentzian of full width gamma / 2 pi [Hz] at f = Omega / 2 pi whose
area is the equipartition variance <x^2> = k_B T_eff / (m Omega^2). See
e.g. Gieseler et al., PRL 109, 103603 (2012) and Hebestreit et al., Rev.
Sci. Instrum. 89, 033111 (2018).

Not modelled: the detector (imprecision noise, cross-talk between axes,
backaction of the measurement), anharmonic shifts and broadening (large
amplitudes in a shallow trap), and Paul-trap micromotion sidebands.
"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np

from .derived import KB
from .rates import HBAR

__all__ = ["occupation", "effective_temperature", "psd", "frequency_grid", "spectrum_block"]


def occupation(reheating: float, gamma: float, feedback: float = 0.0) -> float:
    """Mean phonon number Gamma / (gamma + gamma_fb) [rates in 1/s]."""
    total = gamma + feedback
    if total <= 0:
        return math.inf
    return reheating / total


def effective_temperature(n: float, Omega: float) -> float:
    """T_eff = n hbar Omega / k_B [K]."""
    return n * HBAR * Omega / KB


def psd(f, Omega: float, gamma: float, mass: float, temperature: float):
    """Single-sided displacement spectrum S_x(f) [m^2/Hz] at the frequencies
    ``f`` [Hz], for a mode of angular frequency ``Omega``, total damping
    ``gamma`` [1/s], ``mass`` [kg] and effective temperature [K]."""
    w = 2 * np.pi * np.asarray(f, dtype=float)
    return 4 * gamma * KB * temperature / mass / ((Omega**2 - w**2) ** 2 + (gamma * w) ** 2)


def frequency_grid(peaks: Sequence[tuple[float, float]], f_max: float, n: int = 400, per_peak: int = 160) -> np.ndarray:
    """Frequencies [Hz] from 0 to ``f_max``: an even grid of ``n`` points,
    and around each peak (centre [Hz], full width [Hz]) points spaced in
    log of the detuning, from a hundredth of the half width to the edges,
    so a peak of any width is drawn and integrated."""
    pts = [np.linspace(0, f_max, n)]
    for f0, width in peaks:
        hw = max(width / 2, f0 * 1e-15)
        reach = max(f0, f_max - f0)
        if reach <= hw * 1e-2:
            continue
        d = np.geomspace(hw * 1e-2, reach, per_peak)
        pts += [f0 - d, [f0], f0 + d]
    f = np.unique(np.concatenate(pts))
    return f[(f >= 0) & (f <= f_max)]


def spectrum_block(result: dict, feedback: Sequence[float] | float = 0.0, points: int = 400) -> dict | None:
    """Per mode of a solved Result: the total damping, occupation, effective
    temperature, the rms displacement and the spectrum on a shared grid.
    ``feedback``: damping rate(s) [1/s], one for all modes or one per mode.
    None for a trap without rates (no light) or without a stable mode."""
    rates = result.get("rates")
    if not rates or not result.get("stable"):
        return None
    mass = result["particle"]["mass"]
    gamma_gas = rates["gas_damping"]
    fb = list(feedback) if isinstance(feedback, (list, tuple, np.ndarray)) else [feedback] * len(rates["modes"])
    modes = []
    for i, m in enumerate(rates["modes"]):
        freq = next((x["frequency"] for x in result["modes"] if x["name"] == m["name"]), None)
        if not freq or m["reheating"] is None:
            continue
        Omega = 2 * np.pi * freq
        gamma = gamma_gas + fb[i]
        n = occupation(m["reheating"], gamma_gas, fb[i])
        T = effective_temperature(n, Omega)
        modes.append(dict(name=m["name"], frequency=freq, gamma=gamma, linewidth=gamma / (2 * np.pi),
                          occupation=n, temperature=T, rms=math.sqrt(KB * T / (mass * Omega**2))))
    if not modes:
        return None
    f_max = 1.5 * max(m["frequency"] for m in modes)
    f = frequency_grid([(m["frequency"], m["linewidth"]) for m in modes], f_max, points)
    for m in modes:
        m["psd"] = psd(f, 2 * np.pi * m["frequency"], m["gamma"], mass, m["temperature"]).tolist()
    return dict(frequency=f.tolist(), modes=modes)
