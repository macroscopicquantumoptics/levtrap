"""B1: beams with any direction and focus position (issue #10).

Reference values are symmetry identities and the dipole limit
(levtrap.dipole), never fitted numbers.
"""

import copy

import numpy as np
import pytest

from levtrap.api import _single_beam, _tmatrix
from levtrap.derived import C
from levtrap.dipole import dipole_force
from levtrap.fields import OpticalField
from levtrap.optics import _group_beam, beam_rotation, coherent_groups, optical_fields
from levtrap.setup import DEFAULT_SETUP, parse
from levtrap.solve import resolve_particle, solve

BEAM = DEFAULT_SETUP["trap"]["fields"][0]
WL = BEAM["wavelength"]


def setup(*beams, radius=1e-7):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["radius"] = radius
    s["trap"]["fields"] = [{**copy.deepcopy(BEAM), **b} for b in beams]
    return s


def fields_of(s, nmax_factor=1.0):
    p = parse(s)
    resolve_particle(p)
    nm = p["environment"]["medium_index"]
    return p, optical_fields(p, _single_beam, lambda wl: _tmatrix(p["particle"], wl, nm)[0], nmax_factor)


def total(fields, r):
    return sum(f.force(r) for f in fields)


def points(n=7, scale=0.6e-6, seed=1):
    return np.random.default_rng(seed).uniform(-scale, scale, (n, 3))


def rel(a, b):
    return np.max(np.abs(a - b)) / np.max(np.abs(b))


# --- rotation ---------------------------------------------------------------


@pytest.mark.parametrize("d", [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0, 1, 0], [1, 2, -3]])
def test_beam_rotation_takes_z_to_the_direction(d):
    R = beam_rotation(d)
    assert np.allclose(R @ R.T, np.eye(3)) and np.isclose(np.linalg.det(R), 1)
    assert np.allclose(R @ [0, 0, 1], np.asarray(d) / np.linalg.norm(d))


def test_a_beam_along_minus_z_keeps_lab_x():
    """The documented convention: own x = lab x, own y = lab -y."""
    assert np.allclose(beam_rotation([0, 0, -1]), np.diag([1, -1, -1]))


def test_rotated_by_180_about_y_gives_the_mirrored_force():
    """F'(r) = M F(M r) with M = diag(-1, 1, -1), the force of the beam turned about y."""
    _, (f,) = fields_of(setup({}))
    M = np.diag([-1.0, 1.0, -1.0])
    turned = OpticalField(f.beam, f.T, f.n_medium, rotation=M)
    r = points()
    assert rel(turned.force(r), f.force(r @ M) @ M) < 1e-6
    # along the axis: Fz'(z) = -Fz(-z)
    z = np.linspace(-1e-6, 1e-6, 9)
    line = np.stack([0 * z, 0 * z, z], 1)
    assert rel(turned.force(line)[:, 2], -f.force(-line)[:, 2]) < 1e-6


@pytest.mark.parametrize("d", [[0, 0, -1], [1, 0, 0], [0.3, -0.4, 0.5]])
def test_rotated_coefficients_agree_with_the_rotated_frame(d):
    """The two ways of turning a beam (its BSC by Wigner matrices for coherent
    sums, its frame for a single beam) give the same force: this fixes the
    sign convention of Bsc.rotate."""
    p, (frame,) = fields_of(setup({"direction": d}))
    spec = p["trap"]["fields"][0]
    unit = _single_beam(spec, 1.0)
    coeffs = OpticalField(_group_beam([spec], [unit], np.zeros(3), frame.T.Nmax[0]), frame.T, 1.0)
    r = points()
    assert rel(coeffs.force(r), frame.force(r)) < 1e-6


def test_a_turned_trap_is_the_same_trap():
    a = solve(setup({}))
    b = solve(setup({"direction": [1, 0, 0]}))
    assert b["equilibrium"][0] == pytest.approx(a["equilibrium"][2], rel=1e-4)
    fa = sorted(m["frequency"] for m in a["modes"])
    fb = sorted(m["frequency"] for m in b["modes"])
    assert fb == pytest.approx(fa, rel=1e-4)
    assert b["depth"]["kT"] == pytest.approx(a["depth"]["kT"], rel=1e-3)
    axial = next(m for m in b["modes"] if m["name"] == "x")
    assert axial["frequency"] == pytest.approx(next(m for m in a["modes"] if m["name"] == "z")["frequency"], rel=1e-4)


# --- groups -----------------------------------------------------------------


def test_coherent_groups_follow_the_links():
    beams = [{"id": "a", "coherent_with": None}, {"id": "b", "coherent_with": "c"},
             {"id": "c", "coherent_with": None}, {"id": None, "coherent_with": "a"}]
    assert coherent_groups(beams) == [[0, 3], [1, 2]]


# --- counter-propagating beams ------------------------------------------------

SMALL = 3e-8  # dipole limit for silica at 1064 nm: k r = 0.18


def test_two_incoherent_opposing_beams_cancel_their_scattering_force():
    s = setup({}, {"id": "beam2", "direction": [0, 0, -1]}, radius=SMALL)
    p, fields = fields_of(s)
    assert len(fields) == 2
    single = fields[0].force(np.zeros(3))[0, 2]
    assert abs(single) > 0
    assert np.max(np.abs(total(fields, np.zeros(3)))) < 1e-6 * abs(single)
    r = solve(s)
    assert r["stable"]
    assert np.max(np.abs(r["equilibrium"])) < 1e-12
    # axial stiffness: the gradient parts add and the scattering parts cancel, so in the
    # dipole limit it is twice the gradient stiffness of one beam (alpha without its
    # radiative correction gives the gradient force alone)
    beam = fields[0].beam
    h = 2e-9
    z = np.array([[0, 0, -h], [0, 0, h]])
    Q = dipole_force(beam, SMALL, complex(p["particle"]["n"], p["particle"]["k"]), z, radiative=False)
    F = Q[2] * beam.power * fields[0].n_medium / C
    k_grad = -(F[1] - F[0]) / (2 * h)
    kz = next(m for m in r["modes"] if m["name"] == "z")["stiffness"]
    assert kz == pytest.approx(2 * k_grad, rel=0.03)


