"""Radiation pattern: scattered far field, collection efficiency, position information.

Far field of VSWF coefficients
------------------------------
In OTT's convention an outgoing field with coefficients ``c = (a, b)`` in
the ``h_n^(1)/2`` basis (``vswf.em_field``, basis ``'outgoing'``) carries the
power ``sum |a|^2 + |b|^2``.  For kr -> inf, ``h_n^(1)(kr) -> (-i)^(n+1)
e^{ikr}/kr`` and ``h_{n-1} - n h_n / kr -> (-i)^n e^{ikr}/kr``, so the
transverse far-field amplitude

    F_theta = sum N_n [ (-i)^(n+1) Y_phi a_nm + (-i)^n Y_theta b_nm ]
    F_phi   = sum N_n [ -(-i)^(n+1) Y_theta a_nm + (-i)^n Y_phi b_nm ],
    N_n = 1/sqrt(n(n+1)),

(``Y_theta``, ``Y_phi`` as in :func:`levtrap.special.spharm`) satisfies
``integral |F|^2 dOmega = sum |a|^2 + |b|^2`` by orthonormality of the
vector spherical harmonics.  With beams scaled to watts (as in
:func:`levtrap.api.build_beam`), ``|F|^2`` is the radiated power per solid
angle, dP/dOmega in W/sr.  Which coefficients go in:

* scattered light: ``2p, 2q`` (OTT's "scattered" coefficients p, q are half
  the outgoing amplitude; see :func:`levtrap.derived.power_balance`);
* total light leaving the focus (incident + scattered, what a forward
  detector sees): ``a + 2p, b + 2q`` (the outgoing half of the regular
  incident beam plus the scattered wave; the incoming half of the incident
  beam does not reach a detector at large r on the far side).

Position information
--------------------
Moving the particle by ``delta`` changes the scattered far field (the
incident field does not depend on the particle).  The information pattern
for axis ``j`` is ``|dF/d r_j|^2`` [W/(sr m^2)], the angular density of the
Fisher information carried by the scattered light per unit power: a detector
collecting a solid-angle region with ideal (shot-noise-limited, optimally
phased) detection reaches the fraction ``eta_j`` of the total information,
the per-axis detection-efficiency bound (Tebbenjohanns, Frimmer & Novotny,
Phys. Rev. A 100, 043821 (2019)).  ``dF/dr_j`` is a central difference: the
particle is scattered at ``+-h e_j`` (``Bsc.scatter(position=...)``), and its
outgoing coefficients are re-expanded about the reference point with the
same translation (singular-to-singular translation uses the regular
coefficients), so the derivative is taken in the engine's own position frame.

Frame
-----
Directions (theta, phi) are those of :meth:`levtrap.bsc.Bsc.em_field_xyz`:
theta from +z (the beam axis), phi from +x.  Note that the position frame of
``Bsc.translate_xyz`` (and hence of ``forcetorque(position=...)``) is that
frame rotated by pi about z (a particle "at" (x, y, z) in the force frame
sits at (-x, -y, z) in the field frame).  The information patterns are
quadratic in dF/dr_j and do not depend on this sign; patterns of setups
symmetric under that rotation (all beams along z, focus on axis) are
unaffected.
"""

from __future__ import annotations

import math

import numpy as np

from .bsc import Bsc
from .special import spharm

__all__ = [
    "far_field", "scattered_far_field", "total_far_field", "angular_distribution",
    "sphere_grid", "cone_grid", "integrate", "collection_efficiency", "direction_moments",
    "information_coefficients", "pattern_block", "DIRECTIONS",
]

DIRECTIONS = {"forward": (0.0, 0.0, 1.0), "backward": (0.0, 0.0, -1.0),
              "side_x": (1.0, 0.0, 0.0), "side_y": (0.0, 1.0, 0.0)}
_AXES = {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}


# ---------------------------------------------------------------------------
# far field
# ---------------------------------------------------------------------------


