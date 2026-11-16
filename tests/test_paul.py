"""B2: Paul trap field (Leibfried et al., RMP 75, 281 (2003) conventions).

References are analytic or exact numerics: the Mathieu stability boundary
from scipy's characteristic values, and direct integration of the
time-dependent equation of motion.
"""

import copy
import math

import numpy as np
import pytest
from scipy.integrate import solve_ivp
from scipy.special import mathieu_b

from levtrap.derived import sphere_mass
from levtrap.fields.paul import E_CHARGE, PaulField, in_first_region, mathieu_beta
from levtrap.setup import SetupError, parse
from levtrap.solve import solve

RADIUS, DENSITY, CHARGE_E = 5e-6, 2200.0, 1e4
MASS = sphere_mass(RADIUS, DENSITY)
Q = CHARGE_E * E_CHARGE
R0 = 1e-3
F_RF = 500.0
OMEGA = 2 * math.pi * F_RF


def ring(V, U=0.0, **kw):
    """Ring trap with z0 = r0/sqrt(2), so the curvature is 1/r0^2."""
    return dict(kind="paul", geometry="ring", rf_voltage=V, rf_frequency=F_RF, dc_voltage=U,
                r0=R0, z0=R0 / math.sqrt(2), **kw)


def V_for_q(q_r):
    """RF amplitude giving radial |q| = q_r in the ring trap above."""
    return q_r * MASS * OMEGA**2 * R0**2 / (2 * Q)


def setup(*fields):
    return dict(version=1, particle=dict(radius=RADIUS, n=1.45, density=DENSITY, charge=CHARGE_E),
                trap=dict(fields=list(fields)))


def field(f):
    return PaulField(parse(setup(f))["trap"]["fields"][0], Q, MASS)


# --- Mathieu equation ----------------------------------------------------------

@pytest.mark.parametrize("q", [0.05, 0.1, 0.2])
def test_small_q_exact_matches_pseudopotential(q):
    """a = 0: beta -> q / sqrt(2) with an O(q^2) relative correction."""
    beta = mathieu_beta(0.0, q)
    assert beta / (q / math.sqrt(2)) - 1 == pytest.approx(0, abs=q**2)


@pytest.mark.parametrize("a, q", [(0.0, 0.1), (0.0, 0.4), (0.05, 0.3), (-0.02, 0.6)])
def test_beta_matches_independent_monodromy(a, q):
    """Self-consistency (no published table used): the RK4 monodromy exponent
    equals one from a tight adaptive DOP853 integration of the same equation."""
    def f(x, y):
        return [y[1], -(a - 2 * q * math.cos(2 * x)) * y[0]]
    m1 = solve_ivp(f, (0, math.pi), [1, 0], rtol=1e-13, atol=1e-14, method="DOP853").y[:, -1]
    m2 = solve_ivp(f, (0, math.pi), [0, 1], rtol=1e-13, atol=1e-14, method="DOP853").y[:, -1]
    assert mathieu_beta(a, q) == pytest.approx(math.acos(0.5 * (m1[0] + m2[1])) / math.pi, abs=1e-9)


def test_q_correction_shrinks_quadratically():
    err = [abs(mathieu_beta(0.0, q) / (q / math.sqrt(2)) - 1) for q in (0.1, 0.05)]
    assert err[0] / err[1] == pytest.approx(4, rel=0.1)


def test_a_zero_stability_boundary():
    """First region at a = 0 ends where b_1(q) = 0, q = 0.908046 (Mathieu characteristic value)."""
    assert abs(mathieu_b(1, 0.908046)) < 1e-5
    assert mathieu_beta(0.0, 0.90) is not None
    assert mathieu_beta(0.0, 0.915) is None
    assert mathieu_beta(0.0, 0.905) == pytest.approx(1.0, abs=0.1)  # beta -> 1 at the edge
    assert not in_first_region(-0.1, 0.05)  # a below a_0(q): unstable


def test_direct_integration_reproduces_secular_frequency():
    """Integrate x'' = -(Q/m)(c + c' cos Omega t) x and read the secular
    frequency off the spectrum; it matches beta Omega / 2 within 1 %."""
    a, q = 0.02, 0.35
    beta = mathieu_beta(a, q)
    c = a * MASS * OMEGA**2 / (4 * Q)
    cp = -q * MASS * OMEGA**2 / (2 * Q)
    T_sec = 2 * math.pi / (beta * OMEGA / 2)
    t = np.linspace(0, 200 * T_sec, 2**16)
    sol = solve_ivp(lambda t, y: [y[1], -(Q / MASS) * (c + cp * math.cos(OMEGA * t)) * y[0]],
                    (0, t[-1]), [1e-6, 0.0], t_eval=t, method="DOP853", rtol=1e-10, atol=1e-18)
    x = sol.y[0] * np.hanning(t.size)
    spec = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(t.size, t[1] - t[0])
    i = int(np.argmax(spec[1:])) + 1
    y0, y1, y2 = np.log(spec[i - 1:i + 2])  # parabolic peak interpolation
    f_peak = freqs[i] + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) * (freqs[1] - freqs[0])
    assert f_peak == pytest.approx(beta * OMEGA / (4 * math.pi), rel=0.01)