def test_two_coherent_opposing_beams_make_a_standing_wave():
    s = setup({"id": "beam1"}, {"id": "beam2", "direction": [0, 0, -1], "coherent_with": "beam1"}, radius=SMALL)
    p, fields = fields_of(s)
    assert len(fields) == 1
    r = solve(s, ["curves"])
    # in phase and polarised alike: an antinode, so the trap, at the common focus
    assert r["stable"] and np.max(np.abs(r["equilibrium"])) < 1e-12
    # fringes: lambda/2 apart once the Gouy phase stops changing, a few um from the focus
    # (at NA 0.8 the first ones are up to 20 % wider: 638, 616, 572, 537 nm)
    z = np.linspace(2.5e-6, 8e-6, 1100)
    Fz = total(fields, np.stack([0 * z, 0 * z, z], 1))[:, 2]
    crossings = [z[i] - Fz[i] * (z[i + 1] - z[i]) / (Fz[i + 1] - Fz[i]) for i in range(len(z) - 1) if Fz[i] > 0 >= Fz[i + 1]]
    assert len(crossings) >= 4
    assert np.mean(np.diff(crossings)) == pytest.approx(WL / 2, rel=0.01)
    # axial stiffness against the dipole model in the same (focused, interfering) field
    beam = fields[0].beam
    h = 1e-9
    Q = dipole_force(beam, SMALL, complex(p["particle"]["n"], p["particle"]["k"]), np.array([[0, 0, -h], [0, 0, h]]))
    F = Q[2] * beam.power * fields[0].n_medium / C
    kz = next(m for m in r["modes"] if m["name"] == "z")["stiffness"]
    assert kz == pytest.approx(-(F[1] - F[0]) / (2 * h), rel=0.03)
    # it is much stiffer than the travelling-wave trap of the same two beams
    incoherent = solve(setup({}, {"id": "beam2", "direction": [0, 0, -1]}, radius=SMALL))
    assert kz > 5 * next(m for m in incoherent["modes"] if m["name"] == "z")["stiffness"]


def test_an_opposing_circular_beam_keeps_its_helicity():
    """Polarisation is given in each beam's own frame (#71): "circular+" on a beam
    against a "circular+" beam turns the other way in the lab (sigma+ sigma-), so
    the two coherent beams make no intensity standing wave and f_x != f_y. The
    other sign turns the same way in the lab: a standing wave, f_x = f_y and a
    much stiffer z. The app's Add field -> Counter-propagating beam picks it."""
    def freqs(pol):
        s = setup({"id": "beam1", "polarisation": "circular+"},
                  {"id": "beam2", "direction": [0, 0, -1], "coherent_with": "beam1", "polarisation": pol})
        r = solve(s)
        assert r["stable"] and np.max(np.abs(r["equilibrium"])) < 1e-12
        return {m["name"]: m["frequency"] for m in r["modes"]}

    same_lab = freqs("circular-")
    opposite_lab = freqs("circular+")
    assert same_lab["x"] == pytest.approx(same_lab["y"], rel=1e-3)
    assert abs(opposite_lab["x"] / opposite_lab["y"] - 1) > 0.01
    assert same_lab["z"] > 5 * opposite_lab["z"]


def test_separated_foci_trap_at_the_midpoint():
    z0, d = 0.25e-6, 0.4e-6
    s = setup({"position": [0, 0, z0 - d]}, {"id": "beam2", "direction": [0, 0, -1], "position": [0, 0, z0 + d]})
    r = solve(s)
    assert r["stable"]
    x, y, z = r["equilibrium"]
    assert abs(x) < 1e-12 and abs(y) < 1e-12
    assert z == pytest.approx(z0, abs=1e-10)


def test_a_moved_focus_moves_the_trap():
    a = solve(setup({}))
    b = solve(setup({"position": [0.3e-6, -0.2e-6, 0.5e-6]}))
    assert np.allclose(np.subtract(b["equilibrium"], a["equilibrium"]), [0.3e-6, -0.2e-6, 0.5e-6], atol=1e-11)
    assert [m["frequency"] for m in b["modes"]] == pytest.approx([m["frequency"] for m in a["modes"]], rel=1e-4)


def test_translated_coherent_beams_converge_in_nmax():
    """A coherent pair with foci 0.6 um apart: one beam is re-expanded about the
    other's focus. Doubling the Nmax of that expansion changes the force by
    less than 1e-4."""
    s = setup({"id": "beam1"}, {"id": "beam2", "direction": [0, 0, -1], "coherent_with": "beam1",
                                "position": [0.2e-6, 0, 0.6e-6]})
    _, (f1,) = fields_of(s)
    _, (f2,) = fields_of(s, nmax_factor=2.0)
    assert f2.beam.Nmax > f1.beam.Nmax
    r = points(scale=0.4e-6)
    assert rel(f1.force(r), f2.force(r)) < 1e-4


def test_beams_of_two_wavelengths_each_get_their_own_tmatrix():
    s = setup({}, {"id": "beam2", "direction": [0, 0, -1], "wavelength": 1.55e-6})
    _, fields = fields_of(s)
    assert [f.beam.wavelength for f in fields] == pytest.approx([WL, 1.55e-6])
    assert fields[0].T is not fields[1].T
    assert solve(s)["stable"]
