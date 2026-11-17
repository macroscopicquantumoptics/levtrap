"""B3: hybrid traps (Paul + optical + gravity in one setup).

References: the pure Paul and pure optical results of the same engine
(stiffnesses of independent forces add), and g / omega^2 for the sag.
"""

import copy
import math

import pytest

from levtrap.derived import sphere_mass
from levtrap.fields.paul import E_CHARGE
from levtrap.solve import solve

RADIUS, DENSITY, CHARGE_E = 100e-9, 2200.0, 100
MASS = sphere_mass(RADIUS, DENSITY)
Q = CHARGE_E * E_CHARGE
R0, F_RF = 1e-3, 1e4
OMEGA = 2 * math.pi * F_RF


def paul(q_r=0.1, **kw):
    """Ring trap (z0 = r0/sqrt(2): curvature 1/r0^2) with radial |q| = q_r."""
    V = q_r * MASS * OMEGA**2 * R0**2 / (2 * Q)
    return dict(kind="paul", geometry="ring", rf_voltage=V, rf_frequency=F_RF, r0=R0, z0=R0 / math.sqrt(2), **kw)


def beam(power=1e-6, **kw):
    return dict(kind="beam", wavelength=1.064e-6, power=power, focus=dict(NA=0.8), polarisation="x", **kw)


def setup(*fields):
    return dict(version=1, particle=dict(radius=RADIUS, material="SiO2", charge=CHARGE_E),
                trap=dict(fields=list(fields)))


def k(r):
    return {m["name"]: m["stiffness"] for m in r["modes"]}


def f(r):
    return {m["name"]: m["frequency"] for m in r["modes"]}


@pytest.fixture(scope="module")
def three():
    return solve(setup(beam())), solve(setup(paul())), solve(setup(beam(), paul()))


def test_stiffnesses_add():
    """A weak optical trap centred in a Paul trap: k_total = k_paul + k_optical
    per axis (1 %).  Two equal incoherent counter-propagating beams cancel the
    scattering force, so both traps share the equilibrium at the origin."""
    counter = [beam(), beam(direction=[0, 0, -1])]
    opt, pl, hyb = solve(setup(*counter)), solve(setup(paul())), solve(setup(*counter, paul()))
    assert hyb["stable"] and opt["stable"]
    assert hyb["equilibrium"] == pytest.approx([0, 0, 0], abs=1e-12)
    ko, kp, kh = k(opt), k(pl), k(hyb)
    assert min(kp.values()) > 0.1 * min(ko.values())  # both fields matter
    for ax in "xyz":
        assert kh[ax] == pytest.approx(ko[ax] + kp[ax], rel=0.01)


def test_scattering_force_is_balanced_by_the_paul_trap(three):
    """One weak beam: its scattering force pushes the particle downstream until
    the Paul trap pushes back; the breakdown shows the balance."""
    opt, _, hyb = three
    assert 0 < hyb["equilibrium"][2] < opt["equilibrium"][2]
    bd = {p["kind"]: p for p in hyb["breakdown"]}
    assert bd["beam"]["force"][2] > 0
    assert bd["paul"]["force"][2] == pytest.approx(-bd["beam"]["force"][2], rel=1e-4)


def test_breakdown_sums_to_the_total(three):
    hyb = three[2]
    parts = hyb["breakdown"]
    assert [p["kind"] for p in parts] == ["beam", "paul"]
    assert parts[0]["fields"] == [0] and parts[1]["fields"] == [1]
    for ax in "xyz":
        assert sum(p["stiffness"][ax] for p in parts) == pytest.approx(k(hyb)[ax], rel=1e-3)
    # forces balance at the equilibrium
    for i in range(3):
        assert abs(sum(p["force"][i] for p in parts)) < 1e-6 * max(abs(p["force"][2]) for p in parts) + 1e-30
    assert hyb["paul"]["q"]["x"] == pytest.approx(0.1, rel=1e-9) or hyb["paul"]["q"]["x"] == pytest.approx(-0.1)
    assert hyb["optical"]["P_sca"] > 0 and hyb["rates"] is not None


def test_zero_optical_power_is_the_pure_paul_trap(three):
    pl = three[1]
    r = solve(setup(beam(power=0.0), paul()))
    assert r["stable"]
    for ax in "xyz":
        assert f(r)[ax] == pytest.approx(f(pl)[ax], rel=1e-6)


def test_zero_rf_is_the_pure_optical_trap(three):
    opt = three[0]
    r = solve(setup(beam(), paul(q_r=0.0)))
    assert r["stable"]
    for ax in "xyz":
        assert f(r)[ax] == pytest.approx(f(opt)[ax], rel=1e-6)
    assert r["equilibrium"][2] == pytest.approx(opt["equilibrium"][2], rel=1e-6)


def test_two_scales_paul_sag_outside_the_optical_region():
    """1 um waist inside r0 = 1 mm, light too weak to hold against gravity: the
    particle sags tens of um, outside the region searched around the focus,
    and the two-scale search finds it at g / omega_y^2."""
    weak = paul(q_r=0.02)
    pure = solve(setup(weak))
    w_y = 2 * math.pi * f(pure)["y"]
    sag = 9.81 / w_y**2
    assert sag > 10e-6  # well outside the +-1.5 um optical scan
    b = dict(beam(power=1e-9), focus=dict(waist=1e-6))
    r = solve(setup(b, weak, dict(kind="gravity")))
    assert r["stable"]
    assert r["equilibrium"][1] == pytest.approx(-sag, rel=0.01)


def test_two_scales_paul_holds_what_a_loose_focus_cannot():
    """A 1 um waist cannot hold the particle along its axis (scattering wins);
    inside r0 = 1 mm the Paul trap supplies the axial confinement while the
    light still sets the radial frequencies."""
    b = dict(beam(power=1e-3), focus=dict(waist=1e-6))
    assert not solve(setup(b, dict(kind="gravity")))["stable"]
    r = solve(setup(b, paul(), dict(kind="gravity")))
    assert r["stable"]
    x, y, z = r["equilibrium"]
    assert abs(x) < 1e-9 and abs(y) < 1e-7  # held radially by the light against gravity
    assert 0 < z < 10e-6  # pushed downstream, caught by the Paul trap
    bd = {p["kind"]: p for p in r["breakdown"]}
    assert bd["beam"]["stiffness"]["x"] > 100 * bd["paul"]["stiffness"]["x"]
    assert bd["paul"]["force"][2] == pytest.approx(-bd["beam"]["force"][2], rel=1e-3)


def test_displaced_focus_warns_of_micromotion():
    b = beam(power=1e-3, position=[20e-6, 0, 0])
    r = solve(setup(b, paul()))
    assert r["stable"]
    assert any("excess micromotion" in w for w in r["warnings"])
    assert r["paul"]["micromotion"][0] == pytest.approx(abs(r["paul"]["q"]["x"]) * r["equilibrium"][0] / 2,
                                                        rel=1e-6)
    centred = solve(setup(beam(power=1e-3), paul()))
    assert not any("micromotion" in w for w in centred["warnings"])


def test_hybrid_needs_a_charge():
    from levtrap.setup import SetupError
    s = setup(beam(), paul())
    s["particle"]["charge"] = 0
    with pytest.raises(SetupError):
        solve(copy.deepcopy(s))
