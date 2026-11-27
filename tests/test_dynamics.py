"""#101: dynamic stability with the curl of the force and the gas damping.

A trap is statically stable when the symmetric part of its stiffness matrix
is positive. A curl (K_xy = -K_yx = a, as the spin of circularly polarised
light gives) pushes a displaced particle round the axis; with little damping
its motion spirals out (Svak et al., Nat. Commun. 9, 5453 (2018)).
"""

import copy
import math

import numpy as np
import pytest

from levtrap.rates import damping_pressure, gas_damping, gas_properties
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve
from levtrap.solver import curl, damping_needed, dynamics, without_noise

MASS = 1e-17  # kg
AXES = np.eye(3)


def K_of(kx, ky, kz, a=0.0):
    return np.array([[kx, a, 0.0], [-a, ky, 0.0], [0.0, 0.0, kz]])


@pytest.mark.parametrize("gamma", [0.0, 1e-6, 1.0, 1e4, 1e8])
def test_a_symmetric_K_is_stable_at_any_damping(gamma):
    rng = np.random.default_rng(1)
    Q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    K = Q @ np.diag([1e-6, 2e-6, 5e-7]) @ Q.T
    d = dynamics(K, MASS, gamma, AXES)
    assert not d["unstable"]
    assert d["damping_needed"] == 0.0
    w0 = math.sqrt(2e-6 / MASS)
    assert max(d["growth_rate"]) <= 1e-9 * w0


@pytest.mark.parametrize("gamma", [0.0, 10.0, 100.0])
def test_a_curl_with_equal_stiffness_grows_at_a_w0_over_2k_minus_gamma_over_2(gamma):
    k, a = 1e-6, 2e-8
    w0 = math.sqrt(k / MASS)
    d = dynamics(K_of(k, k, 2 * k, a), MASS, gamma, AXES)
    expected = a * w0 / (2 * k) - gamma / 2
    # exact: Re of (-gamma + sqrt(gamma^2 - 4 (k +- i a) / m)) / 2; the formula is first order in a / k
    assert d["growth_rate"][0] == pytest.approx(expected, rel=1e-3)
    assert d["growth_rate"][1] == pytest.approx(expected, rel=1e-3)
    assert d["growth_rate"][2] == pytest.approx(-gamma / 2, abs=1e-9 * w0)
    assert d["damping_needed"] == pytest.approx(a * w0 / k, rel=1e-3)
    assert d["unstable"]
    # just above the damping needed, every motion decays
    above = dynamics(K_of(k, k, 2 * k, a), MASS, 1.01 * d["damping_needed"], AXES)
    assert not above["unstable"] and max(above["growth_rate"]) < 0


def test_split_stiffness_holds_a_curl_below_half_the_split_without_damping():
    kx, ky = 1e-6, 1.4e-6  # |k_x - k_y| / 2 = 2e-7
    w = math.sqrt(ky / MASS)
    for a in (0.0, 1e-7, 1.9e-7):
        d = dynamics(K_of(kx, ky, 2e-6, a), MASS, 0.0, AXES)
        assert not d["unstable"] and d["damping_needed"] == 0.0
        assert max(d["growth_rate"]) <= 1e-7 * w
    d = dynamics(K_of(kx, ky, 2e-6, 2.1e-7), MASS, 0.0, AXES)
    assert d["unstable"] and d["damping_needed"] > 0 and max(d["growth_rate"]) > 0


def test_damping_needed_marks_the_sign_change_of_the_growth_rate():
    K = K_of(1e-6, 1.2e-6, 3e-6, 3e-7) + np.array([[0, 0, 1e-7], [0, 0, 0], [-1e-7, 0, 0]])
    need = damping_needed(K, MASS)
    assert 0 < need < math.inf
    assert max(dynamics(K, MASS, 0.99 * need, AXES)["growth_rate"]) > 0
    assert max(dynamics(K, MASS, 1.01 * need, AXES)["growth_rate"]) < 0


