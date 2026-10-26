"""Optical force, torque and spin transfer.

Port of OTT v1 ``ott.forcetorque`` (Farsund & Felderhof / Crichton &
Marston closed-form expressions in VSWF coefficients).

Units: the returned force is dimensionless, in units of
``n_medium * P / c`` where ``P`` is the beam power ``sum(|a|^2+|b|^2)``.
For a beam normalised to power 1, the SI force is

    F [N] = Q * n_medium * P_beam [W] / c.

Torque and spin are in units of ``P / omega``.
"""

from __future__ import annotations

import numpy as np

from .bsc import Bsc

__all__ = ["forcetorque", "forcetorque_beams"]


def forcetorque_beams(ibeam: Bsc, sbeam: Bsc):
    """Force, torque and spin from incident and scattered beams.

    Port of the two-beam branch of ``ott.forcetorque``.

    Returns
    -------
    f, t, s : ndarray, shape (3, nbeams)
    """
    if ibeam.Nbeams != sbeam.Nbeams and ibeam.Nbeams != 1 and sbeam.Nbeams != 1:
        raise ValueError("Beam objects must contain same number of beams or 1 beam")
    nmax = max(ibeam.Nmax, sbeam.Nmax)
    ibeam = ibeam.set_Nmax(nmax)
    sbeam = sbeam.set_Nmax(nmax)
    sbeam = sbeam.total_field(ibeam)
    a, b = ibeam.a, ibeam.b
    p, q = sbeam.a, sbeam.b
    nb = max(a.shape[1], p.shape[1])
    a = np.broadcast_to(a, (a.shape[0], nb))
    b = np.broadcast_to(b, (b.shape[0], nb))
    p = np.broadcast_to(p, (p.shape[0], nb))
    q = np.broadcast_to(q, (q.shape[0], nb))
    n, m = ibeam.get_mode_indices()
    n = n[:, None].astype(float)
    m = m[:, None].astype(float)
    b = 1j * b
    q = 1j * q
    pad = np.zeros((2 * nmax + 3, nb), dtype=complex)
    at, bt, pt, qt = (np.vstack([x, pad]) for x in (a, b, p, q))
    ci = np.arange(a.shape[0])  # 0-based combined index
    nn = n[:, 0].astype(int)
    np1 = 2 * nn + 2
    cinp1 = ci + np1
    cinp1mp1 = ci + np1 + 1
    cinp1mm1 = ci + np1 - 1
    cimp1 = ci + 1
    kimp = m[:, 0] > n[:, 0] - 1

    def g(x, idx):
        return x[idx]

    anp1, bnp1, pnp1, qnp1 = (g(x, cinp1) for x in (at, bt, pt, qt))
    anp1mp1, bnp1mp1, pnp1mp1, qnp1mp1 = (g(x, cinp1mp1) for x in (at, bt, pt, qt))
    anp1mm1, bnp1mm1, pnp1mm1, qnp1mm1 = (g(x, cinp1mm1) for x in (at, bt, pt, qt))
    amp1, bmp1, pmp1, qmp1 = (g(x, cimp1).copy() for x in (at, bt, pt, qt))
    for x in (amp1, bmp1, pmp1, qmp1):
        x[kimp] = 0
    cj = np.conj
    Az = m / n / (n + 1) * np.imag(-a * cj(b) + cj(q) * p)
    Bz = (1 / (n + 1) * np.sqrt(n * (n - m + 1) * (n + m + 1) * (n + 2) / (2 * n + 3) / (2 * n + 1))
          * np.imag(anp1 * cj(a) + bnp1 * cj(b) - pnp1 * cj(p) - qnp1 * cj(q)))
    fz = 2 * np.sum(Az + Bz, axis=0)
    Axy = (1j / n / (n + 1) * np.sqrt((n - m) * (n + m + 1))
           * (cj(pmp1) * q - cj(amp1) * b - cj(qmp1) * p + cj(bmp1) * a))
    Bxy = (1j / (n + 1) * np.sqrt(n * (n + 2)) / np.sqrt((2 * n + 1) * (2 * n + 3))
           * (np.sqrt((n + m + 1) * (n + m + 2))
              * (p * cj(pnp1mp1) + q * cj(qnp1mp1) - a * cj(anp1mp1) - b * cj(bnp1mp1))
              + np.sqrt((n - m + 1) * (n - m + 2))
              * (pnp1mm1 * cj(p) + qnp1mm1 * cj(q) - anp1mm1 * cj(a) - bnp1mm1 * cj(b))))
    fxy = np.sum(Axy + Bxy, axis=0)
    f = np.vstack([fxy.real, fxy.imag, fz])

    tz = np.sum(m * (a * cj(a) + b * cj(b) - p * cj(p) - q * cj(q)), axis=0)
    txy = np.sum(np.sqrt((n - m) * (n + m + 1)) * (a * cj(amp1) + b * cj(bmp1) - p * cj(pmp1) - q * cj(qmp1)),
                 axis=0)
    t = np.vstack([txy.real, txy.imag, tz.real])

    Cz = m / n / (n + 1) * (-a * cj(a) + cj(q) * q - b * cj(b) + cj(p) * p)
    Dz = (-2 / (n + 1) * np.sqrt(n * (n - m + 1) * (n + m + 1) * (n + 2) / (2 * n + 3) / (2 * n + 1))
          * np.real(anp1 * cj(b) - bnp1 * cj(a) - pnp1 * cj(q) + qnp1 * cj(p)))
    sz = np.sum(Cz + Dz, axis=0)
    Cxy = (1j / n / (n + 1) * np.sqrt((n - m) * (n + m + 1))
           * (cj(pmp1) * p - cj(amp1) * a + cj(qmp1) * q - cj(bmp1) * b))
    Dxy = (1j / (n + 1) * np.sqrt(n * (n + 2)) / np.sqrt((2 * n + 1) * (2 * n + 3))
           * (np.sqrt((n + m + 1) * (n + m + 2))
              * (p * cj(qnp1mp1) - q * cj(pnp1mp1) - a * cj(bnp1mp1) + b * cj(anp1mp1))
              + np.sqrt((n - m + 1) * (n - m + 2))
              * (pnp1mm1 * cj(q) - qnp1mm1 * cj(p) - anp1mm1 * cj(b) + bnp1mm1 * cj(a))))
    sxy = np.sum(Cxy + Dxy, axis=0)
    s = np.vstack([sxy.imag, sxy.real, sz.real])
    return f, t, s


