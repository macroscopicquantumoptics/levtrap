"""#61: an objective's back aperture filled by the beam (``focus.filling``).

Without ``filling`` the lens focus is OTT's paraxial far-field mapping, a
Gaussian of 1/e^2 half-angle asin(NA / n) and no aperture: unchanged. With
it, the objective is aplanatic (sine condition, sqrt(cos) apodisation) with
its aperture at asin(NA / n), and the beam's 1/e^2 radius is ``filling``
times the aperture's; the power is what passes the aperture.
"""

import copy

import pytest

from levtrap.setup import DEFAULT_SETUP, SetupError, parse
from levtrap.solve import solve


def tweezer(focus):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["radius"] = 50e-9
    s["trap"]["fields"][0]["focus"] = focus
    return s


def freqs(r):
    return {m["name"]: m["frequency"] for m in r["modes"]}


def test_without_filling_nothing_changes():
    a = solve(tweezer({"kind": "lens", "NA": 0.9}))
    b = solve(DEFAULT_SETUP | {"trap": tweezer({"kind": "lens", "NA": 0.9})["trap"],
                               "particle": tweezer({"kind": "lens", "NA": 0.9})["particle"]})
    assert freqs(a) == freqs(b)
    assert "filling" not in parse(tweezer({"kind": "lens", "NA": 0.9}))["trap"]["fields"][0]["focus"]


def test_filling_needs_the_aperture():
    with pytest.raises(SetupError, match="needs the objective's NA"):
        parse(tweezer({"kind": "lens", "waist": 1e-6, "filling": 1.0}))
    with pytest.raises(SetupError, match="filling"):
        parse(tweezer({"kind": "lens", "NA": 0.9, "filling": 0}))
    assert parse(tweezer({"kind": "lens", "NA": 0.9, "filling": 0.7}))["trap"]["fields"][0]["focus"]["filling"] == 0.7


@pytest.fixture(scope="module")
def scan():
    return {f: freqs(solve(tweezer({"kind": "lens", "NA": 0.9, "filling": f}))) for f in (0.5, 1.0, 3.0, 10.0)}


def test_a_fuller_aperture_traps_more_stiffly_and_then_saturates(scan):
    for axis in "xyz":
        assert scan[0.5][axis] < scan[1.0][axis] < scan[3.0][axis]
        # overfilled, the aperture is lit almost evenly: little left to gain
        assert scan[10.0][axis] == pytest.approx(scan[3.0][axis], rel=0.03)
    # an aperture always passes less of the tight focus than the unapertured Gaussian of the same NA
    bare = freqs(solve(tweezer({"kind": "lens", "NA": 0.9})))
    assert all(scan[10.0][a] < bare[a] for a in "xyz")


def test_an_underfilled_objective_focuses_the_paraxial_gaussian():
    """Filled to 0.3 of NA 0.9 the beam never reaches the aperture: its focus
    is the Gaussian whose far field reaches 1/e^2 at sin(theta) = 0.27, waist
    w0 = lambda / (pi 0.27) (the angular spectrum is exp(-(k sin(theta) w0 / 2)^2)).
    The default lens mapping (OTT's tan(theta)) is wider than this paraxial
    focus by about 10 %; the filled objective's sine mapping is within a few."""
    import math

    import numpy as np

    from levtrap.api import _single_beam
    s = parse(tweezer({"kind": "lens", "NA": 0.9, "filling": 0.3}))
    beam = _single_beam(s["trap"]["fields"][0], 1.0)
    wl = s["trap"]["fields"][0]["wavelength"]
    w0 = wl / (math.pi * 0.27)
    y = np.linspace(0, 3 * w0, 601)
    intensity = np.sum(np.abs(beam.em_field_xyz(np.stack([0 * y, y, 0 * y], 1))) ** 2, 1)
    radius = y[np.argmax(intensity < intensity[0] * math.exp(-2))]
    assert radius == pytest.approx(w0, rel=0.04)
