"""rates.py: gas damping limits, dipole recoil per axis, crossover pressure, the Result block.

Reference values are analytic limits only (no literature numbers):
* free-molecular: Epstein (1924) drag with diffuse reflection, written out here;
* continuum: Stokes drag 6 pi eta R / m;
* recoil: the electric-dipole radiation pattern integrated numerically here.
"""

import json
import math

import numpy as np
import pytest

from levtrap import rates
from levtrap.derived import C, KB, recoil_rate, sphere_mass
from levtrap.setup import DEFAULT_SETUP, GASES
from levtrap.solve import solve

R, RHO, T = 100e-9, 2200.0, 300.0
M = sphere_mass(R, RHO)


@pytest.fixture(params=sorted(rates.GASES))
def gas(request):
    return rates.gas_properties(request.param, T)


def test_species_match_setup():
    assert set(rates.GASES) == set(GASES)


def test_free_molecular_limit(gas):
    """Kn >> 1: gamma = (1 + pi/8) 8 p / (pi rho R v), v = sqrt(8 k T / (pi m_g)) (Epstein 1924)."""
    v = math.sqrt(8 * KB * T / (math.pi * gas["mass"]))
    for p in (1e-6, 1e-3, 1e-1):
        expected = (1 + math.pi / 8) * 8 * p / (math.pi * RHO * R * v)
        assert rates.knudsen(p, R, gas["viscosity"], gas["mass"], T) > 1e3
        got = rates.gas_damping(p, R, M, gas["viscosity"], gas["mass"], T)
        assert got == pytest.approx(expected, rel=1e-4)  # 0.619 is a rounded constant (4e-5)
        assert rates.epstein_damping(p, R, RHO, gas["mass"], T) == pytest.approx(expected, rel=1e-12)


def test_continuum_limit(gas):
    """Kn << 1: Stokes drag, gamma = 6 pi eta R / m."""
    p = 1e12  # formal limit: the interpolation as Kn -> 0
    assert rates.knudsen(p, R, gas["viscosity"], gas["mass"], T) < 1e-6
    got = rates.gas_damping(p, R, M, gas["viscosity"], gas["mass"], T)
    assert got == pytest.approx(6 * math.pi * gas["viscosity"] * R / M, rel=1e-5)


def test_damping_monotonic_and_zero_in_vacuum(gas):
    ps = np.logspace(-8, 9, 200)
    g = [rates.gas_damping(p, R, M, gas["viscosity"], gas["mass"], T) for p in ps]
    assert np.all(np.diff(g) > 0)
    assert rates.gas_damping(0.0, R, M, gas["viscosity"], gas["mass"], T) == 0.0


def _sphere_average(f, n=400):
    """Average of f(n_hat) over directions, Gauss-Legendre in cos(theta) x uniform phi."""
    x, w = np.polynomial.legendre.leggauss(n)
    phi = np.linspace(0, 2 * np.pi, 2 * n, endpoint=False)
    ct, ph = np.meshgrid(x, phi, indexing="ij")
    st = np.sqrt(1 - ct**2)
    nh = np.stack([st * np.cos(ph), st * np.sin(ph), ct])
    W = np.outer(w, np.full(phi.size, 2 * np.pi / phi.size))
    return np.einsum("ij,...ij->...", W, f(nh)) / (4 * np.pi)


@pytest.mark.parametrize("pol", ["x", "y", "circular+", "circular-", [[0.6, 0.0], [0.3, 0.7]]])
def test_dipole_moment_matches_pattern(pol):
    """<n n> of the pattern |p|^2 - |n.p|^2, integrated numerically."""
    p = rates.jones_vector(pol)

    def pattern(nh):
        return 1 - np.abs(np.einsum("i,i...->...", np.conj(p), nh)) ** 2

    norm = _sphere_average(pattern)
    num = np.array([[_sphere_average(lambda nh: nh[i] * nh[j] * pattern(nh)) for j in range(3)]
                    for i in range(3)]) / norm
    np.testing.assert_allclose(rates.dipole_second_moment(pol), num, atol=1e-12)


