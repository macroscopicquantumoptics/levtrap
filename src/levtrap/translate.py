"""Translation along z (addition theorem) and Wigner rotation matrices.

Ports of OTT v1 ``ott.utils.translate_z`` (Gumerov & Duraiswami
recursion, the OTT default) and ``ott.utils.wigner_rotation_matrix``.

Index bookkeeping in the recursions is kept 1-based (arrays carry an
unused row/column 0) so the code can be checked line by line against
the MATLAB source.
"""

from __future__ import annotations

import numpy as np
from scipy import sparse

from .special import combined_index, sbesselh1, sbesselh2, sbesselj

__all__ = ["translate_z", "wigner_rotation_matrix"]


def _anm_l(n, m):
    n = np.asarray(n, dtype=float)
    m = np.asarray(m, dtype=float)
    with np.errstate(all="ignore"):
        fn = 1.0 / (2 * n + 1) / (2 * n + 3)
        a = np.sqrt(np.maximum((n + np.abs(m) + 1) * (n - np.abs(m) + 1) * fn, 0))
    a = np.where(n < 0, 0.0, a)
    a = np.where(np.abs(m) > n, 0.0, a)
    return a


def _bnm_l(n, m):
    n = np.asarray(n, dtype=float)
    m = np.asarray(m, dtype=float)
    with np.errstate(all="ignore"):
        b = (2 * (m < 0) - 1) * np.sqrt((n - m - 1) * (n - m) / (2 * n - 1) / (2 * n + 1))
    return np.where(np.abs(m) > n, 0.0, b)


def _translate_z_gumerov(nmax1: int, nmax2: int, nmax: int, r: float, ttype: str):
    """Port of ``translate_z_gumerov`` (translate_z.m).  1-based arrays."""
    mmax = min(nmax1, nmax2)
    fval = 2 * nmax + 1
    nd = np.arange(0, fval + 1)
    kr = 2 * np.pi * r
    if ttype == "sbesselj":
        C_nd00 = np.sqrt(2 * nd + 1) * sbesselj(nd, kr)[0]
    elif ttype == "sbesselh1":
        C_nd00 = np.sqrt(2 * nd + 1) * sbesselh1(nd, kr)[0] / 2
    elif ttype == "sbesselh2":
        C_nd00 = np.sqrt(2 * nd + 1) * sbesselh2(nd, kr)[0] / 2
    else:
        raise ValueError("Unknown translation type")
    L = nd.size
    # MATLAB size (L+1)x(L+1); add one for 1-based indexing
    C_ndn0 = np.zeros((L + 2, L + 2), dtype=complex)
    C_ndn0[1 + np.arange(1, L + 1), 2] = C_nd00
    C_ndn0[2, 1 + np.arange(1, L + 1)] = (-1.0) ** nd * C_nd00
    for jj in range(1, nmax + 1):
        ii = np.arange(jj, fval - jj + 1)
        C_ndn0[ii + 2, jj + 2] = (
            _anm_l(jj - 2, 0) * C_ndn0[ii + 2, jj]
            - _anm_l(ii, 0) * C_ndn0[ii + 3, jj + 1]
            + _anm_l(ii - 1, 0) * C_ndn0[ii + 1, jj + 1]
        ) / _anm_l(jj - 1, 0)
        C_ndn0[jj + 2, ii + 2] = (-1.0) ** (jj + ii) * C_ndn0[ii + 2, jj + 2]

    # C is MATLAB (nmax2+2, nmax1+1, mmax+1); stored 1-based in first 2 dims
    C = np.zeros((nmax2 + 3, nmax1 + 2, mmax + 1), dtype=complex)
    C[1:, 1:, 0] = C_ndn0[2:nmax2 + 4, 2:nmax1 + 3]

    # ANM(i, m) = anm_l(i-1, m), 1-based
    ANM = np.zeros((2 * nmax + 3, nmax + 1))
    ANM[1:, 1:] = _anm_l(np.arange(0, 2 * nmax + 2)[:, None], np.arange(1, nmax + 1)[None, :])
    with np.errstate(divide="ignore"):
        IANM = 1.0 / ANM

    for m in range(1, mmax + 1):
        nd = np.arange(m, fval - m + 1)
        C_nd1m = (_bnm_l(nd, -m) * C_ndn0[nd + 1, m + 1]
                  - _bnm_l(nd + 1, m - 1) * C_ndn0[nd + 3, m + 1]) / _bnm_l(m, -m)
        C_ndn1 = np.zeros_like(C_ndn0)
        idx = np.arange(1, C_nd1m.size + 1) + m + 1
        C_ndn1[idx, m + 2] = C_nd1m
        C_ndn1[m + 2, idx] = (-1.0) ** (nd + m) * C_nd1m
        for jj in range(m + 1, nmax + 1):
            ii = np.arange(jj, fval - jj + 1)
            C_ndn1[ii + 2, jj + 2] = (
                ANM[jj - 1, m] * C_ndn1[ii + 2, jj]
                - ANM[ii + 1, m] * C_ndn1[ii + 3, jj + 1]
                + ANM[ii, m] * C_ndn1[ii + 1, jj + 1]
            ) * IANM[jj, m]
            C_ndn1[jj + 2, ii + 2] = (-1.0) ** (jj + ii) * C_ndn1[ii + 2, jj + 2]
        C_ndn0 = C_ndn1
        C[1:, 1:, m] = C_ndn0[2:nmax2 + 4, 2:nmax1 + 3]
    return C


