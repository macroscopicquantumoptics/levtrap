"""C2: radiation pattern, collection efficiency and position-information pattern.

Reference values are analytic limits derived in the docstrings (dipole
radiation, its cone integrals and the dipole model of the information
pattern) or power balance; nothing here is a fitted number.
"""

import json
import math

import numpy as np
import pytest

from levtrap import pattern as pt
from levtrap.bsc import BscPlane, BscPmGauss
from levtrap.derived import power_balance
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve
from levtrap.special import ka2nmax
from levtrap.tmatrix import TmatrixMie

WL = 1064e-9
NA_FOCUS = 0.8


@pytest.fixture(scope="module")
def focus():
    """x-polarised Gaussian beam, NA 0.8 in vacuum, 0.1 W."""
    return BscPmGauss("lg", (0, 0), polarisation=(1, 0), angle=math.asin(NA_FOCUS),
                      index_medium=1.0, wavelength0=WL, power=0.1)


def _unit(th, ph):
    return np.stack([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)], axis=1)


# ---------------------------------------------------------------------------
# power: integral over 4 pi
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("radius,n_p", [(5e-9, 1.45), (300e-9, 1.45 + 0.01j), (1.2e-6, 1.59)])
def test_integral_is_P_sca(focus, radius, n_p):
    """integral dP/dOmega dOmega = P_sca of the power balance (derived.power_balance)."""
    T = TmatrixMie(radius, index_medium=1.0, index_particle=n_p, wavelength0=WL)
    s, _ = focus.scatter(T)
    P_sca = power_balance(focus, s)["sca"] * focus.power
    th, ph, w = pt.sphere_grid(s.Nmax + 3, 2 * s.Nmax + 4)
    assert np.sum(w) == pytest.approx(4 * np.pi, rel=1e-12)
    assert np.sum(w * pt.angular_distribution(s, th, ph)) == pytest.approx(P_sca, rel=1e-3)


def test_total_pattern_is_power_minus_absorption(focus):
    """Light leaving the focus (incident + scattered) carries P_in - P_abs."""
    T = TmatrixMie(400e-9, index_medium=1.0, index_particle=1.5 + 0.05j, wavelength0=WL)
    s, ib = focus.scatter(T)
    pb = power_balance(ib, s)
    n = max(ib.Nmax, s.Nmax)
    th, ph, w = pt.sphere_grid(n + 3, 2 * n + 4)
    Ft, Fp = pt.total_far_field(ib, s, th, ph)
    P_out = np.sum(w * (abs(Ft) ** 2 + abs(Fp) ** 2))
    assert pb["abs"] > 1e-3
    assert P_out == pytest.approx(focus.power * (1 - pb["abs"]), rel=1e-6)


def test_solve_pattern_block():
    """The Result's pattern block integrates to the Result's P_sca and is only made on request."""
    r = solve(DEFAULT_SETUP, want=["pattern"])
    assert "pattern" not in solve(DEFAULT_SETUP)
    p = r["pattern"]
    I = np.array(p["scattered"])
    w = np.array(p["grid"]["weight"])
    assert len(p["grid"]["theta"]) == len(p["grid"]["phi"]) == I.size == len(p["information"]["z"])
    assert np.sum(w * I) == pytest.approx(r["optical"]["P_sca"], rel=1e-3)
    assert p["P_sca"] == pytest.approx(r["optical"]["P_sca"], rel=1e-3)
    assert p["trap_NA"] == pytest.approx(0.8)
    for d in pt.DIRECTIONS:
        c = np.array(p["collection"][d])
        assert np.all(np.diff(c) >= -1e-12) and 0 <= c[0] and c[-1] <= 1 + 1e-9
    # forward + backward hemispheres hold everything
    assert p["collection"]["forward"][-1] + p["collection"]["backward"][-1] == pytest.approx(1, abs=1e-9)
    for ax in "xyz":
        assert (p["information_efficiency"]["forward"][ax][-1]
                + p["information_efficiency"]["backward"][ax][-1]) == pytest.approx(1, abs=1e-9)
    assert np.trace(np.array(p["moments"]["second"])) == pytest.approx(1, abs=1e-9)
    json.dumps(r)


