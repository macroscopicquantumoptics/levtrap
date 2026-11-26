"""Recoil from the position information: backaction = information (#95).

The recoil heating of a mode along u is Gamma_u = M_uu / (2 m omega Omega_u),
with M_uu = integral |dF/du|^2 dOmega the position information of the
scattered far field F (Tebbenjohanns, Frimmer & Novotny, PRA 100, 043821
(2019)). In the units of the photon picture, A_u = M_uu / (k^2 P_sca).
Reference values are analytic limits:

* plane wave: dF/du = i k (e_in - n)_u F exactly, so the beam photons give
  k^2 P_sca e e^T and the cross term -k^2 P_sca (e <n> + <n> e); a dipole
  gives A = 1/5, 2/5, 7/5 for x polarisation;
* a dipole at a focus: the beam photons give |dE/du|^2 / (k^2 |E|^2) of the
  incident field at the particle, below 1 along the axis (Gouy): along z it
  is <cos theta>^2 over the beam's angular spectrum, so A_z = 2/5 + <cos theta>^2;
* a standing wave of two plane waves: at an antinode the field gradient
  vanishes and only the scattered photons remain (2/5 along the axis); at
  a node nothing is scattered, but the information along the axis is that
  of the antinode field: 5/2 times the antinode's.
"""

import json
import math

import numpy as np
import pytest

from levtrap import rates
from levtrap.api import _single_beam, _tmatrix
from levtrap.bsc import BscPlane
from levtrap.fields import OpticalField
from levtrap.pattern import far_field, recoil_information, sphere_grid
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve
from levtrap.special import ka2nmax
from levtrap.tmatrix import TmatrixMie

WL = 1.064e-6
K = 2 * np.pi / WL


def _A(info, key="information"):
    """The photon-picture tensor A = M / (k^2 P_sca)."""
    return info[key] / (info["k"] ** 2 * info["P_sca"])


def _plane(radius, n=1.45):
    """An x-polarised plane wave along +z (BscPlane(theta=pi), see test_pattern) and a sphere."""
    T = TmatrixMie(radius, index_medium=1.0, index_particle=n, wavelength0=WL)
    pw = BscPlane(np.pi, 0.0, polarisation=(1, 0), Nmax=ka2nmax(K * radius) + 6, k_medium=K)
    return pw, T


@pytest.mark.parametrize("radius", [20e-9, 50e-9])
def test_plane_wave_dipole_gives_one_fifth_two_fifths_seven_fifths(radius):
    """A small silica sphere in a plane wave: A = diag(1/5, 2/5, 7/5 - 2 <n_z>) (the photon picture).
    At 50 nm the electric and magnetic dipoles already interfere: <n_z> = 0.017 lowers A_z by 2.4 %."""
    pw, T = _plane(radius)
    info = recoil_information(pw, T)
    mz = info["mean"][2]
    np.testing.assert_allclose(np.diag(_A(info)), [0.2, 0.4, 1.4 - 2 * mz], atol=2e-4)
    assert mz < (0.005 if radius < 30e-9 else 0.02)
    np.testing.assert_allclose(_A(info, "incident"), np.diag([0, 0, 1.0]), atol=1e-6)
    # the information's diagonal is the pattern block's information_total
    from levtrap.pattern import pattern_block
    pb = pattern_block(pw, T, n_medium=1.0)
    for i, ax in enumerate("xyz"):
        assert info["information"][i, i] == pytest.approx(pb["information_total"][ax], rel=5e-5)


@pytest.mark.parametrize("radius", [50e-9, 300e-9])
def test_plane_wave_split_is_the_photon_picture(radius):
    """In a plane wave G = i k e_in F for any sphere: the beam photons are e e^T and the cross term
    -(e <n> + <n> e), so the information model equals recoil_heating's plane-wave picture."""
    pw, T = _plane(radius)
    info = recoil_information(pw, T)
    e = np.array([0, 0, 1.0])
    np.testing.assert_allclose(_A(info, "scattered"), info["second"], atol=1e-9)
    np.testing.assert_allclose(_A(info, "incident"), np.outer(e, e), atol=1e-5)
    mean = info["mean"]
    np.testing.assert_allclose(_A(info, "cross"), -(np.outer(e, mean) + np.outer(mean, e)), atol=1e-5)
    if radius > 100e-9:
        assert mean[2] > 0.3  # strongly forward: the cross term matters