def forcetorque(ibeam: Bsc, T, position=None, rotation=None, coherent: bool = False,
                progress=None):
    """Force/torque/spin on particle(s) with T-matrix ``T`` in beam ``ibeam``.

    Port of ``ott.forcetorque(beam, T, 'position', ..., 'rotation', ...)``.

    Parameters
    ----------
    ibeam : Bsc
        Incident beam (one or several beams).
    T : Tmatrix or list of Tmatrix
    position : array (3,) or (3, N), optional
        Particle position(s) [m].
    rotation : array (3, 3) or (3, 3N), optional
        Particle rotation(s).
    coherent : bool
        Sum the beams coherently (``mergeBeams``) before computing forces.
    progress : callable, optional
        Called with the fraction done.

    Returns
    -------
    f, t, s : ndarray of shape (3*nparticles, nlocations, nbeams), squeezed
        like MATLAB's ``squeeze`` (singleton dims dropped).
    """
    tms = list(T) if isinstance(T, (list, tuple)) else [T]
    tms = [t.to_type("scattered") if t.type == "total" else t for t in tms]
    pos = None if position is None else np.asarray(position, dtype=float)
    if pos is not None and pos.ndim == 1:
        pos = pos[:, None]
    rot = None if rotation is None else np.asarray(rotation, dtype=float)
    npos = 1 if pos is None else pos.shape[1]
    nrot = 1 if rot is None else rot.shape[1] // 3
    if npos != 1 and nrot != 1 and npos != nrot:
        raise ValueError("Number of positions/rotations should be equal or 1")
    nloc = max(npos, nrot)
    nbeams = 1 if coherent else ibeam.Nbeams
    npart = len(tms)
    f = np.zeros((3 * npart, nloc, nbeams))
    t = np.zeros_like(f)
    s = np.zeros_like(f)
    for ii in range(nloc):
        if progress is not None:
            progress(ii / nloc)
        P = None if pos is None else (pos[:, 0] if npos == 1 else pos[:, ii])
        R = None if rot is None else (rot[:, :3] if nrot == 1 else rot[:, 3 * ii:3 * ii + 3])
        sbeam, tbeam = ibeam.scatter(tms if npart > 1 else tms[0], position=P, rotation=R)
        if coherent:
            sbeam = _merge_per_particle(sbeam, npart)
            tbeam = tbeam.merge_beams()
        fl, tl, sl = forcetorque_beams(tbeam, sbeam)
        # sbeam columns: [particle1 beams..., particle2 beams...]
        f[:, ii, :] = _per_particle(fl, npart, nbeams)
        t[:, ii, :] = _per_particle(tl, npart, nbeams)
        s[:, ii, :] = _per_particle(sl, npart, nbeams)
    return _squeeze(f), _squeeze(t), _squeeze(s)


def _merge_per_particle(sbeam: Bsc, npart: int) -> Bsc:
    if npart == 1:
        return sbeam.merge_beams()
    k = sbeam.Nbeams // npart
    out = None
    for i in range(npart):
        part = sbeam.beam(np.arange(i * k, (i + 1) * k)).merge_beams()
        out = part if out is None else out.append(part)
    return out


def _per_particle(x: np.ndarray, npart: int, nbeams: int) -> np.ndarray:
    # x: (3, npart*nbeams) with columns ordered particle-major
    return x.reshape(3, npart, nbeams).transpose(1, 0, 2).reshape(3 * npart, nbeams)


def _squeeze(x: np.ndarray) -> np.ndarray:
    return np.squeeze(x)
