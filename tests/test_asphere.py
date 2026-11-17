"""E1 (issue #23): a beam focused by a real lens, ``focus.kind = "asphere"``.

The reference is the lens-tilt page's own API (:func:`levtrap.api.lens_trap`,
tests/test_lens.py): the same inputs must give the same trap.
"""

import copy
import json

import numpy as np
import pytest

from levtrap import api
from levtrap.setup import DEFAULT_SETUP, SetupError, parse
from levtrap.solve import UnsupportedSetup, solve

PARTICLE = dict(radius=100e-9, n=1.444, k=0, density=2200)


def asphere_setup(tilt=(0.0, 0.0), decentre=(0.0, 0.0), diameter=2.5e-3, **beam):
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"] = dict(PARTICLE)
    s["trap"]["fields"][0].update(wavelength=1.55e-6, power=0.5,
                                  focus=dict(kind="asphere", beam_diameter=diameter, tilt_deg=list(tilt),
                                             decentre=list(decentre)), **beam)
    return s


def lens_trap(tilt=(0.0, 0.0), decentre=(0.0, 0.0), diameter=2.5e-3):
    req = dict(wavelength=1.55e-6, power=0.5, particle=PARTICLE,
               lens=dict(diameter_mm=diameter * 1e3, tilt_x_deg=tilt[0], tilt_y_deg=tilt[1],
                         decenter_x_mm=decentre[0] * 1e3, decenter_y_mm=decentre[1] * 1e3))
    out = json.loads(api.lens_trap(json.dumps(req)))
    assert out["ok"], out
    return out["result"]


def test_the_setup_takes_an_asphere():
    s = parse(asphere_setup(tilt=(0.1, -0.2)))
    focus = s["trap"]["fields"][0]["focus"]
    assert focus == dict(kind="asphere", lens="354330-C", beam_diameter=2.5e-3, tilt_deg=[0.1, -0.2], decentre=[0.0, 0.0])
    assert parse(s) == s
    # tilt and decentre default to the aligned lens
    bare = asphere_setup()
    del bare["trap"]["fields"][0]["focus"]["tilt_deg"], bare["trap"]["fields"][0]["focus"]["decentre"]
    assert parse(bare)["trap"]["fields"][0]["focus"]["tilt_deg"] == [0.0, 0.0]
    for change, path in [(dict(NA=0.5), "focus.NA"), (dict(beam_diameter=-1), "focus.beam_diameter"),
                         (dict(lens="AC254"), "focus.lens"), (dict(tilt_deg=[0, 30]), "focus.tilt_deg[1]"),
                         (dict(decentre=[0.01, 0]), "focus.decentre[0]")]:
        bad = asphere_setup()
        bad["trap"]["fields"][0]["focus"].update(change)
        with pytest.raises(SetupError) as e:
            parse(bad)
        assert e.value.path == f"trap.fields[0].{path}"


@pytest.mark.parametrize("tilt,decentre", [((0.0, 0.3), (0.0, 0.0)), ((0.5, 0.0), (0.0, 0.0)), ((0.0, 0.0), (0.2e-3, 0.0))])
def test_the_same_trap_as_the_lens_tilt_page(tilt, decentre):
    r = solve(asphere_setup(tilt, decentre))
    ref = lens_trap(tilt, decentre)
    assert r["stable"] and ref["stable"]
    # positions: the page's are relative to the aligned lens's best focus, which is the beam's position here
    np.testing.assert_allclose(np.asarray(r["equilibrium"]) * 1e6, ref["eq_um"], atol=1e-6)
    assert sorted(m["frequency"] for m in r["modes"]) == pytest.approx(sorted(ref["freqs"]), rel=1e-6)
    lens = r["lenses"][0]
    np.testing.assert_allclose(np.asarray(lens["focus_shift"]) * 1e6, ref["focus_shift_um"], atol=1e-9)
    assert lens["transmitted"] == pytest.approx(ref["transmitted"], rel=1e-12)
    assert lens["clipping_loss"] == pytest.approx(1 - ref["transmitted"], abs=1e-12)
    assert lens["trap_axis_tilt_mrad"] == pytest.approx(ref["axial_angle_mrad"], rel=1e-6, abs=1e-6)
    assert lens["rms_waves"] == pytest.approx(ref["rms_waves"], rel=1e-12)


def test_an_aligned_lens_focuses_at_the_beams_position():
    r = solve(asphere_setup())
    lens = r["lenses"][0]
    assert lens["focus_shift"] == pytest.approx([0, 0, 0], abs=1e-15)
    assert lens["trap_axis_tilt_mrad"] == pytest.approx(0, abs=1e-3)
    # an overfilled lens clips: the loss shows
    assert solve(asphere_setup(diameter=8e-3))["lenses"][0]["clipping_loss"] > 0.1


def test_a_lens_turned_with_its_beam_turns_the_trap():
    """The lens is placed by the beam's direction and position like any focus:
    the trap of a beam along +x focused at p is the +z trap turned and moved."""
    p = np.array([2e-6, -1e-6, 0.5e-6])
    along_z = solve(asphere_setup(tilt=(0.0, 0.3)))
    along_x = solve(asphere_setup(tilt=(0.0, 0.3), direction=[1, 0, 0], position=p.tolist()))
    # beam_rotation takes z to x by turning about y: (x, y, z) -> (z, y, -x)
    R = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])
    np.testing.assert_allclose(np.asarray(along_x["equilibrium"]), p + R @ np.asarray(along_z["equilibrium"]), atol=2e-11)
    np.testing.assert_allclose(along_x["lenses"][0]["focus_shift"], R @ np.asarray(along_z["lenses"][0]["focus_shift"]), atol=1e-15)
    assert sorted(m["frequency"] for m in along_x["modes"]) == pytest.approx(sorted(m["frequency"] for m in along_z["modes"]), rel=1e-6)


def test_what_the_asphere_is_not_computed_for():
    water = asphere_setup()
    water["environment"] = dict(medium_index=1.33)
    with pytest.raises(UnsupportedSetup, match="medium index 1"):
        solve(water)
    donut = asphere_setup(mode=dict(type="lg", indices=[0, 1]))
    with pytest.raises(UnsupportedSetup, match="Gaussian"):
        solve(donut)
    with pytest.raises(UnsupportedSetup, match="radiation pattern"):
        solve(asphere_setup(), want=["pattern"])
