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


# ---------------------------------------------------------------------------
# several beams: coherent groups in any direction, incoherent fields (#76)
# ---------------------------------------------------------------------------

#: The mirror-symmetric four-beam dark trap of #71 (its second setup): WS2,
#: R = 300 nm; LG00 + LG10 (phase pi) along +z, the same pair along -z with
#: Circular - and phases pi / 0, all four coherent with beam 1.
FOUR_BEAM = {
    "version": 1,
    "particle": {"radius": 3e-7, "material": "WS2"},
    "environment": {"pressure": 1e-4, "temperature": 300, "gas": "N2", "medium_index": 1},
    "trap": {"fields": [
        {"kind": "beam", "id": "b1", "wavelength": 1.55e-6, "power": 0.1483,
         "focus": {"kind": "lens", "waist": 1.59e-6}, "mode": {"type": "lg", "indices": [0, 0]},
         "polarisation": "circular+"},
        {"kind": "beam", "id": "b2", "coherent_with": "b1", "wavelength": 1.55e-6, "power": 0.2517,
         "focus": {"kind": "lens", "waist": 8.66e-7}, "mode": {"type": "lg", "indices": [1, 0]},
         "polarisation": "circular+", "phase": math.pi},
        {"kind": "beam", "id": "b3", "coherent_with": "b1", "wavelength": 1.55e-6, "power": 0.1483,
         "focus": {"kind": "lens", "waist": 1.59e-6}, "mode": {"type": "lg", "indices": [0, 0]},
         "polarisation": "circular-", "direction": [0, 0, -1], "position": [0, 0, 0], "phase": math.pi},
        {"kind": "beam", "id": "b4", "coherent_with": "b1", "wavelength": 1.55e-6, "power": 0.2517,
         "focus": {"kind": "lens", "waist": 8.66e-7}, "mode": {"type": "lg", "indices": [1, 0]},
         "polarisation": "circular-", "direction": [0, 0, -1], "position": [0, 0, 0], "phase": 0},
    ]},
}


def _beam(**kw):
    b = {"kind": "beam", "wavelength": WL, "power": 0.1, "focus": {"kind": "lens", "NA": 0.8},
         "mode": {"type": "lg", "indices": [0, 0]}, "polarisation": "x"}
    b.update(kw)
    return b


def _with_beams(*beams):
    return dict(DEFAULT_SETUP, trap={"fields": list(beams)})


def _pattern_at(setup, r=(0.0, 0.0, 0.0)):
    """The pattern block with the particle at r (no trap search). The particle is
    passed as given, so each field's T-matrix uses the material's n at its own
    wavelength, as solve() does."""
    from levtrap.setup import parse
    from levtrap.solve import pattern_result
    s = parse(setup)
    return pattern_result(s, np.asarray(r, dtype=float))


def test_four_beam_dark_trap_is_mirror_symmetric():
    """#76: the mirror-symmetric four-beam trap of #71 (its equilibrium is z = 0)
    scatters as much, and as much position information, forward as backward:
    a coherent group with beams along +z and -z is scattered from its summed
    incident beam, and its pattern integrates to the Result's P_sca."""
    r = solve(FOUR_BEAM, want=["pattern"])
    p = r["pattern"]
    assert abs(r["equilibrium"][2]) < 1e-9
    assert p["P_sca"] == pytest.approx(r["optical"]["P_sca"], rel=1e-3)
    f, b = p["information_efficiency"]["forward"], p["information_efficiency"]["backward"]
    for ax in "xyz":
        assert np.allclose(f[ax], b[ax], rtol=1e-9, atol=1e-12), ax
    assert np.allclose(p["collection"]["forward"], p["collection"]["backward"], rtol=1e-9, atol=1e-12)
    assert p["at_trap_NA"]["forward"]["information"]["z"] == pytest.approx(
        p["at_trap_NA"]["backward"]["information"]["z"], rel=1e-9)
    # circular light about z: x and y carry the same information; the mean photon direction is 0
    assert p["information_total"]["x"] == pytest.approx(p["information_total"]["y"], rel=1e-6)
    assert np.allclose(p["moments"]["mean"], 0, atol=1e-9)
    assert p["trap_axis"] == [0.0, 0.0, 1.0]


def _mirror_index(theta, phi):
    """Index j of the grid point R n_i for each grid direction n_i, R = diag(1, -1, -1)."""
    n = _unit(theta, phi)
    m = n * np.array([1.0, -1.0, -1.0])
    j = np.argmax(m @ n.T, axis=1)
    assert np.allclose(n[j], m, atol=1e-9)  # the grid is closed under R
    return j


def test_beam_along_minus_z_is_the_plus_z_pattern_turned():
    """#76: the pattern is in the lab frame. A beam along -z is the +z beam
    turned by R = diag(1, -1, -1) (pi about x), so its pattern at n is the +z
    beam's at R n; so are its information patterns (|dF/dr_j|^2 does not see
    the sign of r_j); collection forward and backward swap."""
    up = _pattern_at(_with_beams(_beam(id="a")))
    down = _pattern_at(_with_beams(_beam(id="a", direction=[0, 0, -1])))
    th, ph = np.array(up["grid"]["theta"]), np.array(up["grid"]["phi"])
    assert down["grid"]["theta"] == up["grid"]["theta"]
    j = _mirror_index(th, ph)
    for key in ("scattered", "total"):
        u = np.array(up[key])
        assert np.allclose(np.array(down[key]), u[j], rtol=1e-6, atol=1e-9 * u.max()), key
    for ax in "xyz":
        u = np.array(up["information"][ax])
        assert np.allclose(np.array(down["information"][ax]), u[j], rtol=1e-6, atol=1e-9 * u.max()), ax
    assert np.allclose(down["collection"]["forward"], up["collection"]["backward"], rtol=1e-6)
    assert np.allclose(down["collection"]["backward"], up["collection"]["forward"], rtol=1e-6)
    # the trapping lens is the -z beam's own: what it collects looking back is the same
    assert down["trap_axis"] == [0.0, 0.0, -1.0]
    assert down["at_trap_NA"]["backward"]["collection"] == pytest.approx(
        up["at_trap_NA"]["backward"]["collection"], rel=1e-6)


