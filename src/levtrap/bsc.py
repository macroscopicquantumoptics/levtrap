"""Beam shape coefficients (BSCs).

Ports of OTT v1 ``ott.Bsc``, ``ott.BscPlane``, ``ott.BscPointmatch``
(far-field point matching) and ``ott.BscPmGauss`` (Gaussian, LG and HG
beams), plus the HG part of ``ott.utils.paraxial_transformation_matrix``.

Units follow OTT: ``k_medium`` is the wavenumber in the medium in 1/m
(when constructed from SI inputs), positions are in metres, and beam
power is ``sum(|a|^2 + |b|^2)`` in arbitrary units (forces from
:func:`levtrap.force.forcetorque` are then in units of ``n_medium P / c``).
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field

import numpy as np
from scipy import sparse

from .special import (
    angulargrid,
    combined_index,
    laguerre,
    paraxial_beam_waist,
    roty,
    rotz,
    spharm,
    xyz2rtp,
)
from .translate import translate_z, wigner_rotation_matrix
from .vswf import em_field
from .special import rtpv2xyzv  # noqa: E402

__all__ = ["Bsc", "BscPlane", "BscPmGauss", "make_beam_vector", "k_medium_from"]


def _ntot(nmax: int) -> int:
    return nmax * nmax + 2 * nmax


def _dense(x):
    return x.toarray() if sparse.issparse(x) else np.asarray(x)


def k_medium_from(k_medium=None, wavelength_medium=None, index_medium=None,
                  wavelength0=None, default=2 * np.pi) -> float:
    """Port of ``ott.Bsc.parser_k_medium``."""
    if k_medium is not None:
        return k_medium
    if wavelength_medium is not None:
        return 2 * np.pi / wavelength_medium
    if index_medium is not None:
        if wavelength0 is None:
            raise ValueError("wavelength0 must be specified to use index_medium")
        return index_medium * 2 * np.pi / wavelength0
    return default


def make_beam_vector(a, b, n, m, nmax: int | None = None):
    """Pack mode coefficients into full-length vectors.

    Port of ``ott.Bsc.make_beam_vector``.  ``a``, ``b`` have shape
    ``(nmodes,)`` or ``(nmodes, nbeams)``.  Returns dense ``(Ntot, nbeams)``.
    """
    a = np.asarray(a)
    b = np.asarray(b)
    if a.ndim == 1:
        a = a[:, None]
        b = b[:, None]
    n = np.asarray(n, dtype=int).ravel()
    m = np.asarray(m, dtype=int).ravel()
    if nmax is None:
        nmax = int(n.max()) if n.size else 0
    tot = _ntot(nmax)
    A = np.zeros((tot, a.shape[1]), dtype=complex)
    B = np.zeros((tot, a.shape[1]), dtype=complex)
    if n.size:
        ci = combined_index(n, m) - 1
        A[ci] = a
        B[ci] = b
    return A, B


@dataclass
class Bsc:
    """Beam shape coefficients for one or more beams (``ott.Bsc``).

    Attributes
    ----------
    a, b : ndarray, shape (Ntot, nbeams)
        Coefficients of the M (TE) and N (TM) VSWFs.
    basis : {'regular', 'incoming', 'outgoing'}
    type : {'incident', 'scattered', 'total', 'internal'}
    k_medium : float
        Wavenumber in the medium [1/m] (or 2*pi for dimensionless units).
    omega : float
        Angular frequency (OTT keeps it as 2*pi by default).
    dz : float
        Cumulative absolute translation distance.
    """

    a: np.ndarray
    b: np.ndarray
    basis: str = "regular"
    type: str = "incident"
    k_medium: float = 2 * np.pi
    omega: float = 2 * np.pi
    dz: float = 0.0
    info: dict = field(default_factory=dict)

    def __post_init__(self):
        self.a = np.asarray(_dense(self.a), dtype=complex)
        self.b = np.asarray(_dense(self.b), dtype=complex)
        if self.a.ndim == 1:
            self.a = self.a[:, None]
            self.b = self.b[:, None]
        if self.a.shape != self.b.shape:
            raise ValueError("size of a and b must match")
        n = self.a.shape[0]
        if n != 0 and not (n >= 3 and math.isqrt(n + 1) ** 2 == n + 1):
            raise ValueError("number of multipole terms must be 0, 3, 8, 15, 24, ...")

    # -- basic properties ------------------------------------------------
    def copy(self) -> "Bsc":
        return copy.deepcopy(self)

    def _like(self, a, b, **kw) -> "Bsc":
        out = Bsc(a, b, basis=self.basis, type=self.type, k_medium=self.k_medium,
                  omega=self.omega, dz=self.dz, info=dict(self.info))
        for k, v in kw.items():
            setattr(out, k, v)
        return out

    @property
    def Nmax(self) -> int:
        return int(math.isqrt(self.a.shape[0] + 1) - 1) if self.a.shape[0] else 0

    @property
    def Nbeams(self) -> int:
        return self.a.shape[1]

    @property
    def power(self) -> float:
        """Total power sum(|a|^2+|b|^2) over all beams (``Bsc.power``)."""
        return float(np.sum(np.abs(self.a) ** 2 + np.abs(self.b) ** 2))

    @property
    def wavelength(self) -> float:
        return 2 * np.pi / self.k_medium

    def with_power(self, p: float) -> "Bsc":
        """Return a copy scaled to total power ``p`` (``Bsc.set.power``)."""
        return self * np.sqrt(p / self.power)

    def get_mode_indices(self):
        return combined_index(np.arange(1, self.a.shape[0] + 1))

    def beam(self, idx) -> "Bsc":
        idx = np.atleast_1d(idx)
        return self._like(self.a[:, idx], self.b[:, idx])

    # -- arithmetic --------------------------------------------------------
    def __mul__(self, s):
        return self._like(self.a * s, self.b * s)

    __rmul__ = __mul__

    def __truediv__(self, s):
        return self._like(self.a / s, self.b / s)

    def __add__(self, other: "Bsc"):
        n = max(self.Nmax, other.Nmax)
        s1, s2 = self.set_Nmax(n), other.set_Nmax(n)
        return s1._like(s1.a + s2.a, s1.b + s2.b)

    def __sub__(self, other: "Bsc"):
        return self + (-1.0) * other

    def apply(self, M) -> "Bsc":
        """Left-multiply by a matrix (``Bsc.mtimes``)."""
        if M.shape[1] == 2 * self.a.shape[0]:
            ab = M @ np.vstack([self.a, self.b])
            ab = _dense(ab)
            h = ab.shape[0] // 2
            return self._like(ab[:h], ab[h:])
        return self._like(_dense(M @ self.a), _dense(M @ self.b))

    def append(self, other: "Bsc") -> "Bsc":
        if self.Nbeams == 0:
            return other.copy()
        n = max(self.Nmax, other.Nmax)
        s1, s2 = self.set_Nmax(n), other.set_Nmax(n)
        return s1._like(np.hstack([s1.a, s2.a]), np.hstack([s1.b, s2.b]))

    def merge_beams(self) -> "Bsc":
        """Coherent sum of all beams (``Bsc.sum`` / OTT 1.6 ``mergeBeams``)."""
        return self._like(self.a.sum(axis=1, keepdims=True), self.b.sum(axis=1, keepdims=True))

    def total_field(self, ibeam: "Bsc") -> "Bsc":
        """Port of ``Bsc.totalField``: total = 2*scattered + incident."""
        if self.type == "total":
            return self
        if self.type == "scattered":
            out = 2 * self + ibeam
            out.type = "total"
            return out
        raise ValueError(f"Cannot convert from {self.type} to total field")

    def scattered_field(self, ibeam: "Bsc") -> "Bsc":
        if self.type == "scattered":
            return self
        if self.type == "total":
            out = 0.5 * (self - ibeam)
            out.type = "scattered"
            return out
        raise ValueError(f"Cannot convert from {self.type} to scattered field")

    # -- Nmax --------------------------------------------------------------
    def set_Nmax(self, nmax: int) -> "Bsc":
        """Resize to ``nmax`` (``Bsc.set_Nmax``, power-loss warnings dropped)."""
        tot = _ntot(int(nmax))
        cur = self.a.shape[0]
        if cur == tot:
            return self._like(self.a, self.b)
        if cur > tot:
            return self._like(self.a[:tot], self.b[:tot])
        pad = np.zeros((tot - cur, self.Nbeams), dtype=complex)
        return self._like(np.vstack([self.a, pad]), np.vstack([self.b, pad]))

    def shrink_Nmax(self, tolerance: float = 1e-6) -> "Bsc":
        """Smallest Nmax keeping the power within ``tolerance``.

        Port of ``Bsc.shrink_Nmax``.
        """
        if self.Nmax == 0:
            return self
        amagA = np.sum(np.abs(self.a) ** 2)
        bmagA = np.sum(np.abs(self.b) ** 2)
        nbeam = self
        for ii in range(1, self.Nmax + 1):
            tot = _ntot(ii)
            # OTT indexes a(1:total_orders) which flattens multi-beam objects
            na = self.a[:tot]
            nb = self.b[:tot]
            with np.errstate(all="ignore"):
                ea = abs(amagA - np.sum(np.abs(na) ** 2)) / amagA
                eb = abs(bmagA - np.sum(np.abs(nb) ** 2)) / bmagA
            nbeam = self._like(na, nb)
            if ea < tolerance and eb < tolerance:
                break
        return nbeam

    # -- translations ------------------------------------------------------
    def _translation_type(self) -> str:
        return {"incoming": "sbesselh2", "outgoing": "sbesselh1", "regular": "sbesselj"}[self.basis]

    def translate(self, A, B) -> "Bsc":
        """Apply translation matrices: [a';b'] = [[A,B],[B,A]] [a;b]."""
        a = _dense(A @ self.a + B @ self.b)
        b = _dense(B @ self.a + A @ self.b)
        return self._like(a, b)

    def translate_z_matrices(self, z: float, Nmax: int | None = None):
        """Translation matrices (A, B) for distance ``z`` [same units as 1/k]."""
        Nmax = self.Nmax if Nmax is None else Nmax
        zl = z * self.k_medium / 2 / np.pi
        return translate_z([Nmax, self.Nmax], zl, self._translation_type())

    def translate_z(self, z, Nmax: int | None = None) -> "Bsc":
        """Translate along z by ``z`` (scalar or array).

        Port of ``Bsc.translateZ``; multiple ``z`` values produce one beam
        per value (appended).  ``z`` is in the units of ``1/k_medium``
        (metres for SI beams).
        """
        Nmax = self.Nmax if Nmax is None else Nmax
        out = Bsc(np.zeros((0, 0)), np.zeros((0, 0)))
        dz = self.dz
        for zi in np.atleast_1d(z):
            A, B = self.translate_z_matrices(float(zi), Nmax)
            t = self.translate(A, B)
            t.basis = "regular"
            out = out.append(t)
        out.dz = dz + float(np.sum(np.abs(np.atleast_1d(z))))
        out.basis = "regular"
        return out

    def translate_xyz(self, xyz, Nmax: int | None = None) -> "Bsc":
        """Translate by Cartesian vector(s) ``xyz`` of shape (3,) or (3, N).

        Port of ``Bsc.translateXyz``.
        """
        xyz = np.asarray(xyz, dtype=float)
        if xyz.ndim == 1:
            xyz = xyz[:, None]
        r, t, p = xyz2rtp(xyz[0], xyz[1], xyz[2])
        return self.translate_rtp(np.vstack([r, t, p]), Nmax)

    def translate_rtp(self, rtp, Nmax: int | None = None) -> "Bsc":
        """Translate by spherical vector(s) (port of ``Bsc.translateRtp``)."""
        rtp = np.asarray(rtp, dtype=float)
        if rtp.ndim == 1:
            rtp = rtp[:, None]
        oNmax = self.Nmax if Nmax is None else Nmax
        r, theta, phi = rtp[0].copy(), rtp[1], rtp[2]
        if np.any(((theta != 0) & (np.abs(theta) != np.pi)) | (phi != 0)):
            out = Bsc(np.zeros((0, 0)), np.zeros((0, 0)))
            for ii in range(r.size):
                tbeam, D = self.rotate_yz(theta[ii], phi[ii], Nmax=max(oNmax, self.Nmax))
                tbeam = tbeam.translate_z(r[ii], Nmax=oNmax)
                out = out.append(tbeam.rotate_wigner(D.conj().T))
            return out
        idx = np.abs(theta) == np.pi
        r[idx] = -r[idx]
        return self.translate_z(r if r.size > 1 else r[0], Nmax=oNmax)

    # -- rotations -----------------------------------------------------------
    def rotate_wigner(self, D) -> "Bsc":
        sz = self.a.shape[0]
        D2 = D[:sz, :sz]
        return self._like(_dense(D2 @ self.a), _dense(D2 @ self.b))

    def rotate(self, R, Nmax: int | None = None):
        """Rotate the beam by 3x3 matrix ``R`` (port of ``Bsc.rotate``).

        Returns ``(beam, D)`` where ``D`` is the Wigner matrix used.
        """
        Nmax = self.Nmax if Nmax is None else Nmax
        R = np.asarray(R, dtype=float)
        if np.sum((np.eye(3) - R) ** 2) < 1e-6:
            return self._like(self.a, self.b), sparse.eye(_ntot(Nmax), format="csr")
        D = wigner_rotation_matrix(max(self.Nmax, Nmax), R)
        return self.rotate_wigner(D), D

    def rotate_x(self, angle: float, Nmax=None):
        from .special import rotx
        return self.rotate(rotx(np.rad2deg(angle)), Nmax)

    def rotate_y(self, angle: float, Nmax=None):
        return self.rotate(roty(np.rad2deg(angle)), Nmax)

    def rotate_z(self, angle: float, Nmax=None):
        return self.rotate(rotz(np.rad2deg(angle)), Nmax)

    def rotate_yz(self, angley: float, anglez: float, Nmax=None):
        return self.rotate(rotz(np.rad2deg(anglez)) @ roty(np.rad2deg(angley)), Nmax)

    # -- fields -----------------------------------------------------------
    def em_field_xyz(self, xyz, beam_index: int = 0) -> np.ndarray:
        """Electric field at Cartesian points ``xyz`` (shape (npts, 3)).

        Port of ``Bsc.emFieldXyz``.  Returns Cartesian components (npts, 3)
        in OTT field units.
        """
        xyz = np.atleast_2d(np.asarray(xyz, dtype=float))
        r, t, p = xyz2rtp(xyz[:, 0], xyz[:, 1], xyz[:, 2])
        # OTT uses abs(k_medium); the complex wavenumber is kept here so that
        # internal fields of absorbing particles are correct (identical for
        # real k).
        kr = r * self.k_medium
        a = self.a[:, beam_index]
        b = self.b[:, beam_index]
        nz = np.nonzero(np.abs(a) + np.abs(b))[0]
        n, m = combined_index(nz + 1)
        E = em_field(kr, t, p, self.basis, n, m, a[nz], b[nz])
        vx, vy, vz = rtpv2xyzv(E[:, 0], E[:, 1], E[:, 2], t, p)
        out = np.stack([vx, vy, vz], axis=-1)
        out[np.isnan(out)] = 0
        return out

    # -- scattering ---------------------------------------------------------
    def scatter(self, tmatrix, position=None, rotation=None):
        """Scatter this beam by a T-matrix (port of ``Bsc.scatter``).

        Returns ``(sbeam, ibeam)`` where ``ibeam`` is the (possibly
        translated) incident beam.  ``tmatrix`` may be a single
        :class:`levtrap.tmatrix.Tmatrix` or a list of them.
        """
        tms = list(tmatrix) if isinstance(tmatrix, (list, tuple)) else [tmatrix]
        maxN1 = max(t.Nmax[0] for t in tms)
        maxN2 = max(t.Nmax[1] for t in tms)
        ttype = tms[0].type
        if any(t.type != ttype for t in tms):
            raise ValueError("T-matrices must be same type")
        beam = self
        if ttype == "scattered" and position is None:
            maxN2 = min(maxN2, beam.Nmax)
        tms = [t.set_Nmax([maxN1, maxN2]) for t in tms]
        if position is not None:
            if ttype != "scattered":
                maxN2 = min(maxN2, beam.Nmax)
                tms = [t.to_type("scattered").set_Nmax([maxN1, maxN2]) for t in tms]
                ttype = "scattered"
            # OTT: translate with Nmax = maxNmax2 + 1 (Bsc.scatter)
            beam = beam.translate_xyz(position, Nmax=maxN2 + 1)
        rbeam = beam
        if rotation is not None:
            rbeam, _ = rbeam.rotate(rotation, Nmax=maxN1)
        if ttype == "scattered":
            rbeam = rbeam.set_Nmax(maxN2)
        else:
            tms = [t.set_Nmax([maxN1, rbeam.Nmax]) for t in tms]
        sbeam = Bsc(np.zeros((0, 0)), np.zeros((0, 0)))
        for t in tms:
            sbeam = sbeam.append(rbeam.apply(t.data))
        if rotation is not None:
            sbeam, _ = sbeam.rotate(np.linalg.inv(rotation))
        sbeam.k_medium = self.k_medium
        sbeam.omega = self.omega
        if ttype == "total":
            sbeam.type, sbeam.basis = "total", "outgoing"
        elif ttype == "scattered":
            sbeam.type, sbeam.basis = "scattered", "outgoing"
        elif ttype == "internal":
            sbeam.type, sbeam.basis = "internal", "regular"
            sbeam.k_medium = tms[0].k_particle
        return sbeam, beam

    def __rmatmul__(self, tmatrix):  # pragma: no cover - convenience
        return self.scatter(tmatrix)[0]


# ---------------------------------------------------------------------------
# Plane wave
# ---------------------------------------------------------------------------


def BscPlane(theta, phi, polarisation=(1, 1j), Nmax: int | None = None,
             radius: float | None = None, power: float | None = None,
             k_medium=None, index_medium=None, wavelength0=1.0,
             wavelength_medium=None, omega=2 * np.pi) -> Bsc:
    """Plane wave(s) travelling in direction (theta, phi).

    Port of ``ott.BscPlane``.  ``polarisation`` is ``[E_theta, E_phi]``
    (1x2 or Nx2).  Truncation from ``Nmax`` or ``radius`` (ka2nmax).
    """
    from .special import ka2nmax

    k = k_medium_from(k_medium, wavelength_medium, index_medium, wavelength0)
    theta = np.atleast_1d(np.asarray(theta, dtype=float)).ravel()
    phi = np.atleast_1d(np.asarray(phi, dtype=float)).ravel()
    if theta.size != phi.size:
        T, P = np.meshgrid(theta, phi)
        theta, phi = T.ravel(order="F"), P.ravel(order="F")
    pol = np.atleast_2d(np.asarray(polarisation, dtype=complex))
    if pol.shape[0] != theta.size:
        pol = np.repeat(pol, theta.size, axis=0)
    if Nmax is None and radius is None:
        Nmax = ka2nmax(1)
    elif radius is not None:
        Nmax = ka2nmax(radius * k)
    tot = _ntot(Nmax)
    a = np.zeros((tot, theta.size), dtype=complex)
    b = np.zeros((tot, theta.size), dtype=complex)
    Et = pol[:, 0][:, None]
    Ep = pol[:, 1][:, None]
    for n in range(1, Nmax + 1):
        it = slice((n - 1) * (n + 1), n * (n + 2))
        Nn = 1 / np.sqrt(n * (n + 1))
        _, dtY, dpY = spharm(n, np.arange(-n, n + 1), theta, phi)
        a[it] = (4 * np.pi * Nn * (-1j) ** (n + 1) * (np.conj(dpY) * Et - np.conj(dtY) * Ep)).T
        b[it] = (4 * np.pi * Nn * (-1j) ** n * (np.conj(dtY) * Et + np.conj(dpY) * Ep)).T
    pw = np.abs(a) ** 2 + np.abs(b) ** 2
    nz = pw > 1e-15 * pw.max()
    a[~nz] = 0
    b[~nz] = 0
    beam = Bsc(a, b, basis="regular", type="incident", k_medium=k, omega=omega)
    if power is not None:
        beam = beam.with_power(power)
    return beam


# ---------------------------------------------------------------------------
# Point matching
# ---------------------------------------------------------------------------


def bsc_farfield(nn, mm, e_field, theta, phi, zero_rejection_level=1e-8):
    """Far-field point matching (port of ``BscPointmatch.bsc_farfield``).

    ``e_field`` is ``[E_theta; E_phi]`` stacked (length 2*npts).
    Returns dense ``(a, b)`` of shape ``(Ntot, 1)``.
    """
    nn = np.asarray(nn, dtype=int).ravel()
    mm = np.asarray(mm, dtype=int).ravel()
    L = nn.size
    cm = np.zeros((e_field.size, 2 * L), dtype=complex)
    for n in range(1, int(nn.max()) + 1):
        ci = np.nonzero(nn == n)[0]
        if ci.size == 0:
            continue
        _, dtY, dpY = spharm(n, mm[ci], theta, phi)
        s = 1 / np.sqrt(n * (n + 1))
        cm[:, ci] = np.vstack([dpY, -dtY]) * (1j ** (n + 1) * s)
        cm[:, ci + L] = np.vstack([dtY, dpY]) * (1j**n * s)
    # OTT: coefficient_matrix \ e_field (least squares)
    coeffs = np.linalg.lstsq(cm, e_field, rcond=None)[0]
    fa = coeffs[:L]
    fb = coeffs[L:]
    if zero_rejection_level is not None:
        pwr = np.abs(fa) ** 2 + np.abs(fb) ** 2
        keep = pwr > zero_rejection_level * pwr.max()
        nn, mm, fa, fb = nn[keep], mm[keep], fa[keep], fb[keep]
    return make_beam_vector(fa, fb, nn, mm)


def _gen_lg2hg(order: int) -> np.ndarray:
    """LG -> HG mode weight matrix (``genLG2HG`` in
    ``ott.utils.paraxial_transformation_matrix``).  1-based internals."""
    fact = math.factorial
    nh = order // 2
    n = np.arange(0, nh + 1)
    N, K = np.meshgrid(n, n)
    M = order - N
    P = np.minimum(N, M)
    vfact = np.vectorize(lambda v: float(fact(int(v))))
    norm = np.sqrt(vfact(order - K) * vfact(K) / vfact(N) / vfact(M) / 2**order)
    summed = np.zeros(norm.shape)
    summed[:, 0] = vfact(M[:, 0]) / vfact(M[:, 0] - K[:, 0])
    summed[0, :] = 1.0
    s_i = np.zeros((n.size - 1 + 1, nh + 1 + 1))  # 1-based
    for jj in range(1, n.size):
        mmv = order - jj
        for kk in range(1, n.size):
            s_i[kk, 1] = fact(jj) * fact(mmv) / fact(mmv - kk) / fact(jj) * 1.0
            for ii in range(1, kk + 1):
                s_i[kk, ii + 1] = -(jj - ii + 1) / (mmv - kk + ii) / ii * (kk - ii + 1) * s_i[kk, ii]
        summed[1:, jj] = s_i[1:n.size, 1:].sum(axis=1)
    block = norm * summed / vfact(K) * (-1.0) ** P
    out = np.zeros((order + 1, order + 1), dtype=complex)
    ch = -(-order // 2)  # ceil(order/2)
    out[: nh + 1, :] = np.hstack([block[:, :ch], np.fliplr(block * (-1.0) ** P.T)])
    if ch > 0:
        out[order + 1 - ch:, :] = np.flipud(out[:ch, :])
    out[ch:, 1::2] = -out[ch:, 1::2]
    out[1::2, :] = -out[1::2, :]
    out = out * (1j ** np.arange(order + 1))[:, None]
    return out


def BscPmGauss(beam_type: str = "lg", mode=(0, 0), *, polarisation=(1, 1j),
               NA: float | None = None, angle: float | None = None,
               angle_deg: float | None = None, index_medium: float | None = None,
               wavelength0: float = 1.0, k_medium=None, wavelength_medium=None,
               power: float | None = None, Nmax: int | None = None,
               truncation_angle: float | None = None, offset=None,
               angular_scaling: str = "tantheta", zero_rejection_level: float = 1e-8,
               omega: float = 2 * np.pi) -> Bsc:
    """Focused Gaussian / Laguerre-Gaussian / Hermite-Gaussian beam.

    Port of ``ott.BscPmGauss`` (far-field point matching of a paraxial
    beam mapped onto the back aperture, OTT's 'Default' method).

    Parameters
    ----------
    beam_type : {'lg', 'hg'}
        Mode family.  ``mode`` is ``(p, l)`` for LG, ``(m, n)`` for HG.
        ``('lg', (0, 0))`` is the fundamental Gaussian.
    polarisation : (complex, complex)
        Jones vector ``[Ex, Ey]``; ``(1, 1j)`` is circular.
    NA, angle, angle_deg : float
        Beam convergence: numerical aperture (needs ``index_medium``),
        or the paraxial divergence angle in rad / degrees.
    index_medium, wavelength0 : float
        Medium index and vacuum wavelength [m]; sets ``k_medium``.
    power : float, optional
        Normalise ``sum(|a|^2+|b|^2)`` to this value.
    Nmax : int, optional
        Truncation; default 100 then shrunk (as OTT).
    truncation_angle : float, optional
        Hard aperture [rad]; default pi/2 (no truncation).
    offset : (3,) array, optional
        Beam focus offset [m] (OTT's far-field phase-shift offset).
    """
    k = k_medium_from(k_medium, wavelength_medium, index_medium, wavelength0)
    if truncation_angle is None:
        truncation_angle = np.pi / 2
    mode = tuple(mode)
    if beam_type == "hg":
        if len(mode) != 2:
            raise ValueError("mode must be 2 element vector")
        m_, n_ = int(mode[0]), int(mode[1])
        order = m_ + n_
        modeweights = _gen_lg2hg(order)
        i2 = np.arange(-order, order + 1, 2)
        initial_mode = np.stack([(order - np.abs(i2)) // 2, i2], axis=1)
        final_i1 = order - np.arange(0, order + 1)
        row = int(np.nonzero(final_i1 == m_)[0][0])
    elif beam_type == "lg":
        if len(mode) != 2:
            raise ValueError("mode must be 2 element vector")
        p_, l_ = mode
        if p_ != int(p_) or p_ < 0:
            raise ValueError("Radial mode index must be positive integer")
        if l_ != int(l_):
            raise ValueError("Azimuthal mode index must be integer")
        p_, l_ = int(p_), int(l_)
        order = 2 * p_ + abs(l_)
        modeweights = np.eye(order + 1)
        row = (l_ + order) // 2
        i2 = np.arange(-order, order + 1, 2)
        initial_mode = np.stack([(order - np.abs(i2)) // 2, i2], axis=1)
    else:
        raise ValueError("beam_type must be 'lg' or 'hg'")
    keepz = np.abs(modeweights[row, :]) > 0
    initial_mode = initial_mode[keepz]
    c = modeweights[row, keepz]

    nspec = sum(x is not None for x in (angle, angle_deg, NA))
    if nspec > 1:
        raise ValueError("Only specify NA, angle or angle_deg")
    if angle is None and angle_deg is None:
        if NA is None:
            NA_, index = 1.02, 1.33
        else:
            if index_medium is None:
                raise ValueError("Need to specify index_medium with NA")
            NA_, index = NA, index_medium
        beam_angle_deg = np.degrees(np.arcsin(NA_ / index))
    elif angle_deg is not None:
        beam_angle_deg = angle_deg
    else:
        beam_angle_deg = np.degrees(angle)

    xcomp, ycomp = complex(polarisation[0]), complex(polarisation[1])
    axisymmetry = True
    if offset is not None and np.any(np.abs(np.asarray(offset)[:2]) > 0):
        axisymmetry = False

    w0 = paraxial_beam_waist(order)
    wscaling = 1 / np.tan(abs(np.radians(beam_angle_deg)))
    nmax = 100 if Nmax is None else int(Nmax)
    ntheta = nmax + 1
    nphi = 2 * (nmax + 1)
    if axisymmetry:
        ntheta = 2 * (nmax + 1)
        nphi = 3
        if beam_type != "lg":
            nphi = order + 3 - order % 2
    if offset is not None:
        offset_lambda = np.linalg.norm(offset) * k / (2 * np.pi)
        ntheta = max(ntheta, 3 * int(np.ceil(offset_lambda)))
        nphi = max(nphi, 2 * 3 * int(np.ceil(offset_lambda)))
    theta, phi = angulargrid(ntheta, nphi)

    if angular_scaling == "tantheta":
        rw = 2 * (wscaling * w0) ** 2 * np.tan(theta) ** 2
        dr = (wscaling * w0) * (1 / np.cos(theta)) ** 2
    elif angular_scaling == "sintheta":
        wscaling = 1 / np.sin(abs(np.radians(beam_angle_deg)))
        rw = 2 * (wscaling * w0) ** 2 * np.sin(theta) ** 2
        dr = (wscaling * w0) * np.abs(np.cos(theta))
    else:
        raise ValueError("Unknown angular_scaling parameter value")

    total_modes = nmax**2 + 2 * nmax
    nn, mm = combined_index(np.arange(1, total_modes + 1))
    mode_index_vector = []
    envelope = np.zeros((theta.size, c.size), dtype=complex)
    for ii in range(c.size):
        radial_mode = int(initial_mode[ii, 0])
        azimuthal_mode = int(initial_mode[ii, 1])
        norm_paraxial = np.sqrt(2 * math.factorial(radial_mode)
                                / (np.pi * math.factorial(radial_mode + abs(azimuthal_mode))))
        L = laguerre(radial_mode, abs(azimuthal_mode), rw)
        env = (norm_paraxial * rw ** abs(azimuthal_mode / 2) * L
               * np.exp(-rw / 2 + 1j * azimuthal_mode * phi
                        + 1j * np.pi / 2 * (radial_mode * 2 + abs(azimuthal_mode) + 1)))
        mode_input_power = np.sqrt(np.sum(2 * np.pi * np.abs(env) ** 2 * np.sqrt(rw / 2) * np.abs(dr)))
        aperture_norm = np.sqrt(np.sum(2 * np.pi * np.abs(env) ** 2 * np.sin(theta)))
        envelope[:, ii] = c[ii] * env / aperture_norm * mode_input_power
        mode_index_vector.append(np.nonzero((mm == azimuthal_mode + 1) | (mm == azimuthal_mode - 1))[0])
    mode_index_vector = np.unique(np.concatenate(mode_index_vector))
    envelope = envelope.sum(axis=1)
    envelope[theta < np.pi - truncation_angle] = 0
    if offset is not None:
        off = np.asarray(offset, dtype=float).ravel()
        rhat = np.stack([np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi), np.cos(theta)], axis=1)
        envelope = envelope * np.exp(1j * k * (rhat @ off))
    Ex = xcomp * envelope
    Ey = ycomp * envelope
    Etheta = -Ex * np.cos(phi) - Ey * np.sin(phi)
    Ephi = -Ex * np.sin(phi) + Ey * np.cos(phi)
    e_field = np.concatenate([Etheta, Ephi])
    if axisymmetry:
        nn = nn[mode_index_vector]
        mm = mm[mode_index_vector]
        keep = np.abs(mm) <= order + 1
        nn, mm = nn[keep], mm[keep]
    a, b = bsc_farfield(nn, mm, e_field, theta, phi, zero_rejection_level)
    beam = Bsc(a, b, basis="regular", type="incident", k_medium=k, omega=omega)
    if Nmax is None:
        beam = beam.shrink_Nmax()
    if power is not None:
        beam = beam.with_power(power)
    beam.info = dict(beam_type=beam_type, mode=mode, polarisation=(xcomp, ycomp),
                     angle=np.radians(beam_angle_deg), truncation_angle=truncation_angle)
    return beam

