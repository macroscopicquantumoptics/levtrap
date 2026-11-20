"""#48: the light's intensity on the lab planes through the trap (``want=["field"]``)."""

import copy

import numpy as np
import pytest

from levtrap import api
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve


def _setup(*beams, **particle):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["trap"]["fields"] = [dict(kind="beam", wavelength=1.064e-6, power=0.2, focus=dict(kind="lens", NA=0.8), **b)
                           for b in beams]
    s["particle"].update(particle)
    return s


def _at(block, plane, i, j):
    """(lab point, intensity) of grid node (u[i], v[j]) of a plane."""
    P = block["planes"][plane]
    a, b = {"xz": (0, 2), "yz": (1, 2), "xy": (0, 1)}[plane]
    r = np.array(block["centre"], dtype=float)
    r[a], r[b] = P["u"][i], P["v"][j]
    return r, P["I"][j][i]


def test_the_slice_is_the_field_api_field3d_draws():
    s = copy.deepcopy(DEFAULT_SETUP)
    f = solve(s, want=["field"])["field"]
    assert set(f["planes"]) == {"xz", "yz", "xy"}
    beam, _ = api.build_beam(*api.prepare(dict(setup=s)))
    rng = np.random.default_rng(0)
    for plane in f["planes"]:
        nodes = [(int(rng.integers(0, 81)), int(rng.integers(0, 81))) for _ in range(12)]
        pts = np.array([_at(f, plane, i, j)[0] for i, j in nodes])
        want = 4 * beam.k_medium**2 * np.sum(np.abs(beam.em_field_xyz(pts)) ** 2, axis=1)
        got = np.array([_at(f, plane, i, j)[1] for i, j in nodes])
        np.testing.assert_allclose(got, want, rtol=1e-9, atol=1e-12 * f["max"])
    # the planes pass through the equilibrium, and the brightest light is near the focus
    r = solve(s)
    assert f["centre"] == pytest.approx(r["equilibrium"])
    xz = np.array(f["planes"]["xz"]["I"])
    j, i = np.unravel_index(np.argmax(xz), xz.shape)
    assert abs(f["planes"]["xz"]["u"][i]) < 0.1e-6 and abs(f["planes"]["xz"]["v"][j]) < 0.5e-6


def test_the_slice_follows_a_turned_beam():
    """A beam along +x focused at p: the x-z plane is the +z beam's z-x plane, turned."""
    p = [1e-6, 0.0, -0.5e-6]
    along_z = solve(_setup({}), want=["field"])["field"]
    along_x = solve(_setup(dict(direction=[1, 0, 0], position=p)), want=["field"])["field"]
    assert along_x["max"] == pytest.approx(along_z["max"], rel=1e-6)
    I = np.array(along_x["planes"]["xz"]["I"])
    j, i = np.unravel_index(np.argmax(I), I.shape)
    # brightest along the beam's axis (z = p_z), near its focus (x = p_x)
    assert along_x["planes"]["xz"]["v"][j] == pytest.approx(p[2], abs=0.1e-6)
    assert along_x["planes"]["xz"]["u"][i] == pytest.approx(p[0], abs=0.5e-6)
    # the beam is narrow across z and long along x
    row, col = I[j, :], I[:, i]
    assert (row > 0.5 * I.max()).sum() * np.diff(along_x["planes"]["xz"]["u"])[0] > \
        (col > 0.5 * I.max()).sum() * np.diff(along_x["planes"]["xz"]["v"])[0]


def test_beams_that_do_not_interfere_add_and_coherent_ones_make_fringes():
    one = solve(_setup({}), want=["field"])["field"]
    # two identical beams along +z, not coherent: twice the intensity
    two = solve(_setup(dict(id="a"), dict(id="b")), want=["field"])["field"]
    a, b = np.array(one["planes"]["xz"]["I"]), np.array(two["planes"]["xz"]["I"])
    if one["centre"] == two["centre"]:
        np.testing.assert_allclose(b, 2 * a, rtol=1e-9)
    else:
        assert two["max"] == pytest.approx(2 * one["max"], rel=0.05)
    # counter-propagating and coherent: a standing wave along z. In a focus the light runs at angles
    # up to theta_max (sin theta_max = NA), so the axial period lies between lambda/2 and
    # lambda / (2 cos theta_max)
    sw = solve(_setup(dict(id="a"), dict(id="b", coherent_with="a", direction=[0, 0, -1])), want=["field"])["field"]
    z = np.array(sw["planes"]["xz"]["v"])
    i0 = int(np.argmin(np.abs(np.array(sw["planes"]["xz"]["u"]) - sw["centre"][0])))
    line = np.array(sw["planes"]["xz"]["I"])[:, i0]
    peaks = [k for k in range(1, len(line) - 1) if line[k] > line[k - 1] and line[k] > line[k + 1] and line[k] > 0.3 * line.max()]
    assert len(peaks) >= 4
    gap = np.median(np.diff(z[peaks]))
    assert 1.064e-6 / 2 < gap < 1.064e-6 / (2 * np.sqrt(1 - 0.8**2))


def test_no_light_no_field():
    s = dict(version=1, particle=dict(radius=5e-6, n=1.45, density=2200, charge=1e4),
             trap=dict(fields=[dict(kind="paul", geometry="ring", rf_voltage=50, rf_frequency=500, r0=1e-3,
                                    z0=1e-3 / np.sqrt(2))]))
    assert solve(s, want=["field"])["field"] is None
