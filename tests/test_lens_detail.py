"""#49: a real lens's traced rays and wavefront error (``want=["lens"]``)."""

import copy

import numpy as np
import pytest

from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import UnsupportedSetup, solve


def asphere(tilt=(0.0, 0.0), decentre=(0.0, 0.0), **beam):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["trap"]["fields"][0].update(focus=dict(kind="asphere", beam_diameter=5e-3, tilt_deg=list(tilt),
                                             decentre=list(decentre)), **beam)
    return s


def focus_of(s, lens):
    """Where the lens focuses in the lab: the beam's position plus the reported shift."""
    return np.asarray(s["trap"]["fields"][0].get("position", [0, 0, 0]), dtype=float) + np.asarray(lens["focus_shift"])


def ends(lens):
    e = np.array([r["points"][-1] for r in lens["rays"]])
    w = np.array([r["weight"] for r in lens["rays"]])
    return e, w


def weighted_rms(wf):
    W = np.array([[np.nan if v is None else v for v in row] for row in wf["W"]])
    wt = np.array(wf["weight"])
    ok = np.isfinite(W)
    return float(np.sqrt(np.sum(wt[ok] * W[ok] ** 2) / np.sum(wt[ok])))


@pytest.mark.parametrize("tilt,decentre", [((0.0, 0.0), (0.0, 0.0)), ((0.0, 0.3), (0.0, 0.0)), ((0.0, 0.0), (2e-4, 0.0))])
def test_the_rays_end_at_the_reported_focus_and_the_map_has_the_reported_rms(tilt, decentre):
    s = asphere(tilt, decentre)
    lens = solve(s, want=["lens"])["lenses"][0]
    # the wavefront map's rms is the lens's rms_waves
    assert weighted_rms(lens["wavefront"]) == pytest.approx(lens["rms_waves"], rel=1e-9)
    # two fans across the beam, each ray from the incoming beam through both surfaces to the focus plane
    assert {r["fan"] for r in lens["rays"]} == {"x", "y"}
    assert all(len(r["points"]) == 4 for r in lens["rays"])
    e, w = ends(lens)
    F = focus_of(s, lens)
    # every ray ends within the aberrated spot (spherical aberration of the marginal rays); their
    # intensity-weighted mean, at the focus to a fraction of a micrometre
    assert np.max(np.linalg.norm(e - F, axis=1)) < 20e-6
    assert np.linalg.norm(np.sum(w[:, None] * e, axis=0) / w.sum() - F) < 0.3e-6


def test_a_decentred_lens_moves_its_rays_with_its_focus():
    """Decentred by 0.2 mm the focus moves 0.2 mm: the rays end there, not at the aligned focus."""
    s = asphere(decentre=(2e-4, 0.0))
    lens = solve(s, want=["lens"])["lenses"][0]
    e, w = ends(lens)
    mean = np.sum(w[:, None] * e, axis=0) / w.sum()
    assert lens["focus_shift"][0] == pytest.approx(2e-4, rel=1e-3)
    assert mean[0] == pytest.approx(lens["focus_shift"][0], abs=0.1e-6)
    # and the rays start upstream, along the beam (+z), before the lens
    starts = np.array([r["points"][0] for r in lens["rays"]])
    assert np.all(starts[:, 2] < np.array([r["points"][1] for r in lens["rays"]])[:, 2])


def test_the_rays_turn_with_the_beam():
    p = np.array([1e-6, 0.0, 0.0])
    along_z = solve(asphere(), want=["lens"])["lenses"][0]
    along_x = solve(asphere(direction=[1, 0, 0], position=p.tolist()), want=["lens"])["lenses"][0]
    R = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])  # beam_rotation: z -> x about y
    a = np.array([pt for r in along_z["rays"] for pt in r["points"]])
    b = np.array([pt for r in along_x["rays"] for pt in r["points"]])
    np.testing.assert_allclose(b, a @ R.T + p, atol=1e-12)


def test_only_on_request_and_only_for_a_real_lens():
    plain = solve(asphere())["lenses"][0]
    assert "rays" not in plain and "wavefront" not in plain
    # an ideal lens has no lens block to detail
    assert "lenses" not in solve(DEFAULT_SETUP, want=["lens"])
    paul = dict(version=1, particle=dict(radius=5e-6, n=1.45, density=2200, charge=1e4),
                trap=dict(fields=[dict(kind="paul", geometry="ring", rf_voltage=50, rf_frequency=500, r0=1e-3, z0=7e-4)]))
    with pytest.raises(UnsupportedSetup, match="needs a beam"):
        solve(paul, want=["lens"])
