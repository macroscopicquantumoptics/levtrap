"""rates.py: gas damping limits, dipole and Mie recoil per axis, crossover pressure, the Result block.

Reference values are analytic limits only (no literature numbers):
* free-molecular: Epstein (1924) drag with diffuse reflection, written out here;
* continuum: Stokes drag 6 pi eta R / m;
* recoil: the electric-dipole radiation pattern integrated numerically here; the
  Mie pattern of a small sphere reproduces it, one at a quadrupole resonance does not (#78).
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
        assert m["recoil_heating"] == pytest.approx(m["recoil_scattered"] + m["recoil_incident"] + m["recoil_cross"])
    # x-polarised beam along z: scattered recoil along x is half that along y (same P_sca); the
    # 100 nm silica sphere is nearly a dipole, so its Mie pattern gives this to 1 % (#78)
    x, y, z = r["modes"]
    fx, fy = default["modes"][0]["frequency"], default["modes"][1]["frequency"]
    assert x["recoil_scattered"] * fx == pytest.approx(y["recoil_scattered"] * fy / 2, rel=0.01)
    # beam photons (#95): along the beam they weigh less than a plane wave's 1 against the scattered
    # photons' 2/5 (the Gouy phase slows the axial phase); across it the focus's longitudinal field,
    # which grows along x, adds a little
    assert 1.3 < z["recoil_incident"] / z["recoil_scattered"] < 2.0  # 1.62; a plane wave gives 2.5
    assert 0 < x["recoil_incident"] < 0.05 * z["recoil_incident"]
    # slightly forward scattering (<n_z> > 0): the cross term lowers the heating, mostly along the beam
    assert z["recoil_cross"] < 0 and abs(x["recoil_cross"]) < 0.1 * abs(z["recoil_cross"])
    assert r["P_sca"] == default["optical"]["P_sca"] and r["P_abs"] == default["optical"]["P_abs"]
    np.testing.assert_allclose(r["scattered_moments"]["second"], rates.dipole_second_moment("x"), atol=0.004)
    models = {m["quantity"]: m for m in default["models"]}
    assert models["gas_damping"]["model"] == "knudsen-interpolation"
    assert models["recoil_heating"]["model"] == "information"
    assert models["recoil_heating"]["validity"] == "ok"


def test_result_rates_vacuum_and_large_sphere():
    s = json.loads(json.dumps(DEFAULT_SETUP))
    s["environment"]["pressure"] = 0.0
    r = solve(s)["rates"]
    assert r["gas_damping"] == 0.0
    assert all(m["Q"] is None and m["gas_heating"] == 0.0 for m in r["modes"])
    assert all(m["reheating"] == m["recoil_heating"] > 0 for m in r["modes"])
    # a large sphere is not a dipole, but its own scattered field is used (#78, #95): not approximate
    s["particle"]["radius"] = 600e-9
    big = solve(s)
    models = {m["quantity"]: m for m in big["models"]}
    assert models["recoil_heating"]["model"] == "information"
    assert models["recoil_heating"]["validity"] == "ok"
    assert big["rates"]["scattered_moments"]["mean"][2] > 0.3  # strongly forward



def test_a_coherent_standing_wave_is_exact_from_the_information():
    """Two coherent opposing beams: the photon picture could only average their beam photons, so
    it was approximate (#78). The information follows the field itself, so the solve is ok (#95).
    Without the information (a caller that passes only the Mie moments) the photon picture is
    the fallback, still flagged."""
    s = json.loads(json.dumps(DEFAULT_SETUP))
    s["particle"]["radius"] = 50e-9
    b1 = s["trap"]["fields"][0]
    b2 = dict(b1, id="beam2", direction=[0, 0, -1])
    s["trap"]["fields"] = [b1, b2]
    incoherent = {m["quantity"]: m for m in solve(s)["models"]}["recoil_heating"]
    assert incoherent["model"] == "information" and incoherent["validity"] == "ok"
    b2["coherent_with"] = b1["id"]
    r = solve(s)
    coherent = {m["quantity"]: m for m in r["models"]}["recoil_heating"]
    assert coherent["model"] == "information" and coherent["validity"] == "ok"
    assert not any("standing wave" in n for n in coherent["notes"])
    for m in r["rates"]["modes"]:
        assert m["recoil_heating"] == pytest.approx(m["recoil_scattered"] + m["recoil_incident"] + m["recoil_cross"])
    # the fallback: the same kind of field without its information
    from levtrap.setup import parse
    ps = parse(s)
    ps["particle"].update(density=RHO)
    parts = [dict(P_sca=1e-9, mean=(0, 0, 0), second=rates.dipole_second_moment("x"),
                  beams=[((0, 0, 1), 0.5), ((0, 0, -1), 0.5)])]
    modes = [dict(name="z", axis=[0, 0, 1], frequency=1e5)]
    _, models = rates.rates_block(ps, modes=modes, mass=M, P_sca=1e-9, P_abs=0.0, scattering=parts)
    assert models[1]["model"] == "mie-pattern" and models[1]["validity"] == "approximate"
    assert any("standing wave" in n for n in models[1]["notes"])
    assert "position information not available: plane-wave photon picture" in models[1]["notes"]


def test_absorbed_photons_are_noted_and_make_the_recoil_approximate():
    """The information covers the scattered light only. A sphere that absorbs much of the light
    gets a note with P_abs / P_sca, and above 10 % the recoil is approximate (#95)."""
    s = json.loads(json.dumps(DEFAULT_SETUP))
    s["particle"] = dict(radius=100e-9, n=1.45, k=0.01, density=2200)
    r = solve(s)
    rec = {m["quantity"]: m for m in r["models"]}["recoil_heating"]
    ratio = r["rates"]["P_abs"] / r["rates"]["P_sca"]
    assert ratio > 0.1
    assert rec["model"] == "information" and rec["validity"] == "approximate"
    assert any(n.startswith(f"absorbed photons (P_abs = {ratio:.2g} P_sca) are not included") for n in rec["notes"])
    # a weak absorber: the note, but still ok
    s["particle"]["k"] = 1e-3
    r = solve(s)
    rec = {m["quantity"]: m for m in r["models"]}["recoil_heating"]
    assert 0.01 < r["rates"]["P_abs"] / r["rates"]["P_sca"] < 0.1
    assert rec["validity"] == "ok"
    assert any(n.startswith("absorbed photons") for n in rec["notes"])


def test_rates_block_without_pattern_falls_back_to_the_dipole():
    """Without a Mie pattern (a caller that passes none) the dipole pattern is used, and a
    sphere whose electric dipole carries little of the scattered power is flagged (#78)."""
    from levtrap.setup import parse
    s = parse(DEFAULT_SETUP)
    s["particle"].update(density=RHO)
    modes = [dict(name=a, axis=list(v), frequency=1e5) for a, v in (("x", (1, 0, 0)), ("y", (0, 1, 0)), ("z", (0, 0, 1)))]
    block, models = rates.rates_block(s, modes=modes, mass=M, P_sca=1e-9, P_abs=0.0, ed_fraction=0.5)
    assert models[1]["model"] == "dipole-pattern" and models[1]["validity"] == "approximate"
    assert any("electric dipole carries 50%" in n for n in models[1]["notes"])
    assert "scattered_moments" not in block
    x, y, z = block["modes"]
    assert y["recoil_scattered"] == pytest.approx(2 * x["recoil_scattered"], rel=1e-12)
    assert z["recoil_incident"] == pytest.approx(2.5 * z["recoil_scattered"], rel=1e-12)  # 1 against 2/5
    assert z["recoil_cross"] == 0


def test_cross_term_forward_and_backward():
    """A photon scattered straight forward gives no kick: with <n> = e_in and <n n> = e_in e_in,
    A_z = 1 + 1 - 2 = 0; straight back, A_z = 1 + 1 + 2 = 4 (#78)."""
    P, wl, Om = 1e-4, 1064e-9, 2 * math.pi * 1e5
    unit = 2 * math.pi * C / wl * P / (2 * M * C**2 * Om)
    zz = np.diag([0.0, 0.0, 1.0])
    fwd = rates.recoil_heating(P, wl, M, Om, (0, 0, 1), zz, scattered_mean=(0, 0, 1))
    back = rates.recoil_heating(P, wl, M, Om, (0, 0, 1), zz, scattered_mean=(0, 0, -1))
    assert fwd["total"] == pytest.approx(0, abs=1e-12 * unit)
    assert back["total"] == pytest.approx(4 * unit, rel=1e-12)
    assert back["cross"] == pytest.approx(2 * unit, rel=1e-12)
    # an axis normal to the beam has no cross term
    assert rates.recoil_heating(P, wl, M, Om, (1, 0, 0), zz, scattered_mean=(0, 0, 1))["cross"] == 0


def test_recoil_tensors_two_beams():
    """Two incoherent fields along +z and -z: the beam term along z stays 1, the cross terms of
    their forward-peaked patterns add as e_f <n>_f, both negative (#78)."""
    S = np.diag([0.1, 0.1, 0.8])
    parts = [dict(P_sca=1.0, mean=(0, 0, 0.5), second=S, beams=[((0, 0, 1), 1.0)]),
             dict(P_sca=3.0, mean=(0, 0, -0.5), second=S, beams=[((0, 0, -1), 1.0)])]
    t = rates.recoil_tensors(parts)
    np.testing.assert_allclose(t["beam"], np.diag([0, 0, 1.0]), atol=1e-15)
    np.testing.assert_allclose(t["cross"], np.diag([0, 0, 0.5]), atol=1e-15)
    np.testing.assert_allclose(t["mean"], [0, 0, -0.25], atol=1e-15)
    np.testing.assert_allclose(t["second"], S, atol=1e-15)


def _scattered_moments(radius, n):
    """<n> and <n n> of the Mie pattern for a sphere at the focus of an x-polarised NA 0.8 beam."""
    from levtrap.api import _single_beam, _tmatrix
    from levtrap.fields import OpticalField
    beam = _single_beam(dict(wavelength=1.064e-6, mode=dict(type="lg", indices=[0, 0]),
                             focus=dict(kind="lens", NA=0.8), polarisation="x"), 1.0)
    T, _ = _tmatrix(dict(radius=radius, n=n, k=0.0), 1.064e-6, 1.0)
    return OpticalField(beam, T, 1.0).scattering(np.zeros(3))


def test_mie_pattern_of_a_small_sphere_is_the_dipole_one():
    """A 50 nm silica sphere scatters as an electric dipole: its Mie <n n> is
    diag(1/5, 2/5, 2/5) to well within 1 % and <n> is nearly 0 (#78)."""
    sc = _scattered_moments(50e-9, 1.45)
    np.testing.assert_allclose(sc["second"], rates.dipole_second_moment("x"), atol=0.004)
    assert np.trace(sc["second"]) == pytest.approx(1, rel=1e-9)
    assert np.linalg.norm(sc["mean"]) < 0.02


def test_mie_pattern_at_a_quadrupole_resonance_is_not_the_dipole_one():
    """A 210 nm sphere of index 3.5 at 1064 nm, at its magnetic quadrupole resonance (73 % of the
    scattered power), scatters nothing like a dipole: <n n> is off by more than 0.1 and the
    pattern is forward-peaked, so the recoil along y and z differs from the dipole estimate (#78)."""
    from levtrap.derived import mie_efficiencies
    q = mie_efficiencies(210e-9, 1.064e-6, 3.5)
    assert q["Qsca_multipoles"]["MQ"] / q["Qsca"] > 0.7
    sc = _scattered_moments(210e-9, 3.5)
    assert np.trace(sc["second"]) == pytest.approx(1, rel=1e-9)
    assert np.abs(sc["second"] - rates.dipole_second_moment("x")).max() > 0.1
    assert sc["mean"][2] > 0.1
    P, wl, Om = 1e-4, 1064e-9, 2 * math.pi * 1e5
    for ax in ((0, 1, 0), (0, 0, 1)):
        mie = rates.recoil_heating(P, wl, M, Om, ax, sc["second"], scattered_mean=sc["mean"])["total"]
        dip = rates.recoil_heating(P, wl, M, Om, ax, rates.dipole_second_moment("x"))["total"]
        assert abs(mie / dip - 1) > 0.1


def test_gas_damping_is_jain_2016_eq_7_in_ultrahigh_vacuum():
    """Jain et al., PRL 116, 243601 (2016), Eq. 7: gamma_th = 15.8 R^2 P / (m v_rms),
    v_rms = sqrt(3 k_B T / m_gas), for pressures below 10 mbar. levtrap's free-molecular
    limit is Epstein's diffuse drag, 3.85 P / (rho R v_rms) against the paper's 3.77
    (its 15.8 is rounded): within 3 %. (#61: the gas heating it gives at the paper's
    3e-8 mbar is about as large as the photon recoil.)"""
    R, rho, T, P = 52.7e-9, 2200.0, 300.0, 3e-6  # Pa
    g = rates.gas_properties("N2", T)
    mass = sphere_mass(R, rho)
    v_rms = math.sqrt(3 * KB * T / g["mass"])
    eq7 = 15.8 * R**2 * P / (mass * v_rms)
    assert rates.gas_damping(P, R, mass, g["viscosity"], g["mass"], T) == pytest.approx(eq7, rel=0.03)
