"""Multipole shares of the scattered power (#80).

The Result carries the plane-wave Mie efficiency per multipole
(``optical.Qsca_multipoles``) and the actual beam's scattered power per
multipole at the equilibrium (``optical.P_sca_multipoles``, W). These tests
pin the electric/magnetic labels against Mie theory, check that the split adds
up to P_sca, and compare the WS2 dark trap with the paper example
(examples/paper_2607_09896.py, docs/paper/paper_figures.json).
"""

import copy
import json
import math
from pathlib import Path

import numpy as np
import pytest

from levtrap.bsc import BscPlane
from levtrap.derived import mie_efficiencies, multipole_power, power_balance
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve
from levtrap.tmatrix import TmatrixMie

LABELS = ["ED", "MD", "EQ", "MQ", "EO", "MO", "higher"]
PAPER = json.loads((Path(__file__).parents[1] / "docs" / "paper" / "paper_figures.json").read_text())


@pytest.mark.parametrize("m", [1.5 + 0.02j, 3.79])
def test_plane_wave_split_matches_the_mie_multipoles(m):
    """For a plane wave the beam's split (4 sum |q_nm|^2 on the N waves for
    the electric orders, 4 sum |p_nm|^2 on the M waves for the magnetic ones)
    is Q_sca per multipole times the cross-section, a_n <-> electric and
    b_n <-> magnetic as in Bohren & Huffman. This pins the labels."""
    k = 2 * np.pi
    r = 0.4
    pw = BscPlane(0.0, 0.0, polarisation=(1, 0), Nmax=30, k_medium=k)
    T = TmatrixMie(r, k_medium=k, index_relative=m)
    s, _ = pw.scatter(T)
    split = power_balance(pw, s)["sca_multipoles"]
    I = 4 * k**2 * np.sum(np.abs(pw.em_field_xyz(np.zeros((1, 3)))) ** 2)  # per unit OTT power
    q = mie_efficiencies(r, 1.0, m)["Qsca_multipoles"]
    sigma = np.pi * r**2
    assert list(split) == LABELS
    for key in LABELS:
        np.testing.assert_allclose(split[key] * pw.power / I, q[key] * sigma, rtol=1e-8, atol=1e-14, err_msg=key)


def test_beam_split_adds_up_to_the_scattered_power():
    """The VSWFs are orthogonal at infinity: the shares add up to P_sca with no cross terms."""
    r = solve(DEFAULT_SETUP)
    o = r["optical"]
    assert list(o["P_sca_multipoles"]) == LABELS
    assert sum(o["P_sca_multipoles"].values()) == pytest.approx(o["P_sca"], rel=1e-10)
    assert all(v >= 0 for v in o["P_sca_multipoles"].values())
    assert list(o["Qsca_multipoles"]) == LABELS
    assert sum(o["Qsca_multipoles"].values()) == pytest.approx(o["Qsca"], rel=1e-10)
    json.dumps(r)


def test_a_small_sphere_is_electric_dipole_dominated():
    """A 50 nm silica sphere at 1064 nm (x = 0.3): the electric dipole carries
    over 99 % of the scattered power, in the plane wave and in the focus."""
    s = copy.deepcopy(DEFAULT_SETUP)
    s["particle"]["radius"] = 50e-9
    o = solve(s)["optical"]
    assert o["Qsca_multipoles"]["ED"] / o["Qsca"] > 0.99
    assert o["P_sca_multipoles"]["ED"] / o["P_sca"] > 0.99
    assert max(o["P_sca_multipoles"], key=o["P_sca_multipoles"].get) == "ED"


def test_multipole_power_on_a_bare_scattered_beam():
    """multipole_power works on the scattered beam alone, in its units (here of OTT power)."""
    k = 2 * np.pi
    pw = BscPlane(0.0, 0.0, polarisation=(1, 0), Nmax=20, k_medium=k)
    s, _ = pw.scatter(TmatrixMie(0.3, k_medium=k, index_relative=1.45))
    split = multipole_power(s)
    assert sum(split.values()) == pytest.approx(4 * np.sum(np.abs(s.a) ** 2 + np.abs(s.b) ** 2), rel=1e-12)


def _ws2_dark_trap():
    """The paper's bottle beam on a 300 nm WS2 sphere at 1550 nm, with the dark
    split of the paper example (examples/paper_2607_09896.py: setup, _beams)."""
    split = PAPER["split"]
    common = dict(kind="beam", wavelength=1550e-9, polarisation="circular+", direction=[0, 0, 1], position=[0, 0, 0])
    beams = [dict(common, id="b1", power=0.8 * split[0], focus=dict(kind="lens", waist=1.59e-6),
                  mode=dict(type="lg", indices=[0, 0]), phase=0.0),
             dict(common, id="b2", coherent_with="b1", power=0.8 * split[1], focus=dict(kind="lens", waist=0.866e-6),
                  mode=dict(type="lg", indices=[1, 0]), phase=math.pi)]
    particle = dict(material="WS2", radius=300e-9, n=3.79, k=2.83e-10, density=7500.0)
    return dict(version=1, particle=particle, environment=dict(medium_index=1.0, temperature=300.0),
                trap=dict(fields=beams))


def test_ws2_dark_trap_is_magnetic_quadrupole_dominated_as_in_the_paper_example():
    """WS2, R = 300 nm, 1550 nm (arXiv:2607.09896): the magnetic quadrupole
    dominates the scattered power at the equilibrium, and each share is the
    paper example's (Fig. 1b at 1550 nm, docs/paper/paper_figures.json, in
    units of the beam power)."""
    r = solve(_ws2_dark_trap())
    assert r["stable"]
    o = r["optical"]
    P = o["P_sca_multipoles"]
    assert max(P, key=P.get) == "MQ"
    assert P["MQ"] / o["P_sca"] > 0.5
    ref = next(row["multipoles"] for row in PAPER["ws2_radius_sweep"] if abs(row["radius"] - 300e-9) < 1e-12)
    for key in LABELS:
        assert P[key] / o["power"] == pytest.approx(ref[key], rel=1e-3, abs=1e-12), key
    # the plane wave is not the beam: a plane wave on the same sphere scatters
    # mostly into the magnetic dipole (MD 53 %, MQ 33 %); the dark focus, with
    # little field and a strong field gradient at the particle, lifts the MQ
    # share to about 62 % (#80)
    q = o["Qsca_multipoles"]
    assert max(q, key=q.get) == "MD"
    assert P["MQ"] / o["P_sca"] > q["MQ"] / o["Qsca"] + 0.2