def _focus(NA=0.8):
    return _single_beam(dict(wavelength=WL, mode=dict(type="lg", indices=[0, 0]),
                             focus=dict(kind="lens", NA=NA), polarisation="x"), 1.0)


def test_dipole_at_a_focus_feels_the_axial_phase_gradient():
    """A 20 nm sphere at the focus of an x-polarised NA 0.8 beam: the beam photons along u give
    |dE/du|^2 / (k^2 |E|^2) of the incident field at the focus, below 1 along z (the Gouy phase
    slows the axial phase): <cos theta>^2 over the beam's angular spectrum. A_z = 2/5 + <cos theta>^2
    (the cross term of a dipole vanishes)."""
    beam = _focus()
    T, _ = _tmatrix(dict(radius=20e-9, n=1.45, k=0.0), WL, 1.0)
    info = recoil_information(beam, T)
    h = WL * 1e-3
    E0 = beam.em_field_xyz(np.zeros((1, 3)))[0]
    A_inc = np.diag(_A(info, "incident"))
    for i in range(3):
        d = np.zeros(3)
        d[i] = h
        dE = (beam.em_field_xyz(d[None])[0] - beam.em_field_xyz(-d[None])[0]) / (2 * h)
        expect = np.sum(np.abs(dE) ** 2) / (K**2 * np.sum(np.abs(E0) ** 2))
        assert A_inc[i] == pytest.approx(expect, rel=2e-3, abs=1e-6)
    assert 0.4 < A_inc[2] < 0.9  # less than a plane wave's 1
    # the same as <cos theta>^2 over the beam's angular spectrum: E(0) = integral A(n) dOmega and
    # dE/dz(0) = i k integral n_z A(n) dOmega, so the axial phase gradient is k <cos theta>, the
    # mean weighted by the plane waves' amplitude A(n) (the beam's far field)
    th, ph, w = sphere_grid(beam.Nmax + 4, 2 * beam.Nmax + 6)
    Ft, Fp = far_field(beam.a[:, 0], beam.b[:, 0], th, ph)
    et = np.stack([np.cos(th) * np.cos(ph), np.cos(th) * np.sin(ph), -np.sin(th)], axis=1)
    ep = np.stack([-np.sin(ph), np.cos(ph), 0 * ph], axis=1)
    amp = Ft[:, None] * et + Fp[:, None] * ep
    E_0 = (w[:, None] * amp).sum(axis=0)
    cos = (w[:, None] * np.cos(th)[:, None] * amp).sum(axis=0)[0] / E_0[0]  # x polarised: E_x
    assert abs(E_0[1]) + abs(E_0[2]) < 1e-9 * abs(E_0[0])
    assert A_inc[2] == pytest.approx(abs(cos) ** 2, rel=1e-4)
    A = np.diag(_A(info))
    assert A[2] == pytest.approx(0.4 + A_inc[2], abs=0.005)
    assert A[1] == pytest.approx(0.4, abs=0.005)


def _standing(radius=20e-9):
    """Two coherent x-polarised plane waves along +z and -z, and a sphere."""
    T = TmatrixMie(radius, index_medium=1.0, index_particle=1.45, wavelength0=WL)
    nmax = ka2nmax(K * (radius + WL)) + 6
    pw = BscPlane([np.pi, 0.0], [0.0, 0.0], polarisation=np.array([[1, 0], [1, 0]]), Nmax=nmax, k_medium=K)
    sw = pw.__class__(pw.a.sum(axis=1, keepdims=True), pw.b.sum(axis=1, keepdims=True),
                      basis=pw.basis, type=pw.type, k_medium=K)
    z = np.linspace(0, WL / 2, 201)
    I = np.sum(np.abs(sw.em_field_xyz(np.stack([0 * z, 0 * z, z], axis=1))) ** 2, axis=1)
    return sw, T, z[np.argmax(I)], z[np.argmin(I)]