def test_curl_per_block_and_its_sign():
    K = np.array([[1.0, 0.3, 0.0], [-0.3, 1.0, 0.1], [0.0, -0.1, 2.0]])
    assert curl(K) == pytest.approx(dict(xy=0.3, xz=0.0, yz=0.1))
    # positive xy: a particle at +x is pushed towards +y (F = -K r)
    assert (-K @ np.array([1.0, 0, 0]))[1] > 0


def test_a_curl_within_its_error_is_noise():
    K = np.array([[1.0, 0.3, 1e-4], [-0.3, 1.0, 0.0], [-1e-4, 0.0, 2.0]])
    err = np.full((3, 3), 1e-4)
    # xy is far above its error and stays; xz (1e-4) is within 3 times its error and reads 0
    assert curl(K, err) == pytest.approx(dict(xy=0.3, xz=0.0, yz=0.0))
    clean = without_noise(K, err)
    assert clean[0, 1] == pytest.approx(0.3) and clean[1, 0] == pytest.approx(-0.3)
    assert clean[0, 2] == 0.0 and clean[2, 0] == 0.0
    np.testing.assert_allclose(clean + clean.T, K + K.T)


@pytest.mark.parametrize("direction", [[0, math.sin(0.3), math.cos(0.3)], [math.sin(0.2), math.sin(0.1), 1.0]])
def test_a_tilted_linear_tweezer_shows_no_curl(direction):
    # on its axis a linearly polarised beam has no curl, whichever way it points; the
    # central differences give one of about 1e-5 of K, which must not be shown as a curl
    s = copy.deepcopy(DEFAULT_SETUP)
    s["trap"]["fields"][0]["direction"] = direction
    d = solve(s)["dynamics"]
    assert d["curl"] == dict(xy=0.0, xz=0.0, yz=0.0)
    assert not d["unstable"] and d["damping_needed"] == 0.0


def test_damping_pressure_inverts_the_gas_damping():
    R, m, T = 1e-7, 1e-17, 300.0
    g = gas_properties("N2", T)
    for p in (1e-3, 1.0, 1e3):
        gamma = gas_damping(p, R, m, g["viscosity"], g["mass"], T)
        assert damping_pressure(gamma, R, m, "N2", T) == pytest.approx(p, rel=1e-8)
    stokes = 6 * math.pi * g["viscosity"] * R / m
    assert damping_pressure(2 * stokes, R, m, "N2", T) is None
    assert damping_pressure(0.0, R, m, "N2", T) is None


# --- the engine ------------------------------------------------------------------------

def ws2_dark_trap(polarisation="circular+", pressure=1e-4):
    """The app's WS2 bottle-beam preset (app/src/screen/presets.ts), 1e-6 mbar of N2."""
    beam = dict(kind="beam", wavelength=1.55e-6, polarisation=polarisation)
    return dict(version=1, particle=dict(radius=3e-7, material="WS2"),
                environment=dict(pressure=pressure, temperature=300.0, gas="N2", medium_index=1.0),
                trap=dict(fields=[
                    dict(beam, id="b1", power=0.2966, focus=dict(kind="lens", waist=1.59e-6),
                         mode=dict(type="lg", indices=[0, 0])),
                    dict(beam, id="b2", coherent_with="b1", power=0.5034, focus=dict(kind="lens", waist=8.66e-7),
                         mode=dict(type="lg", indices=[1, 0]), phase=math.pi)]))


@pytest.fixture(scope="module")
def ws2():
    return solve(ws2_dark_trap())