def far_field(a, b, theta, phi):
    """Far-field amplitude (F_theta, F_phi) of outgoing coefficients.

    ``a``, ``b`` have shape ``(Ntot,)`` or ``(Ntot, ncol)`` in the OTT
    ``h/2`` outgoing basis; returns two arrays of shape ``(npts,)`` or
    ``(npts, ncol)`` with ``integral |F|^2 dOmega = sum |a|^2 + |b|^2``.
    """
    a = np.asarray(a, dtype=complex)
    b = np.asarray(b, dtype=complex)
    squeeze = a.ndim == 1
    if squeeze:
        a, b = a[:, None], b[:, None]
    theta = np.atleast_1d(np.asarray(theta, dtype=float)).ravel()
    phi = np.atleast_1d(np.asarray(phi, dtype=float)).ravel()
    nmax = math.isqrt(a.shape[0] + 1) - 1
    Ft = np.zeros((theta.size, a.shape[1]), dtype=complex)
    Fp = np.zeros_like(Ft)
    for n in range(1, nmax + 1):
        sl = slice(n * n - 1, n * n + 2 * n)
        an, bn = a[sl], b[sl]
        if not (np.any(an) or np.any(bn)):
            continue
        _, Yt, Yp = spharm(n, np.arange(-n, n + 1), theta, phi)
        Nn = 1 / math.sqrt(n * (n + 1))
        ca, cb = Nn * (-1j) ** (n + 1), Nn * (-1j) ** n
        Ft += ca * (Yp @ an) + cb * (Yt @ bn)
        Fp += -ca * (Yt @ an) + cb * (Yp @ bn)
    if squeeze:
        return Ft[:, 0], Fp[:, 0]
    return Ft, Fp


def _outgoing_scattered(sbeam: Bsc) -> tuple[np.ndarray, np.ndarray]:
    if sbeam.type != "scattered":
        raise ValueError(f"expected a scattered beam, got type {sbeam.type!r}")
    if sbeam.Nbeams != 1:
        raise ValueError("expected a single beam (merge coherent beams first)")
    return 2 * sbeam.a[:, 0], 2 * sbeam.b[:, 0]


def scattered_far_field(sbeam: Bsc, theta, phi):
    """(F_theta, F_phi) of the scattered light; |F|^2 in beam-power units per sr."""
    return far_field(*_outgoing_scattered(sbeam), theta, phi)


def total_far_field(ibeam: Bsc, sbeam: Bsc, theta, phi):
    """(F_theta, F_phi) of incident + scattered light leaving the focus.

    ``ibeam`` must be expanded about the same point as ``sbeam`` (the
    incident beam returned by ``Bsc.scatter``).
    """
    n = max(ibeam.Nmax, sbeam.Nmax)
    i, s = ibeam.set_Nmax(n), sbeam.set_Nmax(n)
    a, b = _outgoing_scattered(s)
    return far_field(i.a[:, 0] + a, i.b[:, 0] + b, theta, phi)


def _intensity(Ft, Fp):
    return np.abs(Ft) ** 2 + np.abs(Fp) ** 2


def angular_distribution(sbeam: Bsc, theta, phi) -> np.ndarray:
    """dP_sca/dOmega of a scattered beam at directions (theta, phi).

    In the units of the beam power per steradian (W/sr for a beam scaled
    to watts).  This is the function to use for direction-resolved recoil.
    """
    Ft, Fp = scattered_far_field(sbeam, theta, phi)
    return _intensity(Ft, Fp)


# ---------------------------------------------------------------------------
# quadrature
# ---------------------------------------------------------------------------


def _min_nodes(nmax: int) -> tuple[int, int]:
    # |F|^2 is band limited to degree 2 Nmax (+2 from the vector harmonics):
    # Gauss-Legendre in cos(theta) with Nmax + 3 nodes and a uniform phi grid
    # with more than 2 Nmax + 2 points integrate it exactly.
    return nmax + 3, 2 * nmax + 4


