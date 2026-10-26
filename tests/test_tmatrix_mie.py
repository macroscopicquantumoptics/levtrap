"""M2: ported tests/testTmatrixMie.m, tests/testTmatrix.m, plus Mie
efficiencies against an independent Bohren & Huffman implementation."""

import numpy as np
import pytest

from levtrap.bsc import BscPmGauss
from levtrap.derived import mie_efficiencies
from levtrap.tmatrix import TmatrixMie


def test_fields_noncontrasting_internal():
    T = TmatrixMie(0.5, index_relative=1.0, internal=True)
    beam = BscPmGauss(power=1.0)
    sbeam, _ = beam.scatter(T)
    xyz = np.array([[0.2, 0.0, 0.0]])
    np.testing.assert_allclose(sbeam.em_field_xyz(xyz), beam.em_field_xyz(xyz), atol=1e-6)


def test_fields_noncontrasting_external():
    T = TmatrixMie(0.5, index_relative=1.0, internal=False)
    beam = BscPmGauss(power=1.0)
    sbeam, _ = beam.scatter(T)
    xyz = np.array([[0.7, 0.0, 0.0]])
    E1 = beam.em_field_xyz(xyz)
    E2 = E1 + 2 * sbeam.em_field_xyz(xyz)
    np.testing.assert_allclose(E2, E1, atol=1e-6)


def test_boundary_conditions():
    R, nrel = 0.5, 1.2
    Te = TmatrixMie(R, index_relative=nrel, internal=False)
    Ti = TmatrixMie(R, index_relative=nrel, internal=True)
    beam = BscPmGauss(power=1.0)
    sbeam, _ = beam.scatter(Te)
    ibeam, _ = beam.scatter(Ti)
    rng = np.random.default_rng(0)
    xyz = rng.random((10, 3))
    xyz /= np.linalg.norm(xyz, axis=1, keepdims=True)
    Einc = beam.em_field_xyz(R * xyz)
    Eint = ibeam.em_field_xyz(R * xyz)
    Esca = sbeam.em_field_xyz(R * xyz)
    # OTT's test writes Esca + Einc, which contradicts OTT's own convention
    # (total = incident + 2 * scattered, Bsc.totalField) and fails at
    # nrel = 1.2; the factor 2 is used here.
    Eext = 2 * Esca + Einc
    np.testing.assert_allclose(np.sum(xyz * (Eext - Eint * nrel**2), axis=1), 0, atol=1e-6)
    np.testing.assert_allclose(np.linalg.norm(np.cross(xyz, Eext - Eint), axis=1), 0, atol=1e-6)


# --- ported tests/testTmatrix.m (power conservation, resizing) ----------

def test_tmatrix_power_and_resize():
    T = TmatrixMie(1.0, wavelength0=1.0, index_medium=1.0, index_particle=1.2)
    tol = 1e-6
    tot = T.to_type("total")
    assert np.all(np.abs(1 - np.asarray(abs(tot.data).power(2).sum(axis=1)).ravel()) < tol)
    big = tot.set_Nmax(T.Nmax[0] + 5)
    assert np.all(np.abs(1 - np.asarray(abs(big.data).power(2).sum(axis=1)).ravel()) < tol)
    sc = T.set_Nmax(T.Nmax[0] + 5).to_type("total")
    assert np.all(np.abs(1 - np.asarray(abs(sc.data).power(2).sum(axis=1)).ravel()) < tol)
    assert T.set_Nmax(T.Nmax[0] + 5).Nmax == (T.Nmax[0] + 5, T.Nmax[1] + 5)
    assert T.set_Nmax(T.Nmax[0] + 5).set_Nmax(T.Nmax[0]).data.shape == T.data.shape
    T2 = T.set_Nmax([T.Nmax[0] + 5, T.Nmax[1]])
    assert T2.data.shape[0] > T.data.shape[0] and T2.data.shape[1] == T.data.shape[1]
    assert T.to_type("total").to_type("scattered").type == "scattered"


# --- independent Bohren & Huffman BHMIE (Appendix A), not using tmatrix.py --

