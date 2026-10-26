"""Aspheric focusing lens: ray trace with tilt/decentre and the focused beam.

Not part of OTT.  Used by the "lens tilt" page to answer: if the trapping
asphere is tilted (or decentred) by hand, where does the focus go, how
aberrated is it, and what happens to the trapped particle?

Model
-----
1. A collimated Gaussian beam (1/e^2 intensity diameter D) travelling along
   +z is traced through a two-surface even asphere (sequential, real rays,
   Snell's law in vector form), clipped by each surface's clear aperture.
   The lens can be tilted about x and y around a chosen pivot and decentred.
2. Behind the lens every ray has a direction u and an optical path.  The
   wavefront error W(u) relative to a reference point P is
   W = L + u.(P - Q) (Q: exit point, L: optical path to Q).  The best focus
   P* minimises the intensity-weighted variance of W (linear least squares);
   that is the reported focus position.  The residual W about P* (coma,
   astigmatism, spherical aberration) shapes the focal spot.
3. The far field on the incoming hemisphere, E = A exp(i k W) with the
   ray-density amplitude A = E_in sqrt(|u_z| / J) (J = |d(u_x, u_y)/d(x, y)|),
   is projected onto vector spherical harmonics, summing over rays
   (:func:`project_rays`), to give beam shape coefficients centred on P*.  Polarisation is mapped as in OTT's
   BscPmGauss (no polarisation change at the interfaces).

Units: millimetres for the lens geometry, metres at the API boundary.

Default lens: Thorlabs 354330-C (f = 3.10 mm, NA 0.68, D-ZK3M), prescription
from the Thorlabs Zemax file (design wavelength 830 nm):
S1 even asphere, R = 1/0.36692108501490123 mm, k = -0.5421234096046,
A4..A10 = -2.077710281508e-5, -1.373929859525e-4, 2.029327872896e-5,
-2.961194418229e-6; thickness 3.214106073867 mm; semi-diameter 2.5 mm.
S2 even asphere, R = 1/-0.33567844058620466 mm, k = -12.10285287639,
A4..A10 = 8.068904748567e-3, -1.725894132603e-3, 1.839071992368e-4,
-8.936267158057e-6; semi-diameter 1.920176352261 mm; back focus 1.760004021584 mm.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .bsc import Bsc, make_beam_vector
from .special import legendrerow, spharm

__all__ = ["Surface", "Lens", "THORLABS_354330", "glass_index", "trace", "best_focus",
           "focused_beam", "LensResult"]


# ---------------------------------------------------------------------------
# Glass
# ---------------------------------------------------------------------------

# CDGM D-ZK3, Sellmeier (refractiveindex.info, CDGM Zemax catalogue 2022-06,
# CC0): n^2 - 1 = sum B_i l^2 / (l^2 - C_i), l in um.
_SELLMEIER = {
    "D-ZK3": (1.33936811, 0.00760612309, 0.148690268, 0.0238444644, 1.00954033, 89.0419787),
}


def glass_index(name: str, wavelength_um: float) -> float:
    B1, C1, B2, C2, B3, C3 = _SELLMEIER[name]
    l2 = wavelength_um**2
    return math.sqrt(1 + B1 * l2 / (l2 - C1) + B2 * l2 / (l2 - C2) + B3 * l2 / (l2 - C3))


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Surface:
    """Even asphere: z = c r^2 / (1 + sqrt(1 - (1+k) c^2 r^2)) + sum A_2i r^2i."""

    curv: float
    conic: float
    coeffs: tuple  # (A4, A6, A8, A10, ...) in mm^(1-2i)
    semi_diameter: float

    def sag(self, r2):
        c, k = self.curv, self.conic
        s = c * r2 / (1 + np.sqrt(np.maximum(1 - (1 + k) * c * c * r2, 0)))
        p = r2 * r2
        for a in self.coeffs:
            s = s + a * p
            p = p * r2
        return s

    def dsag_dr2(self, r2):
        """d sag / d(r^2)."""
        c, k = self.curv, self.conic
        q = np.sqrt(np.maximum(1 - (1 + k) * c * c * r2, 1e-300))
        d = c / (1 + q) + c * r2 * ((1 + k) * c * c / (2 * q)) / (1 + q) ** 2
        p = r2
        for i, a in enumerate(self.coeffs):
            d = d + (i + 2) * a * p
            p = p * r2
        return d


@dataclass(frozen=True)
class Lens:
    s1: Surface
    s2: Surface
    thickness: float  # mm
    glass: str
    design_wavelength_um: float
    design_bfl: float  # mm, from the S2 vertex at the design wavelength
    name: str = ""
    index_offset: float = 0.0  # calibrated n offset for the moulded glass


THORLABS_354330 = Lens(
    s1=Surface(0.36692108501490123, -0.5421234096046,
               (-2.077710281508e-5, -1.373929859525e-4, 2.029327872896e-5, -2.961194418229e-6), 2.5),
    s2=Surface(-0.33567844058620466, -12.10285287639,
               (8.068904748567e-3, -1.725894132603e-3, 1.839071992368e-4, -8.936267158057e-6),
               1.920176352261),
    thickness=3.214106073867, glass="D-ZK3", design_wavelength_um=0.83, design_bfl=1.760004021584,
    name="Thorlabs 354330-C (f = 3.10 mm, NA 0.68, D-ZK3M)",
    # calibrate_index(): reproduces the Zemax back focus 1.760004 mm at 830 nm
    # with CDGM D-ZK3 dispersion (tests/test_lens.py re-derives it)
    index_offset=-0.002665926317537358,
)


def _rot(tx_deg: float, ty_deg: float) -> np.ndarray:
    """Rotation: first about x by tx, then about y by ty (degrees)."""
    a, b = math.radians(tx_deg), math.radians(ty_deg)
    Rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    Ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    return Ry @ Rx


def _intersect(surf: Surface, z0: float, P, U, valid):
    """Ray-asphere intersection (lens frame, surface vertex at z = z0)."""
    # start from the vertex plane, Newton on f(t) = z(t) - z0 - sag(r(t))
    t = (z0 - P[:, 2]) / U[:, 2]
    for _ in range(30):
        X = P + t[:, None] * U
        r2 = X[:, 0] ** 2 + X[:, 1] ** 2
        d = surf.dsag_dr2(r2)
        f = X[:, 2] - z0 - surf.sag(r2)
        fp = U[:, 2] - d * 2 * (X[:, 0] * U[:, 0] + X[:, 1] * U[:, 1])
        dt = f / fp
        t = t - dt
        if np.nanmax(np.abs(dt[valid])) < 1e-12 if valid.any() else True:
            break
    X = P + t[:, None] * U
    r2 = X[:, 0] ** 2 + X[:, 1] ** 2
    d = surf.dsag_dr2(r2)
    Nrm = np.stack([-2 * d * X[:, 0], -2 * d * X[:, 1], np.ones_like(r2)], axis=1)
    Nrm /= np.linalg.norm(Nrm, axis=1, keepdims=True)
    valid = valid & (r2 <= surf.semi_diameter**2) & np.isfinite(t)
    return X, t, Nrm, valid


def _refract(U, Nrm, n1: float, n2: float, valid):
    cosi = -np.sum(U * Nrm, axis=1)
    flip = cosi < 0
    Nrm = np.where(flip[:, None], -Nrm, Nrm)
    cosi = np.abs(cosi)
    eta = n1 / n2
    k = 1 - eta**2 * (1 - cosi**2)
    valid = valid & (k >= 0)  # total internal reflection removes the ray
    cost = np.sqrt(np.maximum(k, 0))
    Ut = eta * U + (eta * cosi - cost)[:, None] * Nrm
    return Ut / np.linalg.norm(Ut, axis=1, keepdims=True), valid


@dataclass
class TraceResult:
    x: np.ndarray  # input ray grid coordinates (mm), shape (N, N)
    y: np.ndarray
    E_in: np.ndarray  # input field amplitude
    Q: np.ndarray  # exit points (lab, mm), (N, N, 3)
    U: np.ndarray  # exit directions (lab), (N, N, 3)
    L: np.ndarray  # optical path from the input plane to Q (mm)
    valid: np.ndarray
    n_glass: float
    transmitted: float  # fraction of input power transmitted by the apertures


def trace(lens: Lens, wavelength_um: float, beam_diameter_mm: float, tilt_x_deg: float = 0.0,
          tilt_y_deg: float = 0.0, decenter_mm=(0.0, 0.0), pivot: str = "centre", n_rays: int = 161,
          beam_offset_mm=(0.0, 0.0)) -> TraceResult:
    """Trace a collimated Gaussian beam through the (tilted) lens.

    ``beam_diameter_mm`` is the 1/e^2 intensity diameter.  ``pivot`` is the
    tilt centre on the lens axis: 'S1' (front vertex), 'centre' (mid
    thickness) or 'S2' (back vertex).  Lens frame: S1 vertex at z = 0.
    """
    n = glass_index(lens.glass, wavelength_um) + lens.index_offset
    w = beam_diameter_mm / 2
    half = max(lens.s1.semi_diameter, w * 1.6) * 1.0001
    g = np.linspace(-half, half, n_rays)
    X0, Y0 = np.meshgrid(g, g, indexing="xy")
    E_in = np.exp(-((X0 - beam_offset_mm[0]) ** 2 + (Y0 - beam_offset_mm[1]) ** 2) / w**2)
    P = np.stack([X0.ravel(), Y0.ravel(), np.full(X0.size, -1.0)], axis=1)
    U = np.tile([0.0, 0.0, 1.0], (X0.size, 1))
    pz = {"S1": 0.0, "centre": lens.thickness / 2, "S2": lens.thickness}[pivot]
    pivot_pt = np.array([0.0, 0.0, pz])
    R = _rot(tilt_x_deg, tilt_y_deg)
    shift = np.array([decenter_mm[0], decenter_mm[1], 0.0])
    # lab -> lens frame: x_lens = R^T (x_lab - pivot - shift) + pivot
    to_lens = lambda V: (V - pivot_pt - shift) @ R + pivot_pt  # noqa: E731
    Pl = to_lens(P)
    Ul = U @ R
    valid = np.ones(P.shape[0], bool)
    X1, t1, N1, valid = _intersect(lens.s1, 0.0, Pl, Ul, valid)
    U1, valid = _refract(Ul, N1, 1.0, n, valid)
    X2, t2, N2, valid = _intersect(lens.s2, lens.thickness, X1, U1, valid)
    U2, valid = _refract(U1, N2, n, 1.0, valid)
    L = t1 * 1.0 + t2 * n
    # lens -> lab
    Q = (X2 - pivot_pt) @ R.T + pivot_pt + shift
    Ulab = U2 @ R.T
    valid = valid & (Ulab[:, 2] > 0)
    shp = X0.shape
    Pin = np.sum(E_in**2)
    tr = float(np.sum(E_in.ravel()[valid] ** 2) / Pin)
    return TraceResult(X0, Y0, E_in, Q.reshape(shp + (3,)), Ulab.reshape(shp + (3,)), L.reshape(shp),
                       valid.reshape(shp), n, tr)


def best_focus(tr: TraceResult):
    """Point P* minimising the intensity-weighted variance of W = L + u.(P - Q).

    Returns ``(P_star [mm], W_residual [mm] on the ray grid, rms [mm])``.
    """
    v = tr.valid
    Uv = tr.U[v]
    a = tr.L[v] - np.sum(Uv * tr.Q[v], axis=1)  # W(P) = a + u.P
    wgt = (tr.E_in[v] ** 2)
    # minimise sum w (a + u.P - c)^2 over (P, c)
    A = np.column_stack([Uv, -np.ones(len(a))]) * np.sqrt(wgt)[:, None]
    sol, *_ = np.linalg.lstsq(A, -a * np.sqrt(wgt), rcond=None)
    P = sol[:3]
    c = sol[3]
    W = np.full(tr.L.shape, np.nan)
    W[v] = a + Uv @ P - c
    rms = math.sqrt(np.sum(wgt * W[v] ** 2) / np.sum(wgt))
    return P, W, rms


def paraxial_bfl(lens: Lens, wavelength_um: float) -> float:
    """Back focal distance (mm from the S2 vertex) of marginal-free near-axis rays."""
    tr = trace(lens, wavelength_um, beam_diameter_mm=0.2, n_rays=41)
    P, _, _ = best_focus(tr)
    return float(P[2] - lens.thickness)


def calibrate_index(lens: Lens) -> Lens:
    """Offset the catalogue index so the design back focus is reproduced.

    The Zemax file uses Lightpath's moulded D-ZK3M, whose index differs
    slightly from the CDGM D-ZK3 catalogue value; the offset is chosen so
    the best focus at the design wavelength (full aperture) lies at the
    design back focal distance.
    """
    from scipy.optimize import brentq

    def err(dn):
        l2 = Lens(**{**lens.__dict__, "index_offset": dn})
        tr = trace(l2, lens.design_wavelength_um, beam_diameter_mm=2 * lens.s1.semi_diameter * 3, n_rays=81)
        P, _, _ = best_focus(tr)
        return P[2] - lens.thickness - lens.design_bfl

    lens0 = Lens(**{**lens.__dict__, "index_offset": 0.0})
    lens = lens0
    dn = brentq(err, -0.03, 0.03, xtol=1e-9)
    return Lens(**{**lens0.__dict__, "index_offset": dn})


# ---------------------------------------------------------------------------
# Far field -> beam shape coefficients
# ---------------------------------------------------------------------------


def _ylm0(P: np.ndarray, nn: int, m: np.ndarray) -> np.ndarray:
    """Y_nn^m(theta, phi=0) for the requested m; zero where |m| > nn.  (npts, len(m))"""
    am = np.abs(m)
    ok = am <= nn
    out = np.zeros((P.shape[1], m.size))
    out[:, ok] = (P[am[ok]] * np.where(m[ok] < 0, (-1.0) ** am[ok], 1.0)[:, None]).T
    return out


def _ytheta_yphi_phi0(n: int, m: np.ndarray, Pn: np.ndarray, Pn1: np.ndarray):
    """OTT's Ytheta and Yphi (spharm.m recurrences) at phi = 0."""
    mv = m[None, :].astype(float)
    Yt = (np.sqrt(np.maximum((n - mv + 1) * (n + mv), 0)) / 2 * _ylm0(Pn, n, m - 1)
          - np.sqrt(np.maximum((n - mv) * (n + mv + 1), 0)) / 2 * _ylm0(Pn, n, m + 1))
    Yp = 0.5j * math.sqrt((2 * n + 1) / (2 * n + 3)) * (
        np.sqrt(np.maximum((n + mv + 1) * (n + mv + 2), 0)) * _ylm0(Pn1, n + 1, m + 1)
        + np.sqrt(np.maximum((n - mv + 1) * (n - mv + 2), 0)) * _ylm0(Pn1, n + 1, m - 1))
    return Yt, Yp


