"""Lens-tilt model: ray trace against the Zemax prescription, geometric
optics checks, and the far-field -> beam-coefficient projection."""

import numpy as np
import pytest

from levtrap import lens as L
from levtrap.bsc import Bsc, BscPmGauss
from levtrap.force import forcetorque
from levtrap.tmatrix import TmatrixMie
from levtrap.traps import axial_equilibrium, equilibrium_3d

LENS = L.THORLABS_354330


def test_index_calibration_reproduces_zemax_back_focus():
    cal = L.calibrate_index(LENS)
    assert cal.index_offset == pytest.approx(LENS.index_offset, abs=1e-7)
    tr = L.trace(LENS, 0.83, 15.0, n_rays=121)  # overfilled: full clear aperture
    P, _, rms = L.best_focus(tr)
    assert P[2] - LENS.thickness == pytest.approx(LENS.design_bfl, abs=1e-6)  # mm (Zemax DISZ)
    # the design is diffraction limited at its design wavelength
    assert rms / 0.83e-3 < 1e-3


def test_untilted_symmetry_and_1550_focal_shift():
    tr = L.trace(LENS, 1.55, 3.0)
    P, _, _ = L.best_focus(tr)
    assert abs(P[0]) < 1e-9 and abs(P[1]) < 1e-9
    # dispersion: n(1550) < n(830) -> longer back focus
    assert P[2] - LENS.thickness > LENS.design_bfl


def test_tilt_nodal_point_rule():
    """A thin beam's focus moves sideways by alpha * (z_N - z_pivot)."""
    shifts = {}
    alpha = np.radians(1.0)
    P0, _, _ = L.best_focus(L.trace(LENS, 1.55, 0.3))
    for piv, zp in (("S1", 0.0), ("S2", LENS.thickness)):
        P, _, _ = L.best_focus(L.trace(LENS, 1.55, 0.3, tilt_y_deg=1.0, pivot=piv))
        shifts[zp] = P[0] - P0[0]
    slope = (shifts[0.0] - shifts[LENS.thickness]) / LENS.thickness
    assert slope == pytest.approx(np.sin(alpha), rel=0.02)
    zN = shifts[0.0] / slope  # rear nodal point lies between the vertices
    assert 0 < zN < LENS.thickness
    # mirror symmetry
    Pm, _, _ = L.best_focus(L.trace(LENS, 1.55, 0.3, tilt_y_deg=-1.0, pivot="S1"))
    assert Pm[0] - P0[0] == pytest.approx(-shifts[0.0], rel=1e-6)


def test_projection_matches_ott_point_matching():
    wl = 1.55e-6
    ang = np.radians(40)
    g = BscPmGauss(angle=ang, polarisation=(1, 0), wavelength0=wl, index_medium=1.0, power=1.0)
    nmax = 25
    xg, wg = np.polynomial.legendre.leggauss(2 * nmax + 4)
    th = np.arccos(xg)
    ph = np.arange(4 * nmax + 4) * 2 * np.pi / (4 * nmax + 4)
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    env = np.where(TH > np.pi / 2, np.exp(-((np.tan(TH) / np.tan(ang)) ** 2)), 0)
    a, b = L.project_farfield(th, ph, -env * np.cos(PH), -env * np.sin(PH), wg, nmax)
    p = Bsc(a, b, k_medium=2 * np.pi / wl).with_power(1)
    T = TmatrixMie(150e-9, index_medium=1, index_particle=1.44, wavelength0=wl)
    pos = np.array([[0, 0, 0], [0.3e-6, 0, 0.2e-6], [0, -0.2e-6, -0.5e-6]]).T
    np.testing.assert_allclose(forcetorque(p, T, position=pos)[0], forcetorque(g, T, position=pos)[0],
                               rtol=1e-4, atol=1e-8)


def test_ray_projection_parseval_and_convergence():
    tr = L.trace(LENS, 0.83, 2.0)
    P, _, _ = L.best_focus(tr)
    a, b = L.project_rays(tr, P, 0.83, (1, 0), 30)
    dx = tr.x[0, 1] - tr.x[0, 0]
    assert np.sum(np.abs(a) ** 2 + np.abs(b) ** 2) == pytest.approx(np.sum(tr.E_in[tr.valid] ** 2) * dx * dx,
                                                                    rel=1e-3)
    T = TmatrixMie(150e-9, index_medium=1, index_particle=1.44, wavelength0=1.55e-6)
    pos = np.array([[0, 0, 0], [0.3e-6, 0, 0.2e-6]]).T
    f = [forcetorque(L.focused_beam(LENS, 1.55, 3.0, tilt_y_deg=1.0, n_rays=n).beam, T, position=pos)[0]
         for n in (81, 161)]
    np.testing.assert_allclose(f[0], f[1], rtol=0.01, atol=1e-3 * np.abs(f[1]).max())


