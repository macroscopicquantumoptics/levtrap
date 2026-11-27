"""Generic trap solver: summed field force -> equilibrium, modes, depth.

``docs/ARCHITECTURE.md`` §5.  Works on any list of fields from
:mod:`levtrap.fields`; nothing here knows what a beam or an electrode is.

1. Coarse scan of the force along the z, x and y lines through ``centre``
   (in that order, stopping at the first that has a restoring zero
   crossing); the deepest crossing seeds step 2.
2. 3D Newton iteration on F(r) = 0, steps limited to a quarter of the
   smallest field length scale.
2b. Only if that gives no stable equilibrium (#59): every restoring zero
   crossing on the three lines of a box :data:`WIDER` times as large,
   nearest to the centre first, each a seed for a short Newton run
   (:func:`_wider_search`); the first stable equilibrium wins, otherwise
   step 2's answer stands. A trap step 2 finds is therefore never changed,
   and costs nothing more; a setup with no trap costs a few more force
   evaluations.
3. Stiffness matrix K_ij = -dF_i/dr_j by central differences (step
   length_scale / 200), symmetrised; its antisymmetric part is reported
   when it exceeds :data:`NONCONSERVATIVE_WARN` of the symmetric part
   (optical forces need not be conservative).
4. Eigen-decomposition of K: frequencies f = sqrt(k / m) / 2 pi and axes.
   ``stable`` only when Newton converged and all three eigenvalues are
   positive: the static verdict, from the symmetric part alone.
4b. The dynamic verdict is separate (:func:`dynamics`, #101): the full K,
   curl included, with the gas damping. A curl (K_xy = -K_yx, as the spin
   of circularly polarised light gives) can make a statically stable trap's
   motion spiral out when the damping is weak.
5. Depth along each eigen-axis: U(s) = -integral F . e ds on a line through
   the equilibrium, barrier = smaller of the two sides
   (:func:`levtrap.traps.trap_depth`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .fields import total_force
from .traps import find_traps, trap_depth

__all__ = ["Trap", "find_trap", "stiffness", "dynamics", "curl", "damping_needed", "NONCONSERVATIVE_WARN"]

NONCONSERVATIVE_WARN = 0.03
AXIS_NAMES = ("x", "y", "z")


@dataclass
class Trap:
    stable: bool
    converged: bool
    equilibrium: np.ndarray | None          # [m]
    K: np.ndarray | None                    # symmetrised stiffness [N/m]
    K_full: np.ndarray | None = None        # K_ij = -dF_i/dr_j, curl included [N/m], lab frame
    modes: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    jumped: bool = False  # a start was given and the equilibrium followed from it vanished
    wider: bool = False  # found by the fallback search (the first seed gave no stable trap)


def _scale(fields) -> float:
    scales = [f.length_scale for f in fields if f.length_scale]
    if not scales:
        raise ValueError("no field sets a length scale: a uniform force cannot trap")
    return float(min(scales))


def stiffness(fields, r, h: float) -> tuple[np.ndarray, np.ndarray]:
    """``(K, F0)``: K_ij = -dF_i/dr_j at r by central differences of step h [m]."""
    r = np.asarray(r, dtype=float)
    pos = [r]
    for j in range(3):
        for s in (-1, 1):
            d = np.zeros(3)
            d[j] = s * h
            pos.append(r + d)
    f = total_force(fields, np.array(pos))
    K = np.zeros((3, 3))
    for j in range(3):
        K[:, j] = -(f[2 + 2 * j] - f[1 + 2 * j]) / (2 * h)
    return K, f[0]


def _seed(fields, centre, ranges, points) -> np.ndarray | None:
    """Deepest restoring zero crossing on the z, x, y lines through centre."""
    for j in (2, 0, 1):
        s = np.linspace(-ranges[j], ranges[j], points)
        line = np.tile(centre, (points, 1))
        line[:, j] += s
        fj = total_force(fields, line)[:, j]
        if not np.any(fj):
            continue
        traps = find_traps(s, fj)
        if traps:
            best = max(traps, key=lambda t: t["depth"])
            r0 = np.array(centre, dtype=float)
            r0[j] += float(best["position"])
            return r0
    return None


def _newton(fields, r0, h, max_step, tol, bounds, max_iter=30, stall_after=None):
    """Newton on F(r) = 0. ``stall_after``: give up when |F| has not halved
    after that many steps (in a trap's basin it falls quadratically; near a
    trap that has just vanished, or far from any, it creeps)."""
    r = np.asarray(r0, dtype=float).copy()
    f0 = None
    for i in range(max_iter):
        K, F = stiffness(fields, r, h)
        if f0 is None:
            f0 = np.linalg.norm(F)
        elif stall_after is not None and i == stall_after and np.linalg.norm(F) > 0.5 * f0:
            return r, False
        try:
            step = np.linalg.solve(K, F)
        except np.linalg.LinAlgError:
            return r, False
        n = np.linalg.norm(step)
        if n > max_step:
            step *= max_step / n
        r = r + step
        if np.any(np.abs(r - bounds[0]) > bounds[1]):
            return r, False  # left the scanned region
        if n < tol:
            return r, True
    return r, False


def _clean_axis(v: np.ndarray) -> np.ndarray:
    """Unit eigenvector with round-off components (< 1e-9) set to zero and the
    largest component positive."""
    v = np.where(np.abs(v) < 1e-9, 0.0, v)
    v = v / np.linalg.norm(v)
    return -v if v[np.argmax(np.abs(v))] < 0 else v


DEGENERATE = 1e-6  # eigenvalues closer than this (relative to the largest) share an eigenspace


def _lab_aligned(ev: np.ndarray, evec: np.ndarray) -> np.ndarray:
    """Eigenvectors with each degenerate eigenspace given the basis closest to
    the lab axes.  In a degenerate eigenspace (a trap symmetric about z, say)
    any orthonormal basis is an equally valid answer, and which one
    ``eigh`` returns depends on round-off, so on the machine; this one does
    not: the lab axes are projected onto the eigenspace and orthonormalised,
    those with the largest projection first (ties in x, y, z order)."""
    evec = evec.copy()
    scale = max(float(np.max(np.abs(ev))), 1e-300)
    i = 0
    while i < len(ev):
        j = i + 1
        while j < len(ev) and ev[j] - ev[j - 1] <= DEGENERATE * scale:
            j += 1
        if j - i > 1:
            V = evec[:, i:j]
            P = V @ V.T
            basis: list[np.ndarray] = []
            for lab in sorted(range(3), key=lambda a: (-round(float(np.linalg.norm(P[:, a])), 9), a)):
                v = P[:, lab].copy()
                for b in basis:
                    v -= (b @ v) * b
                if np.linalg.norm(v) > 1e-6:
                    basis.append(v / np.linalg.norm(v))
                if len(basis) == j - i:
                    break
            evec[:, i:j] = np.column_stack(basis)
        i = j
    return evec


WIDER = 2.0  # the fallback search box, in units of the first one
FALLBACK_ITER = 12  # Newton steps per fallback seed
FALLBACK_STALL = 3  # ... and it is dropped if |F| has not halved after this many


def _seeds(fields, centre, ranges, points) -> list[np.ndarray]:
    """Every restoring zero crossing on the z, x and y lines through
    ``centre``, nearest to it first (distance in units of ``ranges``)."""
    out = []
    for j in (2, 0, 1):
        s = np.linspace(-ranges[j], ranges[j], points)
        line = np.tile(centre, (points, 1))
        line[:, j] += s
        fj = total_force(fields, line)[:, j]
        if not np.any(fj):
            continue
        for t in find_traps(s, fj):
            r0 = np.array(centre, dtype=float)
            r0[j] += float(t["position"])
            out.append(r0)
    return sorted(out, key=lambda r: float(np.linalg.norm((r - centre) / ranges)))


def _wider_search(fields, centre, ranges, points, h, L, skip=None) -> np.ndarray | None:
    """The fallback when the first seed gives no stable trap: every restoring
    zero on the three lines of a box :data:`WIDER` times as large, nearest
    first, except ``skip`` (the first seed, already tried); Newton from each,
    at most :data:`FALLBACK_ITER` steps, dropped after :data:`FALLBACK_STALL`
    if |F| has not halved (from a seed in a trap's basin it converges in a
    handful; near a trap that has just vanished it creeps and never does).
    The first stable equilibrium wins."""
    box = np.asarray(ranges) * WIDER
    found: list[np.ndarray] = []
    for r0 in _seeds(fields, centre, box, points):
        if skip is not None and np.linalg.norm(r0 - skip) < L * 1e-2:
            continue
        r, ok = _newton(fields, r0, h, max_step=L / 4, tol=L * 1e-7, bounds=(centre, box),
                        max_iter=FALLBACK_ITER, stall_after=FALLBACK_STALL)
        if not ok or any(np.linalg.norm(r - f) < L * 1e-3 for f in found):
            continue
        found.append(r)
        K, _ = stiffness(fields, r, h)
        if np.all(np.linalg.eigvalsh(0.5 * (K + K.T)) > 0):
            return r
    return None


def find_trap(fields, mass: float, *, centre=(0.0, 0.0, 0.0), ranges=(1.5e-6, 1.5e-6, 3e-6),
              points: int = 61, depth_points: int | None = None, start=None) -> Trap:
    """Equilibrium, modes and depth of the summed force of ``fields``.

    ``ranges`` are the half-widths [m] of the scan along x, y, z around
    ``centre``; the equilibrium must lie inside them.  Each mode is a dict
    with ``name`` (the lab axis it is closest to), ``axis`` (unit vector),
    ``stiffness`` [N/m], ``frequency`` [Hz] (``None`` unless the stiffness
    is positive), ``depth`` [J] and ``bounded`` (False: the barrier lies
    beyond the scan and the depth is a lower bound).

    ``start`` (continuation, as a sweep follows one trap): Newton from this
    point first; if it converges to a stable equilibrium that is the trap.
    Otherwise the followed equilibrium has vanished: ``jumped`` is set and
    the search starts afresh from the scan.
    """
    centre = np.asarray(centre, dtype=float)
    ranges = np.asarray(ranges, dtype=float)
    depth_points = points if depth_points is None else depth_points
    L = _scale(fields)
    h = L / 200
    out = Trap(stable=False, converged=False, equilibrium=None, K=None)

    followed = None
    if start is not None:
        s0 = np.asarray(start, dtype=float)
        r_eq, ok = _newton(fields, s0, h, max_step=L / 4, tol=L * 1e-7, bounds=(s0, ranges))
        if ok:
            Kf, _ = stiffness(fields, r_eq, h)
            if np.all(np.linalg.eigvalsh(0.5 * (Kf + Kf.T)) > 0):
                followed = r_eq
        if followed is None:
            out.jumped = True
    if followed is not None:
        r_eq, ok = followed, True
    else:
        r0 = _seed(fields, centre, ranges, points)
        r_eq, ok = (None, False) if r0 is None else _newton(fields, r0, h, max_step=L / 4, tol=L * 1e-7,
                                                            bounds=(centre, ranges))
        stable = False
        if ok:
            K0, _ = stiffness(fields, r_eq, h)
            stable = bool(np.all(np.linalg.eigvalsh(0.5 * (K0 + K0.T)) > 0))
        if not stable:
            wider = _wider_search(fields, centre, ranges, points, h, L, skip=r0)
            if wider is not None:
                r_eq, ok = wider, True
                out.wider = True
        if r_eq is None:
            return out
    if not ok:
        out.warnings.append("The equilibrium search did not converge inside the scanned region.")
        return out
    K, _ = stiffness(fields, r_eq, h)
    Ks = 0.5 * (K + K.T)
    asym = np.linalg.norm(0.5 * (K - K.T)) / max(np.linalg.norm(Ks), 1e-300)
    if asym > NONCONSERVATIVE_WARN:
        out.warnings.append(f"The force is not conservative here: the antisymmetric part of the "
                            f"stiffness matrix is {asym:.0%} of the symmetric part, so the depth "
                            f"and frequencies are approximate.")
    ev, evec = np.linalg.eigh(Ks)
    evec = _lab_aligned(ev, evec)
    axes = [_clean_axis(evec[:, i]) for i in range(3)]
    # name each mode by the lab axis it is closest to; order x, y, z when that is unique
    dom = [int(np.argmax(np.abs(a))) for a in axes]
    order = sorted(range(3), key=lambda i: dom[i]) if len(set(dom)) == 3 else list(range(3))

    modes = []
    for i in order:
        a, k = axes[i], float(ev[i])
        half = float(np.linalg.norm(a * ranges))
        s = np.linspace(-half, half, depth_points)
        fs = total_force(fields, r_eq + np.outer(s, a)) @ a
        depth, bounded = trap_depth(s, fs, 0.0) if k > 0 else (0.0, False)
        modes.append(dict(name=AXIS_NAMES[dom[i]] if len(set(dom)) == 3 else f"mode{len(modes) + 1}",
                          axis=a, stiffness=k,
                          frequency=float(np.sqrt(k / mass) / (2 * np.pi)) if k > 0 else None,
                          depth=float(depth), bounded=bool(bounded)))
    out.converged = True
    out.equilibrium = r_eq
    out.K = Ks
    out.K_full = K
    out.modes = modes
    out.stable = bool(np.all(ev > 0))
    return out


# --- dynamic stability (#101) ------------------------------------------------------------

CURL_TOL = 1e-9  # a curl below this fraction of the highest trap angular frequency is round-off
MODE_WEIGHT = 0.05  # an eigen-motion counts for a mode when this share of it lies along the mode's axis


def curl(K) -> dict:
    """The antisymmetric part of K per block [N/m]: ``xy`` = (K_xy - K_yx) / 2,
    ``xz``, ``yz`` likewise. With F = -K r, a positive ``xy`` pushes a
    particle displaced along +x towards +y, and one displaced along +y
    towards -x: round the z axis, anticlockwise seen from +z. A part below
    :data:`CURL_TOL` of K's largest entry is round-off and reads 0."""
    K = np.asarray(K, dtype=float)
    floor = CURL_TOL * float(np.max(np.abs(K)))
    out = {}
    for i, j in ((0, 1), (0, 2), (1, 2)):
        a = float(0.5 * (K[i, j] - K[j, i]))
        out[f"{AXIS_NAMES[i]}{AXIS_NAMES[j]}"] = a if abs(a) > floor else 0.0
    return out