def bhmie(x, m, nstop=None):
    """Bohren & Huffman BHMIE: returns (Qext, Qsca, Qback, a_n, b_n)."""
    xstop = x + 4 * x ** (1 / 3) + 2
    nstop = int(xstop) if nstop is None else nstop
    y = m * x
    nmx = int(max(xstop, abs(y))) + 15
    d = np.zeros(nmx + 1, dtype=complex)
    for n in range(nmx, 0, -1):
        d[n - 1] = n / y - 1 / (d[n] + n / y)
    psi0, psi1 = np.cos(x), np.sin(x)
    chi0, chi1 = -np.sin(x), np.cos(x)
    xi1 = psi1 - 1j * chi1
    an, bn = [], []
    for n in range(1, nstop + 1):
        psi = (2 * n - 1) * psi1 / x - psi0
        chi = (2 * n - 1) * chi1 / x - chi0
        xi = psi - 1j * chi
        a = ((d[n] / m + n / x) * psi - psi1) / ((d[n] / m + n / x) * xi - xi1)
        b = ((m * d[n] + n / x) * psi - psi1) / ((m * d[n] + n / x) * xi - xi1)
        an.append(a)
        bn.append(b)
        psi0, psi1 = psi1, psi
        chi0, chi1 = chi1, chi
        xi1 = psi1 - 1j * chi1
    an, bn = np.array(an), np.array(bn)
    n = np.arange(1, nstop + 1)
    qsca = 2 / x**2 * np.sum((2 * n + 1) * (np.abs(an) ** 2 + np.abs(bn) ** 2))
    qext = 2 / x**2 * np.sum((2 * n + 1) * np.real(an + bn))
    return qext, qsca, an, bn


# NB: BHMIE uses exp(-iwt) with m = n + ik (k > 0 absorbing), the same
# sign convention as OTT/levtrap for complex index.
CASES = [(0.1, 1.45), (1.0, 1.5), (5.0, 1.33), (12.0, 1.59), (3.0, 3.79 + 0.01j),
         (2.0, 1.5 + 0.1j), (8.0, 2.0 + 1.0j), (0.5, 3.48)]


@pytest.mark.parametrize("x,m", CASES)
def test_mie_efficiencies_vs_bohren_huffman(x, m):
    qext_ref, qsca_ref, an_ref, bn_ref = bhmie(x, m)
    wl = 1.0
    k = 2 * np.pi / wl
    r = x / k
    eff = mie_efficiencies(r, wl, m, n_medium=1.0)
    np.testing.assert_allclose(eff["Qext"], qext_ref, rtol=1e-6)
    np.testing.assert_allclose(eff["Qsca"], qsca_ref, rtol=1e-6)
    nn = min(len(an_ref), len(eff["a_n"]))
    np.testing.assert_allclose(eff["a_n"][:nn], an_ref[:nn], atol=1e-8)
    np.testing.assert_allclose(eff["b_n"][:nn], bn_ref[:nn], atol=1e-8)


def absorption_volume_integral(x, m, nq=36):
    """Q_abs = k Im(m^2) int |E_int/E0|^2 dV / (pi r^2), from the internal
    field of an x-polarised plane wave (uses the internal T-matrix and the
    VSWF field code, not the Mie scattering coefficients)."""
    from levtrap.bsc import BscPlane
    from levtrap.special import ka2nmax
    k = 2 * np.pi
    r = x / k
    pw = BscPlane(0.0, 0.0, polarisation=(1, 0), Nmax=ka2nmax(x) + 4, k_medium=k)
    E0 = np.sum(np.abs(pw.em_field_xyz(np.zeros((1, 3)))) ** 2)
    Ti = TmatrixMie(r, k_medium=k, index_relative=m, internal=True, Nmax=pw.Nmax)
    ib, _ = pw.scatter(Ti)
    gr, wr = np.polynomial.legendre.leggauss(nq)
    rr = (gr + 1) / 2 * r
    wr = wr * r / 2
    gc, wc = np.polynomial.legendre.leggauss(nq)
    ph = np.arange(2 * nq) * np.pi / nq
    R, CT, PH = np.meshgrid(rr, gc, ph, indexing="ij")
    W = (wr[:, None, None] * wc[None, :, None] * (np.pi / nq)) * R**2
    ST = np.sqrt(1 - CT**2)
    xyz = np.stack([R * ST * np.cos(PH), R * ST * np.sin(PH), R * CT], axis=-1).reshape(-1, 3)
    E = ib.em_field_xyz(xyz)
    integral = np.sum(W.ravel() * np.sum(np.abs(E) ** 2, axis=1)) / E0
    return k * np.imag(m**2) * integral / (np.pi * r**2)


@pytest.mark.parametrize("x,m", CASES)
def test_energy_conservation(x, m):
    eff = mie_efficiencies(x / (2 * np.pi), 1.0, m, n_medium=1.0)
    np.testing.assert_allclose(eff["Qext"], eff["Qsca"] + eff["Qabs"], rtol=1e-10)
    if np.imag(m) == 0:
        assert abs(eff["Qabs"]) < 1e-10
    else:
        np.testing.assert_allclose(absorption_volume_integral(x, m), eff["Qabs"], rtol=2e-3)


def test_multipole_mask():
    T = TmatrixMie(0.3, index_relative=1.5, multipoles=lambda n, kind: n == 1 and kind == "E")
    d = T.data.diagonal()
    half = d.size // 2
    assert np.all(d[:half] == 0)  # magnetic (M-waves) removed
    assert np.all(d[half + 3:] == 0)  # only n=1 electric kept
    assert np.all(d[half:half + 3] != 0)