def project_rays(tr: TraceResult, P_star_mm, wavelength_um: float, polarisation, nmax: int):
    """Beam shape coefficients by projecting the far field, summed over rays.

    The projection integral over the incoming hemisphere,
    int E(r_hat) . conj(C_nm(r_hat)) dOmega (and likewise for B_nm; see
    :func:`project_farfield`), is evaluated as a sum over the traced rays.
    Each ray of input area dA covers dOmega = J dA / |u_z| and carries far
    field E = E_in sqrt(|u_z| / J) exp(i k W), so E dOmega =
    E_in sqrt(J / |u_z|) exp(i k W) dA.  J enters only as sqrt(J), which stays
    finite where aberrations fold the ray mapping (J -> 0), and no
    interpolation onto an angular grid is needed.  The ray carrying direction
    u sits at r_hat = -u on the incoming hemisphere.
    """
    v = tr.valid.copy()
    U = tr.U
    dx = tr.x[0, 1] - tr.x[0, 0]
    uxx = np.gradient(U[..., 0], dx, axis=1)
    uxy = np.gradient(U[..., 0], dx, axis=0)
    uyx = np.gradient(U[..., 1], dx, axis=1)
    uyy = np.gradient(U[..., 1], dx, axis=0)
    J = np.abs(uxx * uyy - uxy * uyx)
    # one-sided differences at the clipped edge would mix in blocked rays
    inner = v.copy()
    inner[1:-1, 1:-1] &= v[:-2, 1:-1] & v[2:, 1:-1] & v[1:-1, :-2] & v[1:-1, 2:]
    inner[0, :] = inner[-1, :] = inner[:, 0] = inner[:, -1] = False
    edge = v & ~inner
    # edge rays: use the mean J of their valid interior neighbours (or skip)
    if edge.any():
        Jn = np.where(inner, J, 0.0)
        cnt = inner.astype(float)
        Js = np.zeros_like(J)
        cs = np.zeros_like(J)
        for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            Js += np.roll(np.roll(Jn, sx, 0), sy, 1)
            cs += np.roll(np.roll(cnt, sx, 0), sy, 1)
        J = np.where(edge, np.where(cs > 0, Js / np.maximum(cs, 1), 0.0), J)
    uz = np.abs(U[..., 2])
    k_mm = 2 * np.pi / (wavelength_um * 1e-3)
    W = tr.L - np.sum(U * tr.Q, axis=-1) + U @ np.asarray(P_star_mm)
    W = W - np.sum(np.where(v, W * tr.E_in**2, 0)) / np.sum(np.where(v, tr.E_in**2, 0))
    # sign fixed numerically: moving the reference point by +d moves the focus
    # by -d relative to it (tests/test_lens.py)
    w = np.where(v, tr.E_in * np.sqrt(J / np.maximum(uz, 1e-12)) * np.exp(1j * k_mm * W) * dx * dx, 0)[v]
    rx, ry, rz = -U[..., 0][v], -U[..., 1][v], -U[..., 2][v]
    theta = np.arccos(np.clip(rz, -1, 1))
    phi = np.arctan2(ry, rx)
    ex, ey = complex(polarisation[0]), complex(polarisation[1])
    # OTT BscPmGauss convention for the polarisation on the far-field sphere
    Et = w * (-ex * np.cos(phi) - ey * np.sin(phi))
    Ep = w * (-ex * np.sin(phi) + ey * np.cos(phi))
    # Y_nm(theta, phi) = Y_nm(theta, 0) e^{i m phi} for Y, Ytheta and Yphi, so
    # the phi dependence is applied once: G_m = E e^{-i m phi}
    M = nmax
    e1 = np.exp(-1j * phi)
    pw = np.ones((phi.size, 2 * M + 1), dtype=complex)  # columns m = -M..M
    for j in range(1, M + 1):
        pw[:, M + j] = pw[:, M + j - 1] * e1
        pw[:, M - j] = pw[:, M - j + 1] * np.conj(e1)
    Gt = Et[:, None] * pw
    Gp = Ep[:, None] * pw
    a_list, b_list, n_list, m_list = [], [], [], []
    Pn1 = legendrerow(1, theta)
    for n in range(1, nmax + 1):
        m = np.arange(-n, n + 1)
        Pn = Pn1
        Pn1 = legendrerow(n + 1, theta)
        Yt, Yp = _ytheta_yphi_phi0(n, m, Pn, Pn1)  # (nrays, 2n+1), real / imaginary
        cols = slice(M - n, M + n + 1)  # view, no copy
        Gtn, Gpn = Gt[:, cols], Gp[:, cols]
        projC = np.einsum("ij,ij->j", Gtn, np.conj(Yp)) - np.einsum("ij,ij->j", Gpn, Yt)
        projB = np.einsum("ij,ij->j", Gtn, Yt) + np.einsum("ij,ij->j", Gpn, np.conj(Yp))
        s = math.sqrt(n * (n + 1))
        a_list.append(projC / (1j ** (n + 1) * s))
        b_list.append(projB / (1j**n * s))
        n_list.append(np.full(m.size, n))
        m_list.append(m)
    return make_beam_vector(np.concatenate(a_list), np.concatenate(b_list),
                            np.concatenate(n_list), np.concatenate(m_list), nmax)