def damping_needed(K, mass: float) -> float:
    """The smallest damping rate gamma [1/s] that keeps m r'' = -K r - m gamma r'
    from growing; 0 when K's curl is round-off (below :data:`CURL_TOL`).

    With the same damping along every axis, each eigenvalue mu of K / m gives
    lambda^2 + gamma lambda + mu = 0, which lambda = i omega solves when
    gamma = |Im mu| / sqrt(Re mu); above that gamma both roots decay. A
    symmetric K has real mu and needs no damping; so does a curl a smaller
    than half the split of two stiffnesses (|a| < |k_x - k_y| / 2). For
    k_x = k_y = k it is a / (m omega_0) = (a / k) omega_0. Infinite when some
    Re mu <= 0 (a statically unstable K)."""
    mu = np.linalg.eigvals(np.asarray(K, dtype=float) / mass)
    if np.any(mu.real <= 0):
        return math.inf
    scale = float(np.sqrt(np.max(np.abs(mu))))
    g = float(np.max(np.abs(mu.imag) / np.sqrt(mu.real)))
    return g if g > CURL_TOL * scale else 0.0


def dynamics(K, mass: float, gamma: float, axes) -> dict:
    """Linear stability of m r'' = -K r - m gamma r' with the full K (curl
    included) and the gas damping rate ``gamma`` [1/s].

    The eigenvalues lambda of [[0, I], [-K/m, -gamma I]]: the motion goes as
    exp(lambda t). ``growth_rate``: for each of ``axes`` (the modes' unit
    vectors, lab frame), the largest Re lambda [1/s] of the eigen-motions
    with at least :data:`MODE_WEIGHT` of their displacement along it;
    negative when the mode is damped. ``damping_needed``:
    :func:`damping_needed`. ``unstable``: the damping is below that, so some
    motion grows. A symmetric K is stable at any damping (growth rates
    -gamma / 2 or less; 0 without damping)."""
    K = np.asarray(K, dtype=float)
    A = np.block([[np.zeros((3, 3)), np.eye(3)], [-K / mass, -gamma * np.eye(3)]])
    lam, vec = np.linalg.eig(A)
    pos = vec[:3]
    norm = np.sum(np.abs(pos) ** 2, axis=0)
    growth = []
    for e in axes:
        w = np.abs(np.asarray(e, dtype=float) @ pos) ** 2 / np.where(norm > 0, norm, 1.0)
        growth.append(float(np.max(lam.real[w >= min(MODE_WEIGHT, float(w.max()))])))
    need = damping_needed(K, mass)
    return dict(growth_rate=growth, damping_needed=need, unstable=bool(need > 0 and gamma < need))