def sphere_grid(ntheta: int, nphi: int):
    """Full-sphere grid: Gauss-Legendre nodes in cos(theta), uniform phi.

    Returns flat ``theta, phi, weight`` (``ntheta * nphi`` points, theta
    varying slowest, theta ascending); ``sum(weight) = 4 pi``.
    """
    x, w = np.polynomial.legendre.leggauss(int(ntheta))
    th = np.arccos(x[::-1])
    wt = w[::-1]
    ph = np.arange(int(nphi)) * 2 * np.pi / int(nphi)
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    W = wt[:, None] * np.full(int(nphi), 2 * np.pi / int(nphi))[None, :]
    return TH.ravel(), PH.ravel(), W.ravel()


def _frame(direction):
    d = np.asarray(direction, dtype=float)
    d = d / np.linalg.norm(d)
    helper = np.array([1.0, 0.0, 0.0]) if abs(d[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    e1 = np.cross(helper, d)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(d, e1)
    return e1, e2, d


def cone_grid(direction, half_angles, ntheta: int, nphi: int):
    """Quadrature over nested cones about ``direction``.

    ``half_angles`` ascending [rad].  Each annulus between successive half
    angles gets ``ntheta`` Gauss-Legendre nodes in cos(theta') and ``nphi``
    uniform azimuths.  Returns ``theta, phi, weight, ring`` (flat), where
    ``ring[i]`` is the index of the annulus of point i; the integral over the
    cone ``half_angles[k]`` is the weighted sum over ``ring <= k``.
    """
    half_angles = np.atleast_1d(np.asarray(half_angles, dtype=float))
    e1, e2, d = _frame(direction)
    x, w = np.polynomial.legendre.leggauss(int(ntheta))
    ph = np.arange(int(nphi)) * 2 * np.pi / int(nphi)
    edges = np.concatenate([[0.0], half_angles])
    TH, PH, W, RING = [], [], [], []
    for k in range(half_angles.size):
        c_hi, c_lo = math.cos(edges[k]), math.cos(edges[k + 1])
        ct = 0.5 * (c_hi - c_lo) * x + 0.5 * (c_hi + c_lo)
        wt = 0.5 * (c_hi - c_lo) * w
        st = np.sqrt(np.clip(1 - ct**2, 0, None))
        CT, PHl = np.meshgrid(ct, ph, indexing="ij")
        ST = np.meshgrid(st, ph, indexing="ij")[0]
        v = (ST[..., None] * (np.cos(PHl)[..., None] * e1 + np.sin(PHl)[..., None] * e2)
             + CT[..., None] * d)
        v = v.reshape(-1, 3)
        TH.append(np.arccos(np.clip(v[:, 2], -1, 1)))
        PH.append(np.arctan2(v[:, 1], v[:, 0]))
        W.append((wt[:, None] * np.full(ph.size, 2 * np.pi / ph.size)[None, :]).ravel())
        RING.append(np.full(v.shape[0], k))
    return np.concatenate(TH), np.concatenate(PH), np.concatenate(W), np.concatenate(RING)


def integrate(values, weight) -> np.ndarray:
    """Weighted sum over the first axis (quadrature of a grid pattern)."""
    return np.tensordot(np.asarray(weight), np.asarray(values), axes=(0, 0))


def _na_angles(NA, n_medium: float) -> np.ndarray:
    NA = np.atleast_1d(np.asarray(NA, dtype=float))
    if np.any(NA <= 0) or np.any(NA > n_medium * (1 + 1e-12)):
        raise ValueError(f"NA must lie in (0, {n_medium}] (the medium index)")
    return np.arcsin(np.clip(NA / n_medium, 0, 1))


def _cone_fractions(a, b, direction, half_angles, nmax: int) -> np.ndarray:
    """Power of each coefficient column inside each cone: (ncone, ncol)."""
    order = np.argsort(half_angles)
    nt, nph = _min_nodes(nmax)
    th, ph, w, ring = cone_grid(direction, half_angles[order], nt, nph)
    Ft, Fp = far_field(a, b, th, ph)
    I = _intensity(Ft, Fp)  # (npts, ncol)
    per_ring = np.zeros((half_angles.size, I.shape[1]))
    np.add.at(per_ring, ring, w[:, None] * I)
    cum = np.cumsum(per_ring, axis=0)
    out = np.empty_like(cum)
    out[order] = cum
    return out


def collection_efficiency(sbeam: Bsc, NA, direction=(0, 0, 1), n_medium: float = 1.0):
    """Fraction of the scattered power inside the cone(s) of numerical aperture
    ``NA`` (scalar or array) about ``direction`` (lab frame)."""
    a, b = _outgoing_scattered(sbeam)
    ang = _na_angles(NA, n_medium)
    cones = _cone_fractions(a[:, None], b[:, None], direction, ang, sbeam.Nmax)
    out = cones[:, 0] / (4 * sbeam.power)
    return float(out[0]) if np.ndim(NA) == 0 else out


def direction_moments(sbeam: Bsc, nmax_grid: int | None = None) -> dict:
    """Mean and second moment of the scattered photon direction n.

    ``mean`` = <n> and ``second`` = <n n^T> (3x3), both weighted by
    dP_sca/dOmega and normalised by P_sca (so trace(second) = 1).  The
    second moment is the ``scattered_moment`` of direction-resolved recoil
    heating; the mean is needed for its forward/backward cross term.
    """
    nt, nph = _min_nodes(sbeam.Nmax if nmax_grid is None else nmax_grid)
    th, ph, w = sphere_grid(nt + 1, nph + 2)
    I = angular_distribution(sbeam, th, ph) * w
    n = np.stack([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)], axis=1)
    P = I.sum()
    return dict(mean=(n.T @ I) / P, second=(n.T * I) @ n / P, P_sca=float(P))


# ---------------------------------------------------------------------------
# position information
# ---------------------------------------------------------------------------


def information_coefficients(ibeam: Bsc, T, axes=("x", "y", "z"), step: float | None = None):
    """Outgoing coefficients of dE_sca/dr_j for a particle at the origin of ``ibeam``.

    Central difference of the scattered field for the particle at ``+-step``
    along each axis, each re-expanded about the origin.  Returns
    ``(a, b)`` of shape ``(Ntot, len(axes))`` in 1/m times the beam's field
    units, so ``|far_field(a, b)|^2`` is in W/(sr m^2) for a beam in watts.
    """
    T = T.to_type("scattered") if T.type == "total" else T
    k = ibeam.k_medium
    h = (2 * np.pi / k) * 1e-3 if step is None else float(step)
    cols_a, cols_b = [], []
    nmax = None
    for ax in axes:
        e = np.asarray(_AXES[ax] if isinstance(ax, str) else ax, dtype=float)
        e = e / np.linalg.norm(e)
        out = []
        for s in (+1, -1):
            P = s * h * e
            sb, _ = ibeam.scatter(T, position=P)
            nmax = sb.Nmax + 2 if nmax is None else nmax
            c = Bsc(2 * sb.a, 2 * sb.b, basis="regular", type="incident", k_medium=k)
            # outgoing -> outgoing about the origin (|r| > h): regular coefficients
            out.append(c.translate_xyz(-P, Nmax=nmax))
        d = (out[0] - out[1]) / (2 * h)
        cols_a.append(d.a[:, 0])
        cols_b.append(d.b[:, 0])
    return np.stack(cols_a, axis=1), np.stack(cols_b, axis=1)


# ---------------------------------------------------------------------------
# Result block
# ---------------------------------------------------------------------------


def _na_ladder(n_medium: float) -> np.ndarray:
    na = np.round(np.arange(0.05, n_medium - 1e-9, 0.05), 2)
    return np.append(na, n_medium)


def pattern_block(ibeam: Bsc, T, *, n_medium: float, trap_NA: float | None = None,
                  ntheta: int = 36, nphi: int = 72, NA=None) -> dict:
    """The ``pattern`` block of a Result for a particle at the origin of ``ibeam``.

    ``ibeam`` is the incident beam (scaled to watts) expanded about the
    particle; ``T`` the particle's T-matrix.  All grids are flat lists over
    ``grid.theta``/``grid.phi`` with quadrature weights ``grid.weight`` [sr].
    """
    T = T.to_type("scattered") if T.type == "total" else T
    sbeam, ib = ibeam.scatter(T)
    n = max(ib.Nmax, sbeam.Nmax)
    ib, sbeam = ib.set_Nmax(n), sbeam.set_Nmax(n)
    ia, ibb = information_coefficients(ib, T)
    ninfo = math.isqrt(ia.shape[0] + 1) - 1

    def pad(x, N):
        tot = N * N + 2 * N
        return np.vstack([x, np.zeros((tot - x.shape[0], x.shape[1]), dtype=complex)]) if x.shape[0] < tot else x

    N = max(n, ninfo)
    sa, sb_ = pad(2 * sbeam.a, N), pad(2 * sbeam.b, N)
    ta, tb = pad(ib.a, N) + sa, pad(ib.b, N) + sb_
    ia, ibb = pad(ia, N), pad(ibb, N)
    A = np.hstack([sa, ta, ia])  # columns: scattered, total, info x, y, z
    B = np.hstack([sb_, tb, ibb])

    nt, nph = _min_nodes(N)
    th, ph, w = sphere_grid(max(ntheta, nt), max(nphi, nph))
    Ft, Fp = far_field(A, B, th, ph)
    I = _intensity(Ft, Fp)
    tot = integrate(I, w)
    P_sca, info_tot = tot[0], tot[2:]

    NA = _na_ladder(n_medium) if NA is None else np.atleast_1d(np.asarray(NA, dtype=float))
    ang = _na_angles(NA, n_medium)
    keep = [0, 2, 3, 4]
    coll, info_eff = {}, {}
    for name, d in DIRECTIONS.items():
        c = _cone_fractions(A[:, keep], B[:, keep], d, ang, N)
        coll[name] = (c[:, 0] / P_sca).tolist()
        info_eff[name] = {ax: (c[:, 1 + i] / info_tot[i]).tolist() for i, ax in enumerate("xyz")}

    mom_n = np.stack([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)], axis=1)
    Iw = I[:, 0] * w
    out = dict(
        frame="theta from +z (beam axis), phi from +x; directions of Bsc.em_field_xyz",
        grid=dict(theta=th.tolist(), phi=ph.tolist(), weight=w.tolist()),
        scattered=I[:, 0].tolist(),
        total=I[:, 1].tolist(),
        information={ax: I[:, 2 + i].tolist() for i, ax in enumerate("xyz")},
        P_sca=float(P_sca),
        P_total=float(tot[1]),
        information_total={ax: float(info_tot[i]) for i, ax in enumerate("xyz")},
        NA=NA.tolist(),
        directions={k: list(v) for k, v in DIRECTIONS.items()},
        collection=coll,
        information_efficiency=info_eff,
        moments=dict(mean=(mom_n.T @ Iw / P_sca).tolist(),
                     second=((mom_n.T * Iw) @ mom_n / P_sca).tolist()),
        units=dict(scattered="W/sr", total="W/sr", information="W/(sr m^2)",
                   information_total="W/m^2", collection="fraction of P_sca",
                   information_efficiency="fraction of the 4 pi information"),
    )
    if trap_NA is not None and 0 < trap_NA <= n_medium:
        tang = _na_angles(trap_NA, n_medium)
        at = {}
        for name in ("forward", "backward"):
            c = _cone_fractions(A[:, keep], B[:, keep], DIRECTIONS[name], tang, N)[0]
            at[name] = dict(collection=float(c[0] / P_sca),
                            information={ax: float(c[1 + i] / info_tot[i]) for i, ax in enumerate("xyz")})
        out["trap_NA"] = float(trap_NA)
        out["at_trap_NA"] = at
    return out