def test_ws2_dark_trap_spirals_out_in_vacuum(ws2):
    assert ws2["stable"]  # statically: the symmetric part holds it
    d = ws2["dynamics"]
    assert d["unstable"]
    names = [m["name"] for m in ws2["modes"]]
    g = dict(zip(names, d["growth_rate"]))
    assert g["x"] > 0 and g["y"] > 0 and g["z"] < 0
    # the curl is in the x-y block, as the light's spin about z gives
    assert abs(d["curl"]["xy"]) > 0.05 * ws2["modes"][0]["stiffness"]
    assert d["curl"]["xz"] == 0.0 and d["curl"]["yz"] == 0.0
    # growth = (a / k) w0 / 2 - gamma / 2, with k = k_x = k_y
    k = ws2["modes"][0]["stiffness"]
    w0 = 2 * math.pi * ws2["modes"][0]["frequency"]
    assert g["x"] == pytest.approx(abs(d["curl"]["xy"]) / k * w0 / 2 - d["gas_damping"] / 2, rel=0.01)
    # the threshold: the pressure whose gas damping equals the damping needed, far above 1e-4 Pa
    p_star = d["pressure_threshold"]
    assert p_star is not None and p_star > 1e2
    assert ws2["warnings"][-1].startswith("The particle spirals out at this pressure")
    # the 3 % note on the accuracy of depth and frequencies stays
    assert any(w.startswith("The force is not conservative here") for w in ws2["warnings"])


def test_ws2_dark_trap_holds_above_the_threshold_pressure(ws2):
    p_star = ws2["dynamics"]["pressure_threshold"]
    above = solve(ws2_dark_trap(pressure=1.2 * p_star))["dynamics"]
    below = solve(ws2_dark_trap(pressure=0.8 * p_star))["dynamics"]
    assert not above["unstable"] and max(above["growth_rate"]) < 0
    assert below["unstable"] and max(below["growth_rate"]) > 0
    assert above["pressure_threshold"] == pytest.approx(p_star, rel=1e-3)


def test_ws2_dark_trap_with_linear_polarisation_has_no_curl():
    r = solve(ws2_dark_trap("x"))
    d = r["dynamics"]
    assert r["stable"] and not d["unstable"]
    assert d["damping_needed"] == 0.0 and d["pressure_threshold"] is None
    assert d["curl"] == dict(xy=0.0, xz=0.0, yz=0.0)
    assert max(d["growth_rate"]) < 0


def test_a_linear_tweezer_does_not_spiral_out():
    r = solve(DEFAULT_SETUP)
    d = r["dynamics"]
    assert r["stable"] and not d["unstable"]
    assert d["pressure_threshold"] is None
    assert max(d["growth_rate"]) == pytest.approx(-d["gas_damping"] / 2, rel=1e-3)


def test_dynamics_is_none_without_a_trap():
    s = copy.deepcopy(DEFAULT_SETUP)
    s["trap"]["fields"][0]["power"] = 1e-6
    s["trap"]["fields"].append(dict(kind="gravity"))
    r = solve(s)
    assert not r["stable"] and r["dynamics"] is None


def paul_with_light(polarisation):
    """A linear Paul trap, a beam and gravity, as in tests/test_hybrid.py."""
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["charge"] = 30
    beam = copy.deepcopy(DEFAULT_SETUP["trap"]["fields"][0])
    beam["polarisation"] = polarisation
    s["trap"]["fields"] = [beam, {"kind": "paul", "geometry": "linear", "rf_voltage": 300, "rf_frequency": 5e3,
                                  "endcap_voltage": 5, "r0": 1e-3, "z0": 2e-3,
                                  "geometry_factors": {"radial": 1.0, "axial": 0.3}}, {"kind": "gravity"}]
    return s


def test_paul_trap_with_circular_light_spirals_out():
    # the RF enters as its pseudopotential (no curl); the light's spin gives the curl
    r = solve(paul_with_light("circular+"))
    d = r["dynamics"]
    assert r["stable"] and d is not None and d["unstable"]
    assert d["damping_needed"] > 0 and d["pressure_threshold"] > s_pressure(r)
    assert d["notes"][-1].startswith("Paul trap: the RF enters as its time-averaged pseudopotential")


def test_paul_trap_with_linear_light_holds():
    r = solve(paul_with_light("x"))
    d = r["dynamics"]
    assert r["stable"] and d is not None and not d["unstable"]
    assert d["pressure_threshold"] is None
    assert d["notes"][-1].startswith("Paul trap: the RF enters as its time-averaged pseudopotential")


def s_pressure(r):
    return r["rates"]["gas"]["pressure"]
