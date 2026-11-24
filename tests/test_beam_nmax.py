"""The beam's multipole order is cut to what the probed points need.

A focus with an edge (the filled objective of #63, an aperture) keeps
Nmax ~ 100 in BscPmGauss, and translating a beam costs ~Nmax^3 per point:
15x slower solves, and out-of-memory in tests. Terms above k r carry the field
far from the focus only. ``OpticalField`` cuts the beam per force call to
k r_max + 3 (k r_max)^(1/3) + the particle's order + 4.
"""

import copy

import numpy as np
import pytest

from levtrap.api import _single_beam, _tmatrix
from levtrap.fields import OpticalField
from levtrap.force import forcetorque
from levtrap.setup import DEFAULT_SETUP, parse


@pytest.fixture(scope="module")
def objective():
    """A filled objective at NA 0.8: Nmax 100 uncut."""
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"].update(radius=100e-9, n=1.45, k=0.0, density=2200)
    s["trap"]["fields"][0]["focus"] = {"kind": "lens", "NA": 0.8, "filling": 1.0}
    s = parse(s)
    b = s["trap"]["fields"][0]
    beam = _single_beam(b, 1.0) * np.sqrt(b["power"])
    T, _ = _tmatrix(s["particle"], b["wavelength"], 1.0)
    return OpticalField(beam, T, 1.0)


def test_the_cut_beam_gives_the_same_force(objective):
    assert objective.beam.Nmax >= 90
    rng = np.random.default_rng(1)
    for reach in (0.3e-6, 1e-6, 3e-6):
        pts = rng.uniform(-reach, reach, size=(5, 3))
        full = forcetorque(objective.beam, objective.T, position=pts.T)[0]
        cut = forcetorque(objective._beam_for(pts), objective.T, position=pts.T)[0]
        scale = np.max(np.abs(full))
        np.testing.assert_allclose(cut, full, atol=1e-6 * scale, err_msg=f"reach {reach}")
        assert objective._beam_for(pts).Nmax < objective.beam.Nmax


def test_far_points_keep_the_whole_beam(objective):
    far = np.array([[0.0, 0.0, 30e-6]])
    assert objective._beam_for(far) is objective.beam
    # the order needed grows with the distance
    assert objective.nmax_needed(0.5e-6) < objective.nmax_needed(2e-6) < objective.nmax_needed(6e-6)
