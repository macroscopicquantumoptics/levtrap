"""Equilibria, stiffness and trap analysis.

Ports of OTT v1 ``ott.axial_equilibrium``, ``ott.find_equilibrium``,
``ott.find_traps`` and ``ott.trap_stiffness``, plus :func:`trap_depth`
(potential-energy depth from a force curve, not in OTT).

Units follow the inputs: positions in metres and forces in units of
``n P / c`` (as returned by :func:`levtrap.force.forcetorque`) give
stiffness in ``(n P / c) / m``.
"""

from __future__ import annotations

import warnings

import numpy as np

from .bsc import Bsc
from .force import forcetorque, forcetorque_beams
from .special import rotation_matrix

__all__ = ["axial_equilibrium", "find_equilibrium", "find_traps", "trap_stiffness",
           "trap_depth", "NoStableTrap"]


class NoStableTrap(RuntimeError):
    """Raised when no stable equilibrium is found."""


def _polyfit(x, y, deg):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return np.polyfit(x, y, deg)


def _real_roots(p):
    r = np.roots(p)
    return np.real(r[np.imag(r) == 0])


def axial_equilibrium(tmatrix, beam: Bsc, z: float = 0.0):
    """Axial (z) equilibrium position and stiffness.

    Port of ``ott.axial_equilibrium``.  The beam is normalised to power 1.

    Returns
    -------
    z_eq : float
        Equilibrium position (units of ``1/k_medium``, i.e. metres).
    kz : float
        Stiffness dQ_z/dz (units of ``n P / c`` per metre).

    Raises
    ------
    NoStableTrap
    """
    z0 = z
    n1, n2 = tmatrix.Nmax
    N = [max(n1, beam.Nmax), max(n2, beam.Nmax)]
    tmatrix = tmatrix.set_Nmax(N)
    beam = beam.set_Nmax(N[0]).with_power(1.0)
    k = beam.k_medium
    zd = 0.25 / (k / 2 / np.pi)
    zs0 = np.linspace(z0 - zd / 2, z0 + zd / 2, 6)  # OTT: z-zd/2:dz:z+zd/2
    zs = zs0.copy()
    fz = np.zeros_like(zs)
    jj = 0
    while True:
        jj += 1
        for ii in range(zs.size):
            if fz[ii] == 0:
                tbeam = beam.translate_z(zs[ii])
                sbeam, _ = tbeam.scatter(tmatrix)
                fz[ii] = forcetorque_beams(tbeam, sbeam)[0][2, 0]
        dzf = np.diff(fz) / np.diff(zs)
        neg = np.nonzero(fz <= 0)[0]
        dneg = np.nonzero(dzf <= 0)[0]
        if neg.size:
            indf = neg[0]
            if indf == 0:
                zs = np.concatenate([zs0[:-1] - zd * jj, zs])
                fz = np.concatenate([np.zeros(zs0.size - 1), fz])
            elif indf == fz.size - 1:
                zs = np.concatenate([zs, zs0[1:] + zd * jj])
                fz = np.concatenate([fz, np.zeros(zs0.size - 1)])
            else:
                break
        else:
            if dneg.size:
                zs = np.concatenate([zs, zs0[1:] + zd * jj])
                fz = np.concatenate([fz, np.zeros(zs0.size - 1)])
            else:
                zs = np.concatenate([zs0[:-1] - zd * jj, zs, zs0[1:] + zd * jj])
                fz = np.concatenate([np.zeros(zs0.size - 1), fz, np.zeros(zs0.size - 1)])
        if jj > 5:
            raise NoStableTrap("No stable equilibrium near z!")
    lo = max(0, indf - 3)
    hi = min(zs.size, indf + 4)
    zsc = zs[lo:hi]
    zsc_mid = zsc.mean()
    zsc = (zsc - zsc_mid) * k
    # OTT: polyfit(zsc - zsc_mid, ...) subtracts zsc_mid a second time
    # (axial_equilibrium.m); kept for numerical faithfulness (~1e-14 m).
    pl = _polyfit(zsc - zsc_mid, fz[lo:hi], 3)
    rts = _real_roots(pl)
    dzf = np.polyval([3 * pl[0], 2 * pl[1], pl[2]], rts)
    rts = rts / k + zsc_mid
    dzf = dzf * k
    stable = np.nonzero(dzf < 0)[0]
    if stable.size == 0:
        raise NoStableTrap("No stable equilibrium near z!")
    i = stable[np.argmin(np.abs(rts[stable] - z0))]
    return float(rts[i]), float(dzf[i])