def project_farfield(theta, phi, Etheta, Ephi, wg, nmax: int):
    """Beam shape coefficients from a far field by quadrature projection.

    OTT's point matching (BscPointmatch.bsc_farfield) solves
    E = sum_nm [a_nm i^(n+1) C_nm + b_nm i^n B_nm] / sqrt(n(n+1)) in least
    squares; with C = (Yphi, -Ytheta), B = (Ytheta, Yphi) orthogonal on the
    sphere (|C|^2 = |B|^2 = n(n+1) integrated), the coefficients follow by
    projection, here with Gauss-Legendre (theta) x FFT (phi) quadrature.
    """
    nphi = phi.size
    # phi-Fourier components: F_m(theta) = (1/nphi) sum_phi F e^{-i m phi}
    Ft = np.fft.fft(Etheta, axis=1) * (2 * np.pi / nphi)
    Fp = np.fft.fft(Ephi, axis=1) * (2 * np.pi / nphi)
    a_list, b_list, n_list, m_list = [], [], [], []
    for n in range(1, nmax + 1):
        m = np.arange(-n, n + 1)
        _, Yt, Yp = spharm(n, m, theta, np.zeros_like(theta))  # (ntheta, 2n+1), phi = 0
        Ftm = Ft[:, m % nphi]
        Fpm = Fp[:, m % nphi]
        # integral of E . conj(C) and E . conj(B); Y(theta, phi) = Y(theta, 0) e^{i m phi}
        projC = np.sum(wg[:, None] * (Ftm * np.conj(Yp) - Fpm * np.conj(Yt)), axis=0)
        projB = np.sum(wg[:, None] * (Ftm * np.conj(Yt) + Fpm * np.conj(Yp)), axis=0)
        s = math.sqrt(n * (n + 1))
        a_list.append(projC / (1j ** (n + 1) * s))
        b_list.append(projB / (1j**n * s))
        n_list.append(np.full(m.size, n))
        m_list.append(m)
    a = np.concatenate(a_list)
    b = np.concatenate(b_list)
    return make_beam_vector(a, b, np.concatenate(n_list), np.concatenate(m_list), nmax)