def _calculate_ab(C, nmax1: int, nmax2: int, z: float):
    """Port of ``calculate_AB`` (translate_z.m).  ``C`` is 1-based."""
    az = abs(z)
    nn = np.arange(1, nmax1 + 1)[None, :]
    kk = np.arange(1, nmax2 + 1)[:, None]
    matrixm = np.sqrt(kk * (kk + 1)) / np.sqrt(nn * (nn + 1))
    ci1 = np.arange(1, nmax1 + 1) * np.arange(2, nmax1 + 2)
    ci2 = np.arange(1, nmax2 + 1) * np.arange(2, nmax2 + 2)
    ciy, cix = np.meshgrid(ci1, ci2)  # shape (nmax2, nmax1)

    def F(x):
        return x.ravel(order="F")

    mmm = 0
    C0 = C[2:nmax2 + 2, 2:nmax1 + 2, mmm]
    Cp = C[3:nmax2 + 3, 2:nmax1 + 2, mmm]
    Cm = C[1:nmax2 + 1, 2:nmax1 + 2, mmm]
    with np.errstate(all="ignore"):
        t = matrixm * (C0 - 2 * np.pi * az / (kk + 1)
                       * np.sqrt((kk - mmm + 1) * (kk + mmm + 1) / ((2 * kk + 1) * (2 * kk + 3))) * Cp
                       - 2 * np.pi * az / kk
                       * np.sqrt((kk - mmm) * (kk + mmm) / ((2 * kk + 1) * (2 * kk - 1))) * Cm)
    rows = [F(ciy)]
    cols = [F(cix)]
    Avals = [F(t)]
    Bvals = [np.zeros(t.size, dtype=complex)]
    for mmm in range(1, min(nmax1, nmax2) + 1):
        sz1 = np.arange(mmm, nmax2 + 1)
        sz2 = np.arange(mmm, nmax1 + 1)
        k = kk[sz1 - 1]
        C0 = C[1 + mmm:nmax2 + 2, 1 + mmm:nmax1 + 2, mmm]
        Cp = C[2 + mmm:nmax2 + 3, 1 + mmm:nmax1 + 2, mmm]
        Cm = C[mmm:nmax2 + 1, 1 + mmm:nmax1 + 2, mmm]
        mm_ = matrixm[np.ix_(sz1 - 1, sz2 - 1)]
        with np.errstate(all="ignore"):
            tt = mm_ * (C0 - 2 * np.pi * az / (k + 1)
                        * np.sqrt((k - mmm + 1) * (k + mmm + 1) / ((2 * k + 1) * (2 * k + 3))) * Cp
                        - 2 * np.pi * az / k
                        * np.sqrt((k - mmm) * (k + mmm) / ((2 * k + 1) * (2 * k - 1))) * Cm)
        ciys = ciy[mmm - 1:, mmm - 1:]
        cixs = cix[mmm - 1:, mmm - 1:]
        rows += [F(ciys) + mmm, F(ciys) - mmm]
        cols += [F(cixs) + mmm, F(cixs) - mmm]
        Avals += [F(tt), F(tt)]
        tb = mmm / (k * (k + 1)) * mm_ * C0
        Bvals += [F(tb), -F(tb)]
    rows = np.concatenate(rows)
    cols = np.concatenate(cols)
    A = np.concatenate(Avals)
    B = 1j * 2 * np.pi * az * np.concatenate(Bvals)
    shape = (nmax1 * (nmax1 + 2), nmax2 * (nmax2 + 2))
    if z < 0:
        n1, _ = combined_index(rows)
        n2, _ = combined_index(cols)
        B = B * (-1.0) ** (n1 - n2 + 1)
        A = A * (-1.0) ** (n1 - n2)
    A = sparse.csr_matrix((A, (rows - 1, cols - 1)), shape=shape)
    B = sparse.csr_matrix((B, (rows - 1, cols - 1)), shape=shape)
    return A, B