def find_equilibrium(z, fz):
    """Stable equilibrium from a force curve (port of ``ott.find_equilibrium``).

    Returns an array (possibly empty) of equilibrium positions.
    """
    z = np.asarray(z, dtype=float).ravel()
    fz = np.asarray(fz, dtype=float).ravel()
    if z.size != fz.size:
        raise ValueError("Number of elements in z and fz must be equal")
    neg = np.nonzero(fz < 0)[0]
    zi = neg[0] if neg.size else None
    if zi == 0:
        # OTT: ignore fz<0 entries at the start (find_equilibrium.m)
        pos = np.nonzero(fz > 0)[0]
        if pos.size == 0:
            return np.array([])
        nz = np.nonzero(fz[pos[0]:])[0]
        zi = nz[0] + pos[0]
    zmin, zmax = z.min(), z.max()
    zn = 2 * (z - zmin) / (zmax - zmin) - 1
    if zi is None:
        return np.array([])
    rng = np.arange(max(zi - 2, 0), min(zi + 3, z.size))
    pz = _polyfit(zn[rng], fz[rng], 3)
    real_z = _real_roots(pz)
    dpz = [3 * pz[0], 2 * pz[1], pz[2]]
    zeq = real_z[np.polyval(dpz, real_z) < 0]
    if zeq.size == 0:
        return np.array([])
    d = np.abs(zeq - zn[zi])
    eq = zeq[d == d.min()]
    return (eq + 1) / 2 * (zmax - zmin) + zmin


def find_traps(position, force, keep_unstable: bool = False, depth_threshold_e: float | None = 1e-2,
               force_zero_tol_e: float | None = 1e-3, group_stable: bool = False):
    """Identify traps in a 1-D force curve (port of ``ott.find_traps``).

    Returns a list of dicts with keys ``position``, ``stiffness``,
    ``depth`` (a force: the smaller of the two restoring-force extrema),
    ``range``, ``minmax_force``, ``minmax_position`` (and ``group_*``
    when ``group_stable``).
    """
    position = np.asarray(position, dtype=float).ravel()
    force = np.asarray(force, dtype=float).ravel().copy()
    if force_zero_tol_e is not None:
        force[np.abs(force) < np.max(np.abs(force)) * force_zero_tol_e] = 0

    def first(mask, start=0):
        idx = np.nonzero(mask[start:])[0]
        return None if idx.size == 0 else int(idx[0] + start)

    if force[0] > 0:
        last = first(force < 0)
    elif force[0] == 0:
        last = first(force != 0)
    else:
        last = first(force > 0)
    eqs = []
    while last is not None:
        eqs.append(last)
        if force[last] > 0:
            last = first(force < 0, last)
        else:
            last = first(force > 0, last)

    peqs = np.zeros(len(eqs))
    pstiff = np.zeros(len(eqs))
    for ii, e in enumerate(eqs):
        sgn = np.sign(force[e])
        prev = np.nonzero(force[:e] * sgn < 0)[0]
        f0 = int(prev[-1]) if prev.size else 0
        eqguess = (position[e] + position[f0]) / 2
        rng = np.arange(max(f0 - 1, 0), min(e + 2, position.size))
        zz = position[rng]
        zmin, zmax = zz.min(), zz.max()
        zz = 2 * (zz - zmin) / (zmax - zmin) - 1
        zzero = 2 * (eqguess - zmin) / (zmax - zmin) - 1
        if zz.size < 4:
            pz = _polyfit(zz, force[rng], 2)
            dpz = [2 * pz[0], pz[1]]
        else:
            pz = _polyfit(zz, force[rng], 3)
            dpz = [3 * pz[0], 2 * pz[1], pz[2]]
        real_z = _real_roots(pz)
        if real_z.size == 0:
            raise RuntimeError("No real roots")
        d = np.abs(real_z - zzero)
        rz = real_z[d == d.min()][0]
        peqs[ii] = (rz + 1) / 2 * (zmax - zmin) + zmin
        pstiff[ii] = np.polyval(dpz, rz) * 2 / (zmax - zmin)

    traps = []
    for ii, e in enumerate(eqs):
        f_lo = 0 if ii == 0 else eqs[ii - 1]
        f_hi = force.size - 1 if ii == len(eqs) - 1 else eqs[ii + 1] - 1
        seg = force[f_lo:f_hi + 1]
        fnidx = int(np.argmin(seg))
        fxidx = int(np.argmax(seg))
        fn, fx = seg[fnidx], seg[fxidx]
        if not keep_unstable and fxidx >= fnidx:
            continue
        tr = dict(position=peqs[ii], stiffness=pstiff[ii],
                  range=[-np.inf if ii == 0 else peqs[ii - 1],
                         np.inf if ii == len(eqs) - 1 else peqs[ii + 1]],
                  minmax_force=[fx, fn],
                  minmax_position=[position[f_lo + fxidx], position[f_lo + fnidx]])
        if fnidx < fxidx:
            tr["minmax_force"] = tr["minmax_force"][::-1]
            tr["minmax_position"] = tr["minmax_position"][::-1]
        tr["depth"] = min(abs(tr["minmax_force"][0]), abs(tr["minmax_force"][1]))
        traps.append(tr)

    if group_stable and traps:
        if keep_unstable:
            raise ValueError("group_stable option incompatible with keep_unstable")
        idxer, maxforce = 0, 0.0
        gmax = np.zeros(len(traps), dtype=int)
        for ii, tr in enumerate(traps):
            if tr["minmax_force"][0] > maxforce:
                maxforce = tr["minmax_force"][0]
                idxer += 1
            gmax[ii] = idxer
        idxer, minforce = 0, 0.0
        gmin = np.zeros(len(traps), dtype=int)
        for ii in range(len(traps) - 1, -1, -1):
            if traps[ii]["minmax_force"][1] < minforce:
                minforce = traps[ii]["minmax_force"][1]
                idxer += 1
            gmin[ii] = idxer
        gidx = gmax + (gmin.max() - gmin)
        old = traps
        traps = []
        for g in np.unique(gidx):
            sel = [t for t, gi in zip(old, gidx) if gi == g]
            rngs = np.array([t["range"] for t in sel])
            mmf = np.array([t["minmax_force"] for t in sel])
            mmp = np.array([t["minmax_position"] for t in sel])
            tr = dict(position=np.array([t["position"] for t in sel]),
                      stiffness=np.array([t["stiffness"] for t in sel]),
                      depth=np.array([t["depth"] for t in sel]),
                      range=rngs, minmax_force=mmf, minmax_position=mmp,
                      group_range=[rngs.min(), rngs.max()],
                      group_minmax_position=[mmp.ravel(order="F")[0], mmp.ravel(order="F")[-1]],
                      group_minmax_force=[mmf.ravel(order="F")[0], mmf.ravel(order="F")[-1]])
            tr["group_depth"] = min(abs(tr["group_minmax_force"][0]), abs(tr["group_minmax_force"][1]))
            traps.append(tr)

    if depth_threshold_e is not None:
        max_depth = np.max(np.abs(force))
        key = "group_depth" if (group_stable and traps) else "depth"
        traps = [t for t in traps if not (t[key] < depth_threshold_e * max_depth)]
    return traps


