"""E3 (issue #25): a beam focused by a parabolic mirror, ``focus.kind =
"parabolic_mirror"`` (:mod:`levtrap.mirror`).

There is no published trap to compare with yet (C3's parabolic-mirror entry,
Vovrosh et al. 2017, is still "wanted"), so the checks are physical limits:
energy is conserved, a shallow mirror makes the beam of a lens of the same
cone, a deep mirror focuses from beyond 90 degrees and turns with its beam.
"""

import copy
import math

import numpy as np
import pytest

from levtrap import api
from levtrap.bsc import BscPmGauss
from levtrap.force import forcetorque
from levtrap.mirror import default_nmax, focused_beam, mirror_angles, mirror_farfield
from levtrap.setup import DEFAULT_SETUP, SetupError, parse
from levtrap.solve import UnsupportedSetup, solve
from levtrap.tmatrix import TmatrixMie

WL = 1.064e-6


def mirror_setup(**focus):
    s = copy.deepcopy(DEFAULT_SETUP)
    f = dict(kind="parabolic_mirror", focal_length=3e-3, rim_radius=9e-3, hole_radius=0.5e-3, beam_diameter=10e-3)
    f.update(focus)
    s["trap"]["fields"][0]["focus"] = f
    return s


def test_the_geometry():
    # the rim at 2 f is level with the focus; beyond it the mirror is deep
    assert mirror_angles(1.0, 2.0)[1] == pytest.approx(math.pi / 2)
    a_h, a_r = mirror_angles(3e-3, 9e-3, 0.5e-3)
    assert math.degrees(a_r) == pytest.approx(112.62, abs=0.01) and a_h < 0.2
    # an x-polarised beam reflected near the axis stays x-polarised, converging from -z
    Et, Ep = mirror_farfield(np.array([math.pi - 1e-6, math.pi - 1e-6]), np.array([0.0, math.pi / 2]), 1.0, 10.0)
    assert Et[0] == pytest.approx(-1, abs=1e-5) and abs(Ep[0]) < 1e-5  # x on theta-hat at phi = 0 (theta near pi)
    assert abs(Et[1]) < 1e-5 and Ep[1] == pytest.approx(-1, abs=1e-5)


@pytest.mark.parametrize("hole,rim", [(0.0, 15e-3), (1e-3, 15e-3), (0.5e-3, 9e-3)])
def test_energy_is_conserved(hole, rim):
    f = 10e-3 if rim == 15e-3 else 3e-3
    r = focused_beam(f, rim, 4e-3, WL, hole_radius=hole)
    # the far field carries the reflected part of the input beam, exactly
    assert r.far_field_power == pytest.approx(r.reflected, rel=1e-6)
    # the beam on its multipoles all but that: truncation loses the high orders,
    # most at a hole's hard edge near the axis (geometric optics' sharp shadow)
    assert 0.96 * r.reflected < r.beam.power <= r.reflected * (1 + 1e-9)


def test_a_shallow_mirror_makes_a_lens_beam():
    """For a beam much narrower than the focal length the mirror's cone is
    small and its beam tends to a lens's Gaussian of the same angle: the force
    on a small sphere off the focus agrees to about theta0^2."""
    T = TmatrixMie(100e-9, index_medium=1, index_particle=1.45, wavelength0=WL)
    gaps = []
    for w in (1.5e-3, 0.8e-3):
        f = 10e-3
        theta0 = math.atan(w / f)
        n = default_nmax(f, 30e-3, w, WL)
        mirror = focused_beam(f, 30e-3, w, WL, nmax=n).beam
        lens = BscPmGauss(angle=theta0, polarisation=[1, 0], index_medium=1.0, wavelength0=WL, Nmax=n)
        lens, mirror = lens.with_power(1), mirror.with_power(1)
        pos = np.array([[0.3e-6, 0, 0], [0, 0.3e-6, 0], [0, 0, 1e-6]]).T
        fm, fl = forcetorque(mirror, T, position=pos)[0], forcetorque(lens, T, position=pos)[0]
        ratios = [fm[i, i] / fl[i, i] for i in range(3)]
        gaps.append(max(abs(r - 1) for r in ratios) / theta0**2)
    assert all(g < 6 for g in gaps)


def test_the_setup_takes_a_mirror():
    s = parse(mirror_setup())
    focus = s["trap"]["fields"][0]["focus"]
    assert focus == dict(kind="parabolic_mirror", focal_length=3e-3, rim_radius=9e-3, hole_radius=0.5e-3, beam_diameter=10e-3)
    assert parse(s) == s
    bare = mirror_setup()
    del bare["trap"]["fields"][0]["focus"]["hole_radius"]
    assert parse(bare)["trap"]["fields"][0]["focus"]["hole_radius"] == 0.0
    for change, path in [(dict(NA=0.5), "focus.NA"), (dict(focal_length=0), "focus.focal_length"),
                         (dict(hole_radius=9e-3), "focus.hole_radius"), (dict(beam_diameter=-1), "focus.beam_diameter"),
                         (dict(rim_radius=None), "focus.rim_radius")]:
        bad = mirror_setup(**change)
        if change.get("rim_radius", 1) is None:
            del bad["trap"]["fields"][0]["focus"]["rim_radius"]
        with pytest.raises(SetupError) as e:
            parse(bad)
        assert e.value.path == f"trap.fields[0].{path}"


def test_a_deep_mirror_traps():
    r = solve(mirror_setup())
    assert r["stable"]
    m = r["mirrors"][0]
    assert m["deep"] and m["rim_angle_deg"] == pytest.approx(112.62, abs=0.01)
    assert m["reflected"] + m["clipping_loss"] == pytest.approx(1)
    assert m["reflected"] == pytest.approx(math.exp(-2 * 0.5**2 / 25) - math.exp(-2 * 81 / 25))
    # tight: the transverse frequencies are well above a 0.8 NA lens's
    lens = solve(DEFAULT_SETUP)
    assert max(x["frequency"] for x in r["modes"]) > max(x["frequency"] for x in lens["modes"])


def test_a_mirror_turned_with_its_beam_turns_the_trap():
    p = np.array([2e-6, -1e-6, 0.5e-6])
    along_z = solve(mirror_setup())
    s = mirror_setup()
    s["trap"]["fields"][0].update(direction=[1, 0, 0], position=p.tolist())
    along_x = solve(s)
    R = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])
    np.testing.assert_allclose(np.asarray(along_x["equilibrium"]), p + R @ np.asarray(along_z["equilibrium"]), atol=2e-11)
    assert sorted(m["frequency"] for m in along_x["modes"]) == pytest.approx(sorted(m["frequency"] for m in along_z["modes"]), rel=1e-6)


def test_what_the_mirror_is_not_computed_for():
    water = mirror_setup()
    water["environment"] = dict(medium_index=1.33)
    with pytest.raises(UnsupportedSetup, match="medium index 1"):
        solve(water)
    donut = mirror_setup()
    donut["trap"]["fields"][0]["mode"] = dict(type="lg", indices=[0, 1])
    with pytest.raises(UnsupportedSetup, match="Gaussian"):
        solve(donut)
    with pytest.raises(UnsupportedSetup, match="radiation pattern"):
        solve(mirror_setup(), want=["pattern"])
    assert api.mirror_focus  # the app's engine runs it
