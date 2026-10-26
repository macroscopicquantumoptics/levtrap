"""Vector spherical wave functions and field evaluation.

Ports of OTT v1 ``ott.utils.vsh``, ``ott.utils.vswf``,
``ott.utils.vswfcart`` and ``ott.utils.emField``.

All arrays of vectors have a trailing axis of length 3 holding
(r, theta, phi) or (x, y, z) components.
"""

from __future__ import annotations

import numpy as np

from .special import (
    rtpv2xyzv,
    sbesselh1,
    sbesselh2,
    sbesselj,
    spharm,
)

__all__ = ["vsh", "vswf", "vswfcart", "em_field"]

_HTYPES = {"outgoing": 1, "incoming": 2, "regular": 3}


def vsh(n: int, m, theta, phi):
    """Vector spherical harmonics B, C, P (port of ``ott.utils.vsh``).

    Returns three arrays of shape ``(npts, len(m), 3)`` in (r, theta, phi).
    """
    Y, Yt, Yp = spharm(n, m, theta, phi)
    Z = np.zeros_like(Y)
    B = np.stack([Z, Yt, Yp], axis=-1)
    C = np.stack([Z, Yp, -Yt], axis=-1)
    P = np.stack([Y, Z, Z], axis=-1)
    return B, C, P


def vswf(n: int, m, kr, theta, phi, htype="regular"):
    """Vector spherical wave functions M and N (port of ``ott.utils.vswf``).

    Parameters
    ----------
    n : int
        Mode order (scalar).
    m : array_like
        Azimuthal orders.
    kr, theta, phi : array_like
        Evaluation points (kr dimensionless).
    htype : {'regular', 'outgoing', 'incoming'} or 1/2/3

    Returns
    -------
    M, N : ndarray, shape ``(npts, len(m), 3)`` in spherical components.
    """
    if isinstance(htype, str):
        htype = _HTYPES[htype]
    kr = np.atleast_1d(np.asarray(kr)).ravel()
    theta = np.atleast_1d(np.asarray(theta, dtype=float)).ravel()
    phi = np.atleast_1d(np.asarray(phi, dtype=float)).ravel()
    npts = max(kr.size, theta.size, phi.size)
    kr = np.broadcast_to(kr, (npts,))
    theta = np.broadcast_to(theta, (npts,))
    phi = np.broadcast_to(phi, (npts,))
    B, C, P = vsh(n, m, theta, phi)
    Nn = np.sqrt(1 / (n * (n + 1))) if n > 0 else 0.0
    func = {1: sbesselh1, 2: sbesselh2, 3: sbesselj}[htype]
    hn = func(n, kr)[:, 0][:, None, None]
    hn1 = func(n - 1, kr)[:, 0][:, None, None]
    kr3 = kr[:, None, None]
    with np.errstate(all="ignore"):
        M = Nn * hn * C
        N = Nn * (n * (n + 1) / kr3 * hn * P + (hn1 - n / kr3 * hn) * B)
    if htype == 3:
        zero = kr == 0
        if np.any(zero):
            # OTT: regular N at origin is finite only for n == 1
            if n != 1:
                N[zero] = 0
            else:
                N[zero] = 2 / 3 * Nn * (P[zero] + B[zero])
            M[zero] = 0
    return M, N


def _rtp_basis(theta, phi, kr=None):
    st, ct, sp_, cp = np.sin(theta), np.cos(theta), np.sin(phi), np.cos(phi)
    rhat = np.stack([st * cp, st * sp_, ct], axis=-1)
    that = np.stack([ct * cp, ct * sp_, -st], axis=-1)
    phat = np.stack([-sp_, cp, np.zeros_like(st)], axis=-1)
    return rhat, that, phat