def test_incoherent_opposing_beams_add_their_patterns():
    """#76: two opposing beams that do not interfere (no ``coherent_with``)
    give the sum of the two single-beam patterns (scattered, total and
    information), with collected powers and information added before the
    fractions are taken. The beams differ (polarisation, power) so nothing
    holds by symmetry alone; the particle sits off-axis."""
    a = _beam(id="a", power=0.15)
    b = _beam(id="b", power=0.05, polarisation="y", direction=[0, 0, -1])
    r = (40e-9, -25e-9, 60e-9)
    pa, pb = _pattern_at(_with_beams(a), r), _pattern_at(_with_beams(b), r)
    both = _pattern_at(_with_beams(a, b), r)
    assert both["grid"] == pa["grid"]
    for key in ("scattered", "total"):
        assert np.allclose(both[key], np.add(pa[key], pb[key]), rtol=1e-9, atol=0), key
    for ax in "xyz":
        assert np.allclose(both["information"][ax], np.add(pa["information"][ax], pb["information"][ax]),
                           rtol=1e-9, atol=0), ax
        assert both["information_total"][ax] == pytest.approx(
            pa["information_total"][ax] + pb["information_total"][ax], rel=1e-9)
    assert both["P_sca"] == pytest.approx(pa["P_sca"] + pb["P_sca"], rel=1e-9)
    for d in pt.DIRECTIONS:
        ref = np.multiply(pa["collection"][d], pa["P_sca"]) + np.multiply(pb["collection"][d], pb["P_sca"])
        assert np.allclose(both["collection"][d], ref / both["P_sca"], rtol=1e-9), d
    # the first beam's lens is the trapping lens
    assert both["trap_axis"] == [0.0, 0.0, 1.0] and both["trap_NA"] == pytest.approx(0.8)



def test_incoherent_beams_of_two_wavelengths_add_information_not_power():
    """#76: the shot-noise Fisher information of a field goes as |dF/dr|^2 / (hbar omega).
    Two incoherent beams of different wavelengths add their scattered powers as they are,
    but the second beam's information is weighted by omega_ref / omega = lambda_b / lambda_a
    (the first beam's units): at 532 nm a watt carries half the photons it does at 1064 nm."""
    a = _beam(id="a", power=0.15)
    b = _beam(id="b", power=0.05, wavelength=0.532e-6, direction=[0, 0, -1])
    r = (30e-9, 0.0, 40e-9)
    pa, pb = _pattern_at(_with_beams(a), r), _pattern_at(_with_beams(b), r)
    both = _pattern_at(_with_beams(a, b), r)
    assert both["P_sca"] == pytest.approx(pa["P_sca"] + pb["P_sca"], rel=1e-9)
    weight = 0.532 / 1.064
    for ax in "xyz":
        assert both["information_total"][ax] == pytest.approx(
            pa["information_total"][ax] + weight * pb["information_total"][ax], rel=1e-9), ax
        assert np.allclose(both["information"][ax],
                           np.add(pa["information"][ax], weight * np.asarray(pb["information"][ax])), rtol=1e-9), ax

@pytest.mark.parametrize("beams", [
    # one coherent group, foci 0.4 um apart along z (a translated beam in the summed field)
    [_beam(id="a"), _beam(id="b", coherent_with="a", power=0.05, direction=[0, 0, -1], position=[0, 0, 0.4e-6])],
    # a beam tilted by 45 degrees in x-z, off the origin, that does not interfere with the first
    [_beam(id="a"), _beam(id="b", power=0.05, direction=[1, 0, 1], position=[0.1e-6, 0, 0])],
], ids=["multi-focus coherent", "crossed incoherent"])
def test_multi_beam_pattern_integrates_to_P_sca(beams):
    """#76: for a multi-focus group and for a tilted incoherent beam, the
    pattern (each field's incident beam turned into the lab frame about the
    particle) integrates to the P_sca the Result takes from the force path
    (each field in its own frame), at the equilibrium."""
    r = solve(_with_beams(*beams), want=["pattern"])
    assert r["stable"]
    p = r["pattern"]
    assert p["P_sca"] == pytest.approx(r["optical"]["P_sca"], rel=1e-6)
    assert np.sum(np.array(p["grid"]["weight"]) * np.array(p["scattered"])) == pytest.approx(p["P_sca"], rel=1e-12)


def test_single_beam_along_z_is_unchanged():
    """#76: for one beam along +z the pattern is the one of the beam built
    directly (``api.build_beam``), translated to the equilibrium: the frame
    change of the multi-beam path is the identity there."""
    from levtrap.api import build_beam, build_tmatrix
    from levtrap.setup import parse
    from levtrap.solve import resolve_particle
    r = solve(DEFAULT_SETUP, want=["pattern"])
    s = parse(DEFAULT_SETUP)
    resolve_particle(s)
    beam, _ = build_beam(s)
    T, _ = build_tmatrix(s)
    ref = pt.pattern_block(beam.translate_xyz(np.asarray(r["equilibrium"])), T, n_medium=1.0, trap_NA=0.8)
    p = r["pattern"]
    for key in ("scattered", "total", "collection", "information_efficiency", "at_trap_NA", "P_sca"):
        assert p[key] == ref[key], key