# --- geometry -------------------------------------------------------------------

def test_ring_satisfies_laplace():
    p = field(ring(V_for_q(0.2), U=3.0))
    assert p.a[2] == pytest.approx(-2 * p.a[0]) and p.a[0] == pytest.approx(p.a[1])
    assert p.q[2] == pytest.approx(-2 * p.q[0]) and p.q[0] == pytest.approx(p.q[1])
    assert abs(p.q[0]) == pytest.approx(0.2)


def test_linear_trap_end_caps():
    """Linear: q_x = -q_y, q_z = 0; end caps give omega_z^2 = 2 kappa_z Q U_ec / (m z0^2)
    and the Laplace anti-confinement -omega_z^2 / 2 radially."""
    z0, kz, Uec = 2e-3, 0.3, 50.0
    p = field(dict(kind="paul", geometry="linear", rf_voltage=300, rf_frequency=F_RF, endcap_voltage=Uec,
                   r0=R0, z0=z0, geometry_factors=dict(radial=1.0, axial=kz)))
    assert p.q[0] == pytest.approx(-p.q[1]) and p.q[2] == 0
    wz2 = 2 * kz * Q * Uec / (MASS * z0**2)
    assert p.omega2_pseudo[2] == pytest.approx(wz2)
    assert p.omega2_pseudo[0] == pytest.approx((OMEGA / 2) ** 2 * p.q[0] ** 2 / 2 - wz2 / 2)
    assert sum(p.c_dc) == pytest.approx(0, abs=1e-9 * max(abs(p.c_dc)))  # Laplace


# --- through solve() --------------------------------------------------------------

def test_solve_ring_trap():
    r = solve(setup(ring(V_for_q(0.1))))  # q_z = 0.2
    assert r["stable"] and r["optical"] is None and r["rates"] is None
    assert r["equilibrium"] == pytest.approx([0, 0, 0], abs=1e-15)
    sec = r["paul"]["secular"]
    for m in r["modes"]:  # small q: pseudopotential, within O(q^2) of the exact value
        q = abs(r["paul"]["q"][m["name"]])
        assert m["frequency"] == pytest.approx(sec["pseudopotential"][m["name"]], rel=1e-6)
        assert m["frequency"] == pytest.approx(sec["exact"][m["name"]], rel=q**2)
    assert r["models"][0]["model"] == "pseudopotential"
    assert abs(r["paul"]["q"]["z"]) == pytest.approx(0.2)


def test_large_q_uses_mathieu_and_warns():
    r = solve(setup(ring(V_for_q(0.3))))  # q_z = 0.6
    assert r["stable"]
    assert any("pseudopotential is inaccurate" in w for w in r["warnings"])
    assert r["models"][0]["model"] == "mathieu"
    z = next(m for m in r["modes"] if m["name"] == "z")
    assert z["frequency"] == pytest.approx(r["paul"]["secular"]["exact"]["z"])
    assert z["frequency"] > r["paul"]["secular"]["pseudopotential"]["z"]  # a = 0: pseudo underestimates


def test_outside_stability_region():
    r = solve(setup(ring(V_for_q(0.5))))  # q_z = 1.0 > 0.908
    assert not r["stable"]
    assert r["paul"]["stable"] is False and r["paul"]["secular"]["exact"]["z"] is None
    assert any("Mathieu stability region" in w for w in r["warnings"])


def test_gravity_sag_and_micromotion():
    r0 = solve(setup(ring(V_for_q(0.15))))
    r1 = solve(setup(ring(V_for_q(0.15)), dict(kind="gravity")))
    f_y = next(m for m in r0["modes"] if m["name"] == "y")["frequency"]
    sag = 9.81 / (2 * math.pi * f_y) ** 2
    assert r1["equilibrium"][1] == pytest.approx(-sag, rel=1e-6)
    assert r1["paul"]["micromotion"][1] == pytest.approx(abs(r1["paul"]["q"]["y"]) * sag / 2, rel=1e-6)


def test_neutral_particle_is_a_setup_error():
    s = setup(ring(100.0))
    s["particle"]["charge"] = 0
    with pytest.raises(SetupError) as err:
        solve(s)
    assert err.value.path == "particle.charge"


def test_paul_alone_has_no_pattern():
    from levtrap.solve import UnsupportedSetup
    with pytest.raises(UnsupportedSetup):
        solve(setup(ring(V_for_q(0.15))), want=["pattern"])
    assert "curves" in solve(setup(ring(V_for_q(0.15))), want=["curves"])


def test_material_density_without_a_beam():
    s = setup(ring(V_for_q(0.15)))
    s["particle"] = dict(radius=RADIUS, material="SiO2", charge=CHARGE_E)
    r = solve(copy.deepcopy(s))
    assert r["particle"]["density"] == pytest.approx(2200, rel=0.05)
