"""Special functions and small utilities.

Ports of the following OTT v1 (``+ott/+utils``) functions:
``sbesselj``, ``sbesselh1``, ``sbesselh2``, ``legendrerow``, ``spharm``,
``combined_index``, ``ka2nmax``, ``nmax2ka``, ``laguerre``, ``hermite``,
``paraxial_beam_waist``, ``angulargrid``, ``xyz2rtp``, ``rtp2xyz``,
``rtpv2xyzv``, ``xyzv2rtpv``, ``rotx``, ``roty``, ``rotz``,
``rotation_matrix``.

Array conventions differ slightly from MATLAB: functions that OTT returns
as ``[npts x nmodes]`` matrices return NumPy arrays of the same shape.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import special as sp

__all__ = [
    "sbesselj",
    "sbesselh1",
    "sbesselh2",
    "legendrerow",
    "spharm",
    "combined_index",
    "ka2nmax",
    "nmax2ka",
    "laguerre",
    "hermite",
    "paraxial_beam_waist",
    "angulargrid",
    "xyz2rtp",
    "rtp2xyz",
    "rtpv2xyzv",
    "xyzv2rtpv",
    "rotx",
    "roty",
    "rotz",
    "rotation_matrix",
]


# ---------------------------------------------------------------------------
# Spherical Bessel / Hankel functions
# ---------------------------------------------------------------------------


def _grid(n, kr):
    n = np.atleast_1d(np.asarray(n, dtype=float)).ravel()
    kr = np.atleast_1d(np.asarray(kr)).ravel()
    N, KR = np.meshgrid(n, kr)  # shape (len(kr), len(n)) like OTT
    return N, KR


def _with_derivative(func, n, kr):
    """Evaluate ``func(n, kr)`` and OTT's "derivative".

    OTT returns f_{n-1}(kr) - n/kr f_n(kr) = (1/kr) d(kr f_n)/d(kr), the
    Riccati-type derivative used in the VSWFs and Mie coefficients.
    """
    n = np.atleast_1d(np.asarray(n, dtype=float)).ravel()
    fn = func(n, kr)
    fnm1 = func(n - 1, kr)
    N, KR = _grid(n, kr)
    dfn = fnm1 - N / KR * fn
    return fn, dfn


def sbesselj(n, kr, derivative: bool = False):
    """Spherical Bessel function of the first kind j_n(kr).

    Port of ``ott.utils.sbesselj``.  Returns an array of shape
    ``(len(kr), len(n))``.  ``kr`` may be complex.  If ``derivative`` is
    true also returns j_{n-1} - n/kr j_n (OTT's derivative form).
    """
    if derivative:
        return _with_derivative(sbesselj, n, kr)
    N, KR = _grid(n, kr)
    small = np.abs(KR) < 1e-15
    with np.errstate(all="ignore"):
        jn = np.sqrt(np.pi / (2 * KR)) * sp.jv(N + 0.5, KR)
    if np.any(small):
        # OTT: jn = kr^n / (2n+1)!!
        nn = N[small]
        dfact = np.array([math.prod(range(1, int(2 * v + 2), 2)) if v >= 0 else 1.0 for v in nn],
                         dtype=float)
        jn = np.asarray(jn, dtype=np.result_type(jn, KR, float))
        jn[small] = KR[small] ** nn / dfact
    return jn


def _sbesselh(n, kr, kind: int):
    N, KR = _grid(n, kr)
    # OTT: use besselj+bessely when any |kr| < max(|n|) else besselh
    if np.any(np.abs(KR) < np.max(np.abs(N))):
        sign = 1j if kind == 1 else -1j
        hn = sp.jv(N + 0.5, KR) + sign * sp.yv(N + 0.5, KR)
    else:
        hn = sp.hankel1(N + 0.5, KR) if kind == 1 else sp.hankel2(N + 0.5, KR)
    return np.sqrt(np.pi / (2 * KR)) * hn


def sbesselh1(n, kr, derivative: bool = False):
    """Spherical Hankel function of the first kind h1_n(kr) (outgoing).

    Port of ``ott.utils.sbesselh1``; shape ``(len(kr), len(n))``.
    """
    if derivative:
        return _with_derivative(sbesselh1, n, kr)
    return _sbesselh(n, kr, 1)


def sbesselh2(n, kr, derivative: bool = False):
    """Spherical Hankel function of the second kind h2_n(kr) (incoming).

    Port of ``ott.utils.sbesselh2``; shape ``(len(kr), len(n))``.
    """
    if derivative:
        return _with_derivative(sbesselh2, n, kr)
    return _sbesselh(n, kr, 2)


# ---------------------------------------------------------------------------
# Legendre functions and spherical harmonics
# ---------------------------------------------------------------------------


def legendrerow(n: int, theta) -> np.ndarray:
    """Normalised associated Legendre functions for m = 0..n.

    Port of ``ott.utils.legendrerow``.  Returns shape ``(n+1, len(theta))``.
    Normalisation is such that ``spharm`` gives orthonormal harmonics.
    """
    theta = np.atleast_1d(np.asarray(theta, dtype=float)).ravel()
    if n == 0:
        return np.full((1, theta.size), 1 / np.sqrt(2 * np.pi) / np.sqrt(2))
    ct = np.cos(theta)
    st = np.sin(theta)
    Wnn = np.sqrt((2 * n + 1) / (4 * np.pi) * np.prod(1 - 0.5 / np.arange(1, n + 1))) * np.ones_like(theta)
    Wnnm1 = np.sqrt(2 * n) * ct * Wnn
    pnm = np.zeros((n + 1, theta.size))
    pnm[n] = Wnn
    pnm[n - 1] = Wnnm1
    # OTT: downward row recursion in m (legendrerow.m)
    for ii in range(n - 2, -1, -1):
        a = np.sqrt(4 * (ii + 1) ** 2 / (n - ii) / (n + ii + 1))
        b = np.sqrt((n - ii - 1) * (n + ii + 2) / (n - ii) / (n + ii + 1))
        pnm[ii] = a * ct * pnm[ii + 1] - b * st**2 * pnm[ii + 2]
    M = np.arange(n + 1)[:, None]
    return pnm * st[None, :] ** M


def _spharm_all(n: int, theta, phi) -> np.ndarray:
    """Y_n^m for all m = -n..n; shape ``(2n+1, npts)``."""
    pnm = legendrerow(n, theta)
    m = np.arange(-n, n + 1)
    p = pnm[np.abs(m)]
    p[m < 0] *= ((-1.0) ** m[m < 0])[:, None]
    return p * np.exp(1j * m[:, None] * phi[None, :])


def spharm(n: int, m, theta, phi):
    """Scalar spherical harmonics and their angular derivatives.

    Port of ``ott.utils.spharm``.  Returns ``(Y, Ytheta, Yphi)`` each of
    shape ``(npts, len(m))``, where ``Ytheta = dY/dtheta`` and
    ``Yphi = 1/sin(theta) dY/dphi`` (OTT's definitions).
    """
    theta = np.atleast_1d(np.asarray(theta, dtype=float)).ravel()
    phi = np.atleast_1d(np.asarray(phi, dtype=float)).ravel()
    if theta.size == 1 and phi.size > 1:
        theta = np.full(phi.shape, theta[0])
    if phi.size == 1 and theta.size > 1:
        phi = np.full(theta.shape, phi[0])
    mi = np.atleast_1d(np.asarray(m, dtype=int)).ravel()
    Y = _spharm_all(n, theta, phi)  # (2n+1, npts)
    mv = np.arange(-n, n + 1)[:, None]
    expplus = np.exp(1j * phi)[None, :]
    expminus = np.exp(-1j * phi)[None, :]
    zeros = np.zeros((1, theta.size))
    ymplus = np.vstack([Y[1:], zeros])
    ymminus = np.vstack([zeros, Y[:-1]])
    Ytheta = (np.sqrt((n - mv + 1) * (n + mv)) / 2 * expplus * ymminus
              - np.sqrt((n - mv) * (n + mv + 1)) / 2 * expminus * ymplus)
    Y2 = _spharm_all(n + 1, theta, phi)
    ymplus = Y2[2:]
    ymminus = Y2[:-2]
    Yphi = 1j / 2 * np.sqrt((2 * n + 1) / (2 * n + 3)) * (
        np.sqrt((n + mv + 1) * (n + mv + 2)) * expminus * ymplus
        + np.sqrt((n - mv + 1) * (n - mv + 2)) * expplus * ymminus)
    idx = n + mi
    return Y[idx].T, Ytheta[idx].T, Yphi[idx].T


# ---------------------------------------------------------------------------
# Index helpers
# ---------------------------------------------------------------------------


def combined_index(a, b=None):
    """Convert between (n, m) and OTT's combined index ci = n(n+1) + m.

    Port of ``ott.utils.combined_index``.  ``combined_index(ci)`` returns
    ``(n, m)``; ``combined_index(n, m)`` returns ``ci`` (1-based, as OTT).
    """
    if b is None:
        ci = np.asarray(a)
        n = np.floor(np.sqrt(ci)).astype(int)
        return n, (ci - n**2 - n).astype(int)
    return np.asarray(a) * (np.asarray(a) + 1) + np.asarray(b)


def ka2nmax(ka) -> int:
    """Truncation order for size parameter ka: ceil(ka + 3 ka^(1/3)).

    Port of ``ott.utils.ka2nmax``.
    """
    ka = np.abs(ka)
    return np.ceil(ka + 3 * ka ** (1 / 3)).astype(int) if np.ndim(ka) else int(np.ceil(ka + 3 * ka ** (1 / 3)))


def nmax2ka(nmax):
    """Inverse of :func:`ka2nmax` (port of ``ott.utils.nmax2ka``)."""
    out = []
    for N in np.atleast_1d(nmax):
        r = np.roots([1, -3 * N, 27 + 3 * N**2, -(N**3)])
        # OTT takes kas(3) from MATLAB's roots ordering; the real root.
        out.append(float(np.real(r[np.argmin(np.abs(np.imag(r)))])))
    return out[0] if np.ndim(nmax) == 0 else np.array(out)


# ---------------------------------------------------------------------------
# Paraxial beam helpers
# ---------------------------------------------------------------------------


def laguerre(p: int, l: float, x) -> np.ndarray:
    """Generalised Laguerre polynomial L_p^l(x) (port of ``ott.utils.laguerre``)."""
    x = np.asarray(x, dtype=float)
    L0 = np.ones_like(x)
    if p == 0:
        return L0
    L1 = -x + l + 1
    for ii in range(2, p + 1):
        L0, L1 = L1, ((2 * ii + l - 1 - x) * L1 - (ii + l - 1) * L0) / ii
    return L1


def hermite(n: int, x) -> np.ndarray:
    """Physicists' Hermite polynomial H_n(x) (port of ``ott.utils.hermite``)."""
    x = np.asarray(x, dtype=float)
    H0 = np.ones_like(x)
    if n == 0:
        return H0
    H1 = 2 * x
    for ii in range(2, n + 1):
        H0, H1 = H1, 2 * x * H1 - 2 * (ii - 1) * H0
    return H1


def paraxial_beam_waist(paraxial_order: int) -> float:
    """Normalised beam waist for an LG/HG mode of the given order.

    Port of ``ott.utils.paraxial_beam_waist`` (Lambert W_{-1} by Newton).
    """
    w = 1.0
    if paraxial_order != 0:
        invL = 1.0 / abs(paraxial_order)
        zz = np.exp(-(abs(paraxial_order) + 2.0) * invL)
        w = -(1.0 + 2 * np.sqrt(invL) + invL)
        w0 = -w
        while abs(w - w0) > 0.00001:
            w0 = w
            expw = np.exp(w)
            w = w0 - (w0 * expw + zz) / (expw + w0 * expw)
        w = np.sqrt(-abs(paraxial_order) / 2.0 * w)
    return float(w)


def angulargrid(ntheta: int, nphi: int):
    """Equally spaced (theta, phi) grid flattened column-major.

    Port of ``ott.utils.angulargrid`` (default behaviour).  Returns two
    1-D arrays of length ``ntheta*nphi``.
    """
    theta = (np.arange(1, ntheta + 1) - 0.5) / ntheta * np.pi
    phi = (np.arange(1, nphi + 1) - 1) / nphi * 2 * np.pi
    TH = theta[:, None] * np.ones((1, nphi))
    PH = np.ones((ntheta, 1)) * phi[None, :]
    return TH.ravel(order="F"), PH.ravel(order="F")


# ---------------------------------------------------------------------------
# Coordinates
# ---------------------------------------------------------------------------


def xyz2rtp(x, y, z):
    """Cartesian to spherical (port of ``ott.utils.xyz2rtp``)."""
    x, y, z = (np.asarray(v, dtype=float) for v in (x, y, z))
    xy = np.sqrt(x * x + y * y)
    theta = np.mod(np.arctan2(xy, z) + 2 * np.pi, 2 * np.pi)
    phi = np.mod(np.arctan2(y, x) + 2 * np.pi, 2 * np.pi)
    r = np.sqrt(x * x + y * y + z * z)
    return r, theta, phi


def rtp2xyz(r, theta, phi):
    """Spherical to Cartesian (port of ``ott.utils.rtp2xyz``)."""
    z = r * np.cos(theta)
    xy = r * np.sin(theta)
    return xy * np.cos(phi), xy * np.sin(phi), z


def rtpv2xyzv(vr, vt, vp, theta, phi):
    """Spherical vector components to Cartesian (``ott.utils.rtpv2xyzv``)."""
    st, ct, sph, cph = np.sin(theta), np.cos(theta), np.sin(phi), np.cos(phi)
    vx = st * cph * vr + ct * cph * vt - sph * vp
    vy = st * sph * vr + ct * sph * vt + cph * vp
    vz = ct * vr - st * vt
    return vx, vy, vz


def xyzv2rtpv(vx, vy, vz, theta, phi):
    """Cartesian vector components to spherical (``ott.utils.xyzv2rtpv``)."""
    st, ct, sph, cph = np.sin(theta), np.cos(theta), np.sin(phi), np.cos(phi)
    vr = st * cph * vx + st * sph * vy + ct * vz
    vt = ct * cph * vx + ct * sph * vy - st * vz
    vp = -sph * vx + cph * vy
    return vr, vt, vp


# ---------------------------------------------------------------------------
# Rotations
# ---------------------------------------------------------------------------


def rotx(angle_deg: float) -> np.ndarray:
    """Rotation matrix about x (angle in degrees, ``ott.utils.rotx``)."""
    t = np.deg2rad(angle_deg)
    return np.array([[1, 0, 0], [0, np.cos(t), -np.sin(t)], [0, np.sin(t), np.cos(t)]])


def roty(angle_deg: float) -> np.ndarray:
    """Rotation matrix about y (angle in degrees, ``ott.utils.roty``)."""
    t = np.deg2rad(angle_deg)
    return np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])


def rotz(angle_deg: float) -> np.ndarray:
    """Rotation matrix about z (angle in degrees, ``ott.utils.rotz``)."""
    t = np.deg2rad(angle_deg)
    return np.array([[np.cos(t), -np.sin(t), 0], [np.sin(t), np.cos(t), 0], [0, 0, 1]])


def rotation_matrix(axis, angle: float | None = None) -> np.ndarray:
    """Rodrigues rotation matrix (port of ``ott.utils.rotation_matrix``).

    ``angle`` in radians; if omitted, ``|axis|`` is the angle.
    """
    axis = np.asarray(axis, dtype=float).ravel()
    if angle is None:
        angle = float(np.linalg.norm(axis))
        if angle == 0:
            return np.eye(3)
        axis = axis / angle
    if abs(angle) < 1e-8:
        return np.eye(3)
    axis = axis / np.linalg.norm(axis)
    ux = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(angle) * ux + (1 - np.cos(angle)) * ux @ ux