def test_dipole_recoil_per_axis_linear():
    """Linear x polarisation, beam along z: A = (1/5, 2/5, 2/5 + 1) per axis,
    Gamma = A omega P / (2 m c^2 Omega)."""
    np.testing.assert_allclose(rates.dipole_second_moment("x"), np.diag([0.2, 0.4, 0.4]), atol=1e-15)
    P, wl, Om = 1e-4, 1064e-9, 2 * math.pi * 1e5
    omega = 2 * math.pi * C / wl
    m = M
    unit = omega * P / m / C**2 / Om
    mom = rates.dipole_second_moment("x")
    got = {a: rates.recoil_heating(P, wl, m, Om, ax, mom)
           for a, ax in (("x", (1, 0, 0)), ("y", (0, 1, 0)), ("z", (0, 0, 1)))}
    assert got["x"]["total"] == pytest.approx(unit / 10, rel=1e-12)
    assert got["y"]["total"] == pytest.approx(unit / 5, rel=1e-12)
    assert got["z"]["total"] == pytest.approx(7 * unit / 10, rel=1e-12)
    assert got["x"]["incident"] == got["y"]["incident"] == 0
    # the scattered part normal to the polarisation is Jain et al.'s expression
    for a in "yz":
        assert got[a]["scattered"] == pytest.approx(recoil_rate(P, wl, m, Om), rel=1e-12)
    # an oblique axis: u.A.u
    u = np.array([1, 1, 1]) / math.sqrt(3)
    oblique = rates.recoil_heating(P, wl, m, Om, u, mom)["total"]
    assert oblique == pytest.approx((0.2 + 0.4 + 1.4) / 3 * unit / 2, rel=1e-12)


def test_crossover_pressure_free_molecular():
    """In the free-molecular regime gamma is linear in p, so p* = recoil hbar Omega / (k T (gamma / p))."""
    g = rates.gas_properties("N2", T)
    Om = 2 * math.pi * 1e5
    recoil = 1e4
    p_star = rates.crossover_pressure(recoil, Om, R, M, "N2", T)
    slope = rates.gas_damping(1e-6, R, M, g["viscosity"], g["mass"], T) / 1e-6
    assert p_star == pytest.approx(recoil * rates.HBAR * Om / (KB * T) / slope, rel=1e-6)
    gam = rates.gas_damping(p_star, R, M, g["viscosity"], g["mass"], T)
    assert rates.gas_heating(gam, T, Om) == pytest.approx(recoil, rel=1e-9)
    # recoil above the Stokes heating: no crossover
    stokes = rates.gas_heating(rates.stokes_damping(R, M, g["viscosity"]), T, Om)
    assert rates.crossover_pressure(2 * stokes, Om, R, M, "N2", T) is None


@pytest.fixture(scope="module")
def default():
    return solve(DEFAULT_SETUP)


def test_result_rates_block(default):
    r = default["rates"]
    json.dumps(r)
    env = DEFAULT_SETUP["environment"]
    assert r["gas"]["species"] == env["gas"] and r["gas"]["pressure"] == env["pressure"]
    assert len(r["modes"]) == 3 and len(r["recoil_heating"]) == 3
    for m, mode in zip(r["modes"], default["modes"]):
        Om = 2 * math.pi * mode["frequency"]
        assert m["reheating"] == pytest.approx(m["gas_heating"] + m["recoil_heating"])
        assert m["Q"] == pytest.approx(Om / r["gas_damping"])
        assert m["coherent_oscillations"] == pytest.approx(Om * m["coherence_time"])
        assert m["recoil_heating"] == pytest.approx(m["recoil_scattered"] + m["recoil_incident"])
    # x-polarised beam along z: scattered recoil along x is half that along y (same P_sca)
    x, y, z = r["modes"]
    fx, fy = default["modes"][0]["frequency"], default["modes"][1]["frequency"]
    assert x["recoil_scattered"] * fx == pytest.approx(y["recoil_scattered"] * fy / 2)
    assert z["recoil_incident"] > 0 and x["recoil_incident"] == 0
    assert r["P_sca"] == default["optical"]["P_sca"] and r["P_abs"] == default["optical"]["P_abs"]
    models = {m["quantity"]: m for m in default["models"]}
    assert models["gas_damping"]["model"] == "knudsen-interpolation"
    assert models["recoil_heating"]["model"] == "dipole-pattern"
    assert models["recoil_heating"]["validity"] == "ok"  # small silica sphere: dipole scattering


def test_result_rates_vacuum_and_large_sphere():
    s = json.loads(json.dumps(DEFAULT_SETUP))
    s["environment"]["pressure"] = 0.0
    r = solve(s)["rates"]
    assert r["gas_damping"] == 0.0
    assert all(m["Q"] is None and m["gas_heating"] == 0.0 for m in r["modes"])
    assert all(m["reheating"] == m["recoil_heating"] > 0 for m in r["modes"])
    s["particle"]["radius"] = 600e-9
    models = {m["quantity"]: m for m in solve(s)["models"]}
    assert models["recoil_heating"]["validity"] == "approximate"