# ---------------------------------------------------------------------------
# small-sphere (dipole) limit
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def dipole(focus):
    """5 nm silica sphere at the focus: k a = 0.03, so (ka)^2 corrections ~ 1e-3."""
    T = TmatrixMie(5e-9, index_medium=1.0, index_particle=1.45, wavelength0=WL)
    s, _ = focus.scatter(T)
    return T, s


def test_dipole_sin2_pattern(dipole):
    """At the focus of an x-polarised beam the field is x-polarised, so the
    sphere radiates as an x dipole: dP/dOmega = (3 P_sca / 8 pi) (1 - (n.x)^2)."""
    _, s = dipole
    th, ph, w = pt.sphere_grid(40, 80)
    I = pt.angular_distribution(s, th, ph)
    P = np.sum(w * I)
    ref = 3 * P / (8 * np.pi) * (1 - _unit(th, ph)[:, 0] ** 2)
    assert np.max(abs(I - ref)) < 2e-3 * ref.max()


def test_dipole_collection_closed_form(dipole):
    """Fraction of an x dipole's power in a cone of half angle alpha (c = cos alpha):

    about an axis normal to the dipole (z or y):
        eta = (3/8pi) int_0^alpha int (1 - sin^2 t cos^2 p) dOmega = 1/2 - 3c/8 - c^3/8,
    about the dipole axis (x):
        eta = (3/8pi) 2pi int_0^alpha sin^3 t dt = 1/2 - 3c/4 + c^3/4.
    """
    _, s = dipole
    NA = np.array([0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0])
    c = np.cos(np.arcsin(NA))
    normal = 0.5 - 3 * c / 8 - c**3 / 8
    along = 0.5 - 3 * c / 4 + c**3 / 4
    for d, ref in (((0, 0, 1), normal), ((0, 0, -1), normal), ((0, 1, 0), normal), ((1, 0, 0), along),
                   ((-1, 0, 0), along)):
        eta = pt.collection_efficiency(s, NA, direction=d)
        assert np.allclose(eta, ref, atol=2e-3, rtol=0), d
    assert pt.collection_efficiency(s, 1.0) == pytest.approx(0.5, abs=2e-3)


def test_dipole_direction_moments(dipole):
    """<n n> of an x dipole: <n_x^2> = 1/5, <n_y^2> = <n_z^2> = 2/5 (the 2/5 of
    Jain et al., PRL 116, 243601 (2016)); <n> = 0."""
    _, s = dipole
    m = pt.direction_moments(s)
    assert np.allclose(m["second"], np.diag([0.2, 0.4, 0.4]), atol=2e-3)
    assert np.allclose(m["mean"], 0, atol=2e-3)


def _dipole_information(beam, th, ph, axis, h=1e-10):
    """Dipole model of the information pattern (analytic limit, derived here).

    A point dipole p = alpha E(r) at r radiates the far field
    G(n; r) = C (1 - n n) E(r) exp(-i k n.r), so

        dG/dr_j |_(r=0) = C (1 - n n) [d_j E(0) - i k n_j E(0)],

    and integral |G|^2 dOmega = |C|^2 (8 pi / 3) |E(0)|^2.  Returns
    |dG/dr_j|^2 / integral |G|^2, comparable to the T-matrix information
    pattern divided by P_sca.  E and its derivative are the beam's own
    (vector, non-paraxial) focal field.
    """
    k = beam.k_medium
    e = np.zeros(3)
    e[axis] = h
    E0 = beam.em_field_xyz(np.zeros((1, 3)))[0]
    dE = (beam.em_field_xyz(e[None]) - beam.em_field_xyz(-e[None]))[0] / (2 * h)
    n = _unit(th, ph)
    v = dE[None, :] - 1j * k * n[:, axis:axis + 1] * E0[None, :]
    v = v - n * np.sum(n * v, axis=1)[:, None]
    return np.sum(abs(v) ** 2, axis=1) / (8 * np.pi / 3 * np.sum(abs(E0) ** 2))