def test_standing_wave_node_and_antinode():
    """At an antinode only the scattered photons kick (A_z = 2/5); at a node nothing is scattered
    but the information along z is k^2 P_antinode: 5/2 times the antinode's. Through the field:
    OpticalField.scattering gives the information in its lab frame."""
    sw, T, z_anti, z_node = _standing()
    f = OpticalField(sw, T, 1.0)
    anti = f.scattering(np.array([0, 0, z_anti]))
    node = f.scattering(np.array([0, 0, z_node]))
    assert node["P_sca"] < 1e-3 * anti["P_sca"]
    A_anti = anti["information"] / np.trace(anti["info_scattered"])  # k^2 P_sca of the far field
    np.testing.assert_allclose(np.diag(A_anti), [0.2, 0.4, 0.4], atol=0.005)
    assert anti["info_incident"][2, 2] < 1e-3 * anti["information"][2, 2]
    assert node["information"][2, 2] == pytest.approx(2.5 * anti["information"][2, 2], rel=0.01)
    # all of it from the beam photons, but for the interference with the faint light scattered
    # off the node (its field is not exactly zero at a 20 nm sphere)
    assert node["info_incident"][2, 2] == pytest.approx(node["information"][2, 2], rel=5e-3)
    # across the axis nothing is learned at the node
    assert node["information"][0, 0] < 1e-3 * node["information"][2, 2]


def test_heating_from_information_matches_the_photon_picture_in_a_plane_wave():
    """information_heating with a plane wave's tensors equals recoil_heating with the Mie moments."""
    pw, T = _plane(300e-9)
    sc = OpticalField(pw, T, 1.0).scattering(np.zeros(3))
    mass, Om = 1e-17, 2 * math.pi * 1e5
    tens = rates.information_tensors([sc])
    for u in ((1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 1)):
        new = rates.information_heating(mass, Om, u, tens)
        old = rates.recoil_heating(sc["P_sca"], WL, mass, Om, u, sc["second"], scattered_mean=sc["mean"])
        for key in ("scattered", "incident", "cross", "total"):
            assert new[key] == pytest.approx(old[key], rel=1e-4, abs=1e-6 * old["total"])


def _gamma_from_pattern(result, mode):
    """Gamma_u = information_total[u] / (2 m omega_ref Omega_u), from the pattern block."""
    info = result["pattern"]["information_total"]["xyz"[mode]]
    wl = result["_wl"]
    omega = 2 * math.pi * 2.99792458e8 / wl
    Om = 2 * math.pi * result["modes"][mode]["frequency"]
    return info / (2 * result["particle"]["mass"] * omega * Om)


@pytest.mark.parametrize("second", [None, 1.55e-6])
def test_solve_recoil_is_the_pattern_information(second):
    """A solve's recoil heating is the pattern block's information_total / (2 m omega Omega): one
    beam, and two incoherent beams of different wavelengths, whose information the pattern block
    weights by omega_ref / omega_i (so the sum is still exact)."""
    s = json.loads(json.dumps(DEFAULT_SETUP))
    if second:
        b1 = s["trap"]["fields"][0]
        s["trap"]["fields"].append(dict(b1, id="beam2", wavelength=second, direction=[0, 0, -1], power=0.5 * b1["power"]))
    r = solve(s, want=["pattern"])
    r["_wl"] = s["trap"]["fields"][0]["wavelength"]
    models = {m["quantity"]: m for m in r["models"]}
    assert models["recoil_heating"]["model"] == "information"
    assert models["recoil_heating"]["validity"] == "ok"
    for i, m in enumerate(r["modes"]):
        assert m["axis"] == pytest.approx([1.0 * (j == i) for j in range(3)], abs=1e-6)
        assert r["rates"]["modes"][i]["recoil_heating"] == pytest.approx(_gamma_from_pattern(r, i), rel=1e-4)