def translate_z(nmax, z: float, ttype: str = "sbesselj"):
    """Translation matrices A, B for a translation ``z`` along the z-axis.

    Port of ``ott.utils.translate_z`` (method 'gumerov').

    Parameters
    ----------
    nmax : int or (int, int)
        Truncation order, or (output Nmax, input Nmax).
    z : float
        Translation distance in **wavelengths in the medium** (OTT units).
    ttype : {'sbesselj', 'sbesselh1', 'sbesselh2'}
        Regular-to-regular, outgoing-to-regular or incoming-to-regular.

    Returns
    -------
    A, B : scipy.sparse.csr_matrix
        Apply as ``[a'; b'] = [[A, B], [B, A]] @ [a; b]``.
    """
    if np.ndim(nmax) == 0:
        nmax1 = nmax2 = int(nmax)
    else:
        nmax1, nmax2 = int(nmax[0]), int(nmax[1])
    nmaxm = max(nmax1, nmax2)
    shape = (nmax1**2 + 2 * nmax1, nmax2**2 + 2 * nmax2)
    if z == 0:
        return sparse.eye(*shape, format="csr", dtype=complex), sparse.csr_matrix(shape, dtype=complex)
    C = _translate_z_gumerov(nmax1, nmax2, nmaxm, abs(z), ttype)
    return _calculate_ab(C, nmax1, nmax2, z)


_C = np.array([[1 / np.sqrt(2), 0, -1 / np.sqrt(2)],
               [1j / np.sqrt(2), 0, 1j / np.sqrt(2)],
               [0, 1, 0]])
_INVC = np.array([[1 / np.sqrt(2), -1j / np.sqrt(2), 0],
                  [0, 0, 1],
                  [-1 / np.sqrt(2), -1j / np.sqrt(2), 0]])


def wigner_rotation_matrix(nmax: int, R) -> sparse.csr_matrix:
    """Wigner D matrix for rotating VSWF coefficients by rotation ``R``.

    Port of ``ott.utils.wigner_rotation_matrix`` (Choi et al. recursion).
    Returns a block-diagonal sparse matrix of size
    ``(nmax^2+2nmax) x (nmax^2+2nmax)``.
    """
    R = np.asarray(R, dtype=float)
    D1 = (_INVC @ R @ _C).T
    DD = D1.copy()
    blocks = [D1]
    for n in range(2, nmax + 1):
        DDD = np.zeros((2 * n + 1, 2 * n + 1), dtype=complex)
        m0 = np.ones((2 * n - 1, 1)) * np.arange(-n, n + 1)[None, :]
        m1 = np.arange(-n + 1, n)[:, None] * np.ones((1, 2 * n + 1))
        a = np.sqrt(np.maximum((n + m0) * (n - m0) / ((n + m1) * (n - m1)), 0))
        b = np.sqrt(np.maximum((n + m0) * (n + m0 - 1) / (2 * (n + m1) * (n - m1)), 0))
        DDD[1:-1, 1:-1] = D1[1, 1] * a[:, 1:-1] * DD
        DDD[1:-1, 2:] += D1[1, 2] * b[:, 2:] * DD
        DDD[1:-1, :-2] += D1[1, 0] * np.fliplr(b[:, 2:]) * DD
        m0 = np.arange(-n, n + 1)
        c = np.sqrt(np.maximum((n + m0) * (n - m0) / (n * (2 * n - 1)), 0))
        d = np.sqrt(np.maximum((n + m0) * (n + m0 - 1) / (2 * n * (2 * n - 1)), 0))
        DDD[0, 1:-1] = D1[0, 1] * c[1:-1] * DD[0, :]
        DDD[0, 2:] += D1[0, 2] * d[2:] * DD[0, :]
        DDD[0, :-2] += D1[0, 0] * d[2:][::-1] * DD[0, :]
        DDD[-1, 1:-1] = D1[2, 1] * c[1:-1] * DD[-1, :]
        DDD[-1, 2:] += D1[2, 2] * d[2:] * DD[-1, :]
        DDD[-1, :-2] += D1[2, 0] * d[2:][::-1] * DD[-1, :]
        blocks.append(DDD)
        DD = DDD
    return sparse.block_diag([sparse.csr_matrix(b) for b in blocks], format="csr")
