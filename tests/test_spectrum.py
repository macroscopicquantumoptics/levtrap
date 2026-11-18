"""E4 (issue #26): the displacement spectrum and the thermal occupation.

Acceptance: the area under each peak is k_B T_eff / (m Omega^2) to 1 %.
"""

import copy
import math

import numpy as np
import pytest

from levtrap.derived import KB
from levtrap.rates import HBAR
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve
from levtrap.spectrum import effective_temperature, frequency_grid, occupation, psd, spectrum_block


def tweezer(pressure):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["environment"]["pressure"] = pressure
    return solve(s)


@pytest.fixture(scope="module")
def results():
    # 1e-4 Pa (narrow peaks, recoil matters), 100 Pa (gas), 1e4 Pa (broad, overdamped-ish x)
    return {p: tweezer(p) for p in (1e-4, 100.0, 1e4)}


def area(f, s):
    return float(np.trapezoid(s, f)) if hasattr(np, "trapezoid") else float(np.trapz(s, f))


def test_the_lorentzian_integrates_to_equipartition():
    m, T = 1e-17, 300.0
    for Omega, gamma in [(2 * np.pi * 1e5, 1e-3), (2 * np.pi * 1e5, 1e3), (2 * np.pi * 3e4, 5e4)]:
        f = frequency_grid([(Omega / 2 / np.pi, gamma / 2 / np.pi)], 50 * Omega / 2 / np.pi, 2000)
        # the tail beyond 50 f0 falls as f^-4: negligible
        assert area(f, psd(f, Omega, gamma, m, T)) == pytest.approx(KB * T / (m * Omega**2), rel=1e-3)
    # the peak is gamma / 2 pi wide at half height
    Omega, gamma = 2 * np.pi * 1e5, 10.0
    top = psd(Omega / 2 / np.pi, Omega, gamma, m, T)
    half = psd(Omega / 2 / np.pi + gamma / 4 / np.pi, Omega, gamma, m, T)
    assert half / top == pytest.approx(0.5, rel=1e-4)


@pytest.mark.parametrize("pressure", [1e-4, 100.0, 1e4])
@pytest.mark.parametrize("feedback", [0.0, 2e3])
def test_each_peak_holds_k_T_eff_over_m_Omega2(results, pressure, feedback):
    r = results[pressure]
    b = spectrum_block(r, feedback=feedback)
    f = np.asarray(b["frequency"])
    m = r["particle"]["mass"]
    for mode in b["modes"]:
        Omega = 2 * np.pi * mode["frequency"]
        want = KB * mode["temperature"] / (m * Omega**2)
        assert mode["rms"] ** 2 == pytest.approx(want, rel=1e-12)
        # on the drawn grid, up to 1.5 times the highest frequency: within 1 %
        assert area(f, np.asarray(mode["psd"])) == pytest.approx(want, rel=0.01), mode["name"]


def test_the_occupation_balances_heating_and_damping(results):
    r = results[100.0]
    b = spectrum_block(r)
    T = DEFAULT_SETUP["environment"]["temperature"]
    for mode, rates in zip(b["modes"], r["rates"]["modes"]):
        assert mode["occupation"] == pytest.approx(rates["reheating"] / r["rates"]["gas_damping"], rel=1e-12)
        # at 1 mbar the gas dominates: the mode is at the gas temperature
        assert mode["temperature"] == pytest.approx(T, rel=1e-3)
    # at 1e-6 mbar, near each mode's crossover pressure, recoil heats every mode above the gas temperature
    hot = spectrum_block(results[1e-4])
    assert all(m["temperature"] > 1.4 * T for m in hot["modes"])
    # feedback cools: T_eff falls as gamma_gas / (gamma_gas + gamma_fb)
    cold = spectrum_block(results[1e-4], feedback=1e3)
    g = results[1e-4]["rates"]["gas_damping"]
    for a, c in zip(hot["modes"], cold["modes"]):
        assert c["temperature"] == pytest.approx(a["temperature"] * g / (g + 1e3), rel=1e-9)
        assert c["linewidth"] == pytest.approx((g + 1e3) / (2 * np.pi), rel=1e-12)
    # per-mode feedback
    one = spectrum_block(results[1e-4], feedback=[0, 0, 1e3])
    assert one["modes"][0]["temperature"] == pytest.approx(hot["modes"][0]["temperature"])
    assert one["modes"][2]["temperature"] < hot["modes"][2]["temperature"]


def test_the_helpers():
    assert occupation(10.0, 2.0, 3.0) == 2.0
    assert math.isinf(occupation(1.0, 0.0))
    Omega = 2 * np.pi * 1e5
    assert effective_temperature(KB * 300 / (HBAR * Omega), Omega) == pytest.approx(300)


def test_no_spectrum_without_rates():
    r = tweezer(100.0)
    assert spectrum_block(dict(r, rates=None)) is None
    assert spectrum_block(dict(r, stable=False)) is None
