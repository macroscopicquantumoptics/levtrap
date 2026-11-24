"""#64: how an ideal lens's paraxial beam meets the far field (``focus.mapping``).

The default stays OTT's BscPmGauss, the paraxial beam mapped by tan(theta):
papers that used OTT define their NA and waist by it (the WS2 bottle beam,
arXiv:2607.09896), and every recorded number depends on it. ``"sine"``
maps by sin(theta), as a Gaussian's angular spectrum exp(-(k w0 sin(theta) / 2)^2)
does, weighted by sqrt(cos theta) (an aplanatic lens) so that it fades to 0
at 90 degrees: at small NA its waist is the textbook lambda / (pi NA).
"""

import copy
import math

import numpy as np
import pytest

from levtrap.api import _beam_angle, _single_beam
from levtrap.setup import DEFAULT_SETUP, SetupError, parse
from levtrap.solve import solve
from levtrap.special import sbesselj

WL = 1.064e-6


def setup(focus, radius=50e-9):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["radius"] = radius
    s["trap"]["fields"][0]["focus"] = focus
    return s


def focal_radius(focus):
    """The 1/e^2 intensity radius across the focus, perpendicular to the polarisation."""
    beam = _single_beam(parse(setup(focus))["trap"]["fields"][0], 1.0)
    y = np.linspace(0, 4e-6, 1601)
    intensity = np.sum(np.abs(beam.em_field_xyz(np.stack([0 * y, y, 0 * y], 1))) ** 2, 1)
    return y[np.argmax(intensity < intensity[0] * math.exp(-2))]


def test_the_default_is_otts_mapping_unchanged():
    a = solve(setup({"kind": "lens", "NA": 0.8}))
    b = solve(setup({"kind": "lens", "NA": 0.8, "mapping": "ott"}))
    assert [m["frequency"] for m in a["modes"]] == [m["frequency"] for m in b["modes"]]
    assert "mapping" not in parse(setup({"kind": "lens", "NA": 0.8}))["trap"]["fields"][0]["focus"]


def test_the_sine_mapping_focuses_the_textbook_gaussian():
    paraxial = WL / (math.pi * 0.27)
    assert focal_radius({"kind": "lens", "NA": 0.27, "mapping": "sine"}) == pytest.approx(paraxial, rel=0.02)
    # OTT's tan(theta) mapping cuts the wide-angle tail: a wider focus
    assert focal_radius({"kind": "lens", "NA": 0.27}) > 1.05 * paraxial


def test_the_waist_means_what_the_mapping_says():
    w = 1.2e-6
    s = WL / (math.pi * w)
    assert _beam_angle({"waist": w, "mapping": "sine"}, WL, 1.0, 0) == pytest.approx(math.asin(s), rel=1e-12)
    assert _beam_angle({"waist": w}, WL, 1.0, 0) == pytest.approx(math.atan(s), rel=1e-12)


def test_a_waist_below_the_diffraction_limit_is_refused_only_with_the_sine_mapping():
    limit = WL / math.pi
    with pytest.raises(SetupError, match="diffraction limit"):
        parse(setup({"kind": "lens", "waist": 0.9 * limit, "mapping": "sine"}))
    parse(setup({"kind": "lens", "waist": 0.9 * limit}))  # OTT's mapping has an angle for any waist
    # the WS2 bottle beam's LG10 beam (waist 0.866 um at 1550 nm) is below that limit for its mode:
    # it stays valid because it keeps OTT's mapping, as the paper did
    from levtrap.special import paraxial_beam_waist
    assert 0.866e-6 < 1.55e-6 * paraxial_beam_waist(2) / math.pi


def test_a_filled_objective_maps_by_the_sine_condition():
    parse(setup({"kind": "lens", "NA": 0.9, "filling": 0.7, "mapping": "sine"}))
    with pytest.raises(SetupError, match="sine condition"):
        parse(setup({"kind": "lens", "NA": 0.9, "filling": 0.7, "mapping": "ott"}))
    with pytest.raises(SetupError, match="mapping"):
        parse(setup({"kind": "lens", "NA": 0.9, "mapping": "cosine"}))


def test_bessel_functions_at_zero_do_not_overflow_at_high_order():
    """j_n(kr) at kr -> 0 is kr^n / (2n+1)!!, which overflowed a float from n ~ 150
    (the sine-mapped beam reaches such orders when translated far)."""
    j = sbesselj(np.array([0, 1, 200, 400]), 0.0)
    np.testing.assert_array_equal(j, [[1.0, 0.0, 0.0, 0.0]])
    assert sbesselj(np.array([3]), 1e-20)[0, 0] == pytest.approx(1e-60 / 105, rel=1e-12)