def vswfcart(n: int, m, kr, theta, phi, htype="regular"):
    """VSWFs in Cartesian components (port of ``ott.utils.vswfcart``).

    Returns ``M, N`` with shape ``(npts, len(m), 3)`` in (x, y, z).
    """
    M, N = vswf(n, m, kr, theta, phi, htype)
    theta = np.broadcast_to(np.atleast_1d(theta), (M.shape[0],))
    phi = np.broadcast_to(np.atleast_1d(phi), (M.shape[0],))
    rhat, that, phat = _rtp_basis(theta, phi)

    def conv(V):
        return (V[..., 0:1] * rhat[:, None, :] + V[..., 1:2] * that[:, None, :]
                + V[..., 2:3] * phat[:, None, :])

    return conv(M), conv(N)


def em_field(kr, theta, phi, basis: str, n, m, a, b, calc_h: bool = False):
    """Electric (and magnetic) field from VSWF coefficients.

    Port of ``ott.utils.emField``.  ``kr`` is dimensionless.  Outgoing and
    incoming bases use h_n/2 (OTT convention), regular uses j_n.

    Returns ``E`` (and ``H``) of shape ``(npts, 3)`` in spherical
    components (r, theta, phi).
    """
    kr = np.atleast_1d(np.asarray(kr)).ravel().astype(np.result_type(kr, float)).copy()
    theta = np.atleast_1d(np.asarray(theta, dtype=float)).ravel()
    phi = np.atleast_1d(np.asarray(phi, dtype=float)).ravel()
    kr[kr == 0] = 1e-15  # OTT: r_new(r_new==0)=1e-15
    n = np.asarray(n).ravel()
    m = np.asarray(m).ravel()
    a = np.asarray(a).ravel()
    b = np.asarray(b).ravel()
    E = np.zeros((kr.size, 3), dtype=complex)
    H = np.zeros((kr.size, 3), dtype=complex)
    func = {"incoming": sbesselh2, "outgoing": sbesselh1, "regular": sbesselj}[basis]
    scale = 0.5 if basis in ("incoming", "outgoing") else 1.0
    if n.size == 0:
        return (E, H) if calc_h else E
    # radial functions for all orders at once: f_{n-1}, f_n for n = 1..max
    nmax = int(n.max())
    fall = func(np.arange(0, nmax + 1), kr) * scale  # (npts, nmax+1)
    for nn in np.unique(n):
        nn = int(nn)
        vv = n == nn
        Nn = 1 / np.sqrt(nn * (nn + 1))
        Y, Yt, Yp = spharm(nn, m[vv], theta, phi)
        hn = fall[:, nn]
        # dhn = h_{n-1} - n/kr h_n = (1/kr) d(kr h_n)/d(kr)  (OTT emField)
        dhn = fall[:, nn - 1] - nn / kr * hn
        pidx = a[vv]
        qidx = b[vv]
        E[:, 0] += Nn * nn * (nn + 1) / kr * hn * (Y @ qidx)
        E[:, 1] += Nn * (hn * (Yp @ pidx) + dhn * (Yt @ qidx))
        E[:, 2] += Nn * (-hn * (Yt @ pidx) + dhn * (Yp @ qidx))
        if calc_h:
            H[:, 0] += Nn * nn * (nn + 1) / kr * hn * (Y @ pidx)
            H[:, 1] += Nn * (hn * (Yp @ qidx) + dhn * (Yt @ pidx))
            H[:, 2] += Nn * (-hn * (Yt @ qidx) + dhn * (Yp @ pidx))
    if calc_h:
        return E, -1j * H
    return E


def em_field_xyz(kr_xyz, basis, n, m, a, b):
    """Cartesian E-field at Cartesian points given in units of 1/k.

    ``kr_xyz`` has shape ``(npts, 3)``; returns ``(npts, 3)`` complex.
    """
    from .special import xyz2rtp

    r, t, p = xyz2rtp(kr_xyz[:, 0], kr_xyz[:, 1], kr_xyz[:, 2])
    E = em_field(r, t, p, basis, n, m, a, b)
    vx, vy, vz = rtpv2xyzv(E[:, 0], E[:, 1], E[:, 2], t, p)
    out = np.stack([vx, vy, vz], axis=-1)
    out[np.isnan(out)] = 0
    return out