@dataclass
class LensResult:
    beam: Bsc  # coefficients about the best focus P*, for 1 W transmitted (power <= 1 if truncated)
    focus_mm: np.ndarray  # best focus in the lab frame (mm), origin at the S1 vertex of the untilted lens
    rms_waves: float  # rms wavefront error about P* (waves)
    transmitted: float
    n_glass: float
    W: np.ndarray = field(repr=False)  # residual wavefront error map (mm) on the input grid
    x: np.ndarray = field(repr=False)
    y: np.ndarray = field(repr=False)
    centroid_dir: np.ndarray = field(repr=False, default=None)


def focused_beam(lens: Lens, wavelength_um: float, beam_diameter_mm: float, tilt_x_deg=0.0, tilt_y_deg=0.0,
                 decenter_mm=(0.0, 0.0), pivot="centre", polarisation=(1, 0), nmax: int = 30,
                 n_rays: int = 81) -> LensResult:
    """Focused beam behind the (tilted) lens, as a :class:`Bsc` about P*."""
    tr = trace(lens, wavelength_um, beam_diameter_mm, tilt_x_deg, tilt_y_deg, decenter_mm, pivot, n_rays)
    P, W, rms = best_focus(tr)
    a, b = project_rays(tr, P, wavelength_um, polarisation, nmax)
    # Parseval: sum |a|^2 + |b|^2 equals the far-field power sum E_in^2 dA (checked
    # in tests), so normalise by the transmitted ray power.  A strongly
    # aberrated focus keeps power above Nmax; renormalising the truncated sum
    # would overstate the field near the focus.
    dx = tr.x[0, 1] - tr.x[0, 0]
    p_rays = float(np.sum(tr.E_in[tr.valid] ** 2) * dx * dx)
    k = 2 * np.pi / (wavelength_um * 1e-6)
    beam = Bsc(a / math.sqrt(p_rays), b / math.sqrt(p_rays), basis="regular", type="incident", k_medium=k)
    wgt = tr.E_in**2 * tr.valid
    cdir = np.sum(tr.U * wgt[..., None], axis=(0, 1))
    cdir = cdir / np.linalg.norm(cdir)
    return LensResult(beam, P, rms / (wavelength_um * 1e-3), tr.transmitted, tr.n_glass,
                      W, tr.x, tr.y, cdir)