def test_focus_at_reference_point_and_sign():
    """At the design wavelength the beam focuses at P* (intensity peak at 0)
    and pushes a small particle along +z (the beam propagates towards +z)."""
    r = L.focused_beam(LENS, 0.83, 2.5)
    z = np.linspace(-2e-6, 2e-6, 81)
    I = np.sum(np.abs(r.beam.em_field_xyz(np.stack([0 * z, 0 * z, z], 1))) ** 2, 1)
    assert abs(z[np.argmax(I)]) < 0.06e-6
    T = TmatrixMie(50e-9, index_medium=1, index_particle=1.45, wavelength0=0.83e-6)
    assert forcetorque(r.beam, T, position=np.zeros(3))[0][2] > 0


def test_equilibrium_3d_matches_axial_equilibrium():
    wl, n = 1064e-9, 1.34
    b = BscPmGauss(angle_deg=50, polarisation=(1, 0), index_medium=n, wavelength0=wl, power=1.0)
    T = TmatrixMie(1.5 * wl / n, index_medium=n, index_particle=1.59, wavelength0=wl)
    r, K, ok = equilibrium_3d(b, T, [1e-8, -1e-8, 3e-7])
    z, kz = axial_equilibrium(T, b)
    assert ok
    assert r[2] == pytest.approx(z, abs=1e-10)
    assert K[2, 2] == pytest.approx(-kz, rel=1e-3)
    assert K[0, 0] == pytest.approx(2.450214062064871e05, rel=0.01)  # OTT testExamples kx


def test_lens_api_round_trip_and_continuation():
    import json
    from levtrap import api
    req = dict(wavelength=1.55e-6, power=0.5, particle=dict(radius=100e-9, n=1.444, k=0, density=2200),
               lens=dict(diameter_mm=2.5, tilt_y_deg=0.3))
    out = json.loads(api.lens_trap(json.dumps(req)))
    assert out["ok"], out
    r = out["result"]
    assert r["stable"] and len(r["freqs"]) == 3 and r["transmitted"] == pytest.approx(1.0, abs=1e-3)
    # tilt about y moves the focus along x only (mirror symmetry in y)
    assert abs(r["focus_shift_um"][1]) < 1e-6 and r["focus_shift_um"][0] > 0
    assert "maps" in r and "wavefront" in r
    sw = json.loads(api.lens_sweep(json.dumps(req), "tilt_y_deg", json.dumps([0.0, 0.1, 0.2])))
    pts = sw["points"]
    assert all(p["stable"] for p in pts) and not any(p["jumped"] for p in pts)
    assert pts[0]["particle_shift_um"] == pytest.approx([0, 0, 0], abs=1e-6)
    # small tilts move the particle smoothly (continuation follows the same trap)
    assert abs(pts[2]["particle_shift_um"][0]) > abs(pts[1]["particle_shift_um"][0]) > 0


def test_web_3d_view_uses_the_same_prescription():
    """web/lens3d.js traces rays in the browser; its copy of the lens must match."""
    import pathlib
    import re

    js = (pathlib.Path(__file__).parents[1] / "web" / "lens3d.js").read_text()
    block = js[js.index("export const LENS"):js.index("};", js.index("export const LENS"))]
    s1, s2 = block[block.index("s1:"):block.index("s2:")], block[block.index("s2:"):block.index("t:")]
    for surf, src in ((LENS.s1, s1), (LENS.s2, s2)):
        assert float(re.search(r"c: (\S+),", src).group(1)) == surf.curv
        assert float(re.search(r"k: (\S+),", src).group(1)) == surf.conic
        assert float(re.search(r"sd: (\S+),", src).group(1)) == surf.semi_diameter
        assert [float(v) for v in re.search(r"A: \[([^\]]*)\]", src).group(1).split(",")] == list(surf.coeffs)
    assert float(re.search(r"\bt: (\S+),", block).group(1)) == LENS.thickness
    assert float(re.search(r"indexOffset: (\S+),", block).group(1)) == LENS.index_offset
    assert [float(v) for v in re.search(r"sellmeier: \[([^\]]*)\]", block).group(1).split(",")] == list(L._SELLMEIER[LENS.glass])