def test_dipole_information_patterns(focus, dipole):
    """Dipole limit of the information patterns for x, y and z motion.

    Reference: the dipole model above, evaluated with the beam's focal field
    (an analytic limit derived in this file).  It is the model of
    Tebbenjohanns, Frimmer & Novotny, Phys. Rev. A 100, 043821 (2019)
    (arXiv:1907.12838); their printed expressions were not compared symbol
    by symbol (the paper could not be retrieved here), so this test checks
    the engine against the derived dipole formula, not against their numbers.
    """
    T, s = dipole
    ia, ib = pt.information_coefficients(focus, T)
    th, ph, w = pt.sphere_grid(40, 80)
    Ft, Fp = pt.far_field(ia, ib, th, ph)
    I = abs(Ft) ** 2 + abs(Fp) ** 2
    P_sca = np.sum(w * pt.angular_distribution(s, th, ph))
    for j in range(3):
        ref = _dipole_information(focus, th, ph, j)
        got = I[:, j] / P_sca
        assert np.max(abs(got - ref)) < 5e-3 * ref.max(), "xyz"[j]


def test_dipole_z_information_gouy_form(focus, dipole):
    """On the axis of the focus E = E_x x e^{i A k z} to first order (|E| is
    stationary at the focus, the phase advances at A k with A < 1 by the Gouy
    phase), so the z information pattern is

        |dG/dz|^2 = k^2 (A - cos theta)^2 |G|^2,

    the form of Tebbenjohanns et al. (2019) for z detection: zero on the cone
    cos theta = A in the forward direction, largest backwards.
    """
    T, s = dipole
    k = focus.k_medium
    h = 1e-10
    Ex = lambda z: focus.em_field_xyz(np.array([[0.0, 0.0, z]]))[0, 0]
    A = ((Ex(h) - Ex(-h)) / (2 * h) / Ex(0)).imag / k
    assert 0.5 < A < 1
    th, ph, w = pt.sphere_grid(40, 80)
    ia, ib = pt.information_coefficients(focus, T, axes=("z",))
    Ft, Fp = pt.far_field(ia, ib, th, ph)
    Iz = (abs(Ft) ** 2 + abs(Fp) ** 2)[:, 0]
    ref = k**2 * (A - np.cos(th)) ** 2 * pt.angular_distribution(s, th, ph)
    assert np.max(abs(Iz - ref)) < 5e-3 * ref.max()
    # backward detection carries most of the z information
    nmax = math.isqrt(ia.shape[0] + 1) - 1
    eff_b = pt._cone_fractions(ia, ib, (0, 0, -1), np.array([np.pi / 2]), nmax)[0, 0]
    assert eff_b / np.sum(w * Iz) > 0.9


# ---------------------------------------------------------------------------
# Mie regime
# ---------------------------------------------------------------------------


def _forward_halfwidth(x):
    """Half-width [rad] at half maximum of the phi-averaged plane-wave pattern.

    ``BscPlane(theta=pi)`` is used because in this engine's field convention
    ``BscPlane(theta=0)`` has the phase exp(-ikz), i.e. travels towards -z.
    """
    k = 2 * np.pi / WL
    T = TmatrixMie(x / k, index_medium=1.0, index_particle=1.45, wavelength0=WL)
    pw = BscPlane(np.pi, 0.0, polarisation=(1, 0), Nmax=ka2nmax(x) + 4, k_medium=k)
    s, _ = pw.scatter(T)
    th = np.linspace(0, np.pi / 2, 721)
    ph = np.arange(16) * 2 * np.pi / 16
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    I = pt.angular_distribution(s, TH.ravel(), PH.ravel()).reshape(TH.shape).mean(axis=1)
    assert np.argmax(I) == 0  # the lobe points along the plane wave
    return th[np.argmax(I < I[0] / 2)]


def test_mie_forward_lobe_narrows():
    """Mie sanity check: the forward lobe narrows as the size parameter grows.

    For large x the lobe approaches Fraunhofer diffraction by a disc of radius
    a, |2 J1(u)/u|^2 with u = x sin(theta), whose half maximum is at
    u = 1.616; the 25 % band only checks the 1/x scaling, it is not a
    reference value for Mie spheres of moderate size.
    """
    xs = [1.0, 3.0, 6.0, 12.0]
    widths = [_forward_halfwidth(x) for x in xs]
    assert all(b < a for a, b in zip(widths, widths[1:])), widths
    for x, w in zip(xs[2:], widths[2:]):
        assert x * math.sin(w) == pytest.approx(1.616, rel=0.25), (x, w)