def trap_stiffness(beam: Bsc, T, position=(0, 0, 0), rotation=None, step=None):
    """Translational and rotational stiffness by central differences.

    Port of ``ott.trap_stiffness`` (method 'cntr', direction 'beam').

    Returns ``(kf, kt)``: force stiffness along x, y, z [(nP/c)/m] and
    torque stiffness about x, y, z.
    """
    position = np.asarray(position, dtype=float).reshape(3, 1)
    R0 = np.eye(3) if rotation is None else np.asarray(rotation, dtype=float)
    if rotation is not None:
        beam, _ = beam.rotate(R0)
    D = R0.T @ np.eye(3)
    dx, dt = step if step is not None else (1e-3 / beam.k_medium, 1e-3)
    x = np.hstack([D * -dx, D * dx]) + position
    ff, tt, _ = forcetorque(beam, T, position=x)
    K1f = (ff[:, 3:] - ff[:, :3]) / 2 / dx
    Rs = [rotation_matrix(D[:, i], dt) for i in range(3)]
    Rs = Rs + [r.T for r in Rs]
    ff, tt, _ = forcetorque(beam, T, rotation=np.hstack(Rs), position=position[:, 0])
    K2t = (tt[:, 3:] - tt[:, :3]) / 2 / dt
    kf = np.sum(K1f * D, axis=0)
    kt = np.sum(K2t * D, axis=0)
    return kf, kt


def trap_depth(position, force, x_eq: float):
    """Potential-well depth from a 1-D force curve.

    U(x) = -integral F dx (trapezoidal), referenced to U(x_eq).  The depth
    is the smaller of the two barrier heights, max U on each side of
    ``x_eq``.  If the force has not turned non-restoring by the edge of
    the scan on a side, that side's barrier is the value at the edge (a
    lower bound) and ``bounded`` is False.

    Returns ``(depth, bounded)`` in units of force x position.
    """
    x = np.asarray(position, dtype=float).ravel()
    f = np.asarray(force, dtype=float).ravel()
    U = -np.concatenate([[0.0], np.cumsum(0.5 * (f[1:] + f[:-1]) * np.diff(x))])
    U0 = np.interp(x_eq, x, U)
    left = x < x_eq
    right = x > x_eq
    if not left.any() or not right.any():
        return 0.0, False
    bl = U[left].max() - U0
    br = U[right].max() - U0
    il = np.argmax(U[left])
    ir = np.argmax(U[right])
    bounded_l = il != 0
    bounded_r = ir != right.sum() - 1
    if bl <= br:
        return float(max(bl, 0.0)), bool(bounded_l)
    return float(max(br, 0.0)), bool(bounded_r)
