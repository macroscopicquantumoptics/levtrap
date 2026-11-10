"""Generic trap solver: summed field force -> equilibrium, modes, depth.

``docs/ARCHITECTURE.md`` §5.  Works on any list of fields from
:mod:`levtrap.fields`; nothing here knows what a beam or an electrode is.

1. Coarse scan of the force along the z, x and y lines through ``centre``
   (in that order, stopping at the first that has a restoring zero
   crossing); the deepest crossing seeds step 2.
2. 3D Newton iteration on F(r) = 0, steps limited to a quarter of the
   smallest field length scale.
3. Stiffness matrix K_ij = -dF_i/dr_j by central differences (step
   length_scale / 200), symmetrised; its antisymmetric part is reported
   when it exceeds :data:`NONCONSERVATIVE_WARN` of the symmetric part
   (optical forces need not be conservative).
4. Eigen-decomposition of K: frequencies f = sqrt(k / m) / 2 pi and axes.
   ``stable`` only when Newton converged and all three eigenvalues are
   positive.
5. Depth along each eigen-axis: U(s) = -integral F . e ds on a line through
   the equilibrium, barrier = smaller of the two sides
   (:func:`levtrap.traps.trap_depth`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .fields import total_force
from .traps import find_traps, trap_depth

__all__ = ["Trap", "find_trap", "stiffness", "NONCONSERVATIVE_WARN"]

NONCONSERVATIVE_WARN = 0.03
AXIS_NAMES = ("x", "y", "z")


@dataclass
class Trap:
    stable: bool
    converged: bool
    equilibrium: np.ndarray | None          # [m]
    K: np.ndarray | None                    # symmetrised stiffness [N/m]
    modes: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


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


def _newton(fields, r0, h, max_step, tol, bounds, max_iter=30):
    r = np.asarray(r0, dtype=float).copy()
    for _ in range(max_iter):
        K, F = stiffness(fields, r, h)
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


def find_trap(fields, mass: float, *, centre=(0.0, 0.0, 0.0), ranges=(1.5e-6, 1.5e-6, 3e-6),
              points: int = 61, depth_points: int | None = None) -> Trap:
    """Equilibrium, modes and depth of the summed force of ``fields``.

    ``ranges`` are the half-widths [m] of the scan along x, y, z around
    ``centre``; the equilibrium must lie inside them.  Each mode is a dict
    with ``name`` (the lab axis it is closest to), ``axis`` (unit vector),
    ``stiffness`` [N/m], ``frequency`` [Hz] (``None`` unless the stiffness
    is positive), ``depth`` [J] and ``bounded`` (False: the barrier lies
    beyond the scan and the depth is a lower bound).
    """
    centre = np.asarray(centre, dtype=float)
    ranges = np.asarray(ranges, dtype=float)
    depth_points = points if depth_points is None else depth_points
    L = _scale(fields)
    h = L / 200
    out = Trap(stable=False, converged=False, equilibrium=None, K=None)

    r0 = _seed(fields, centre, ranges, points)
    if r0 is None:
        return out
    r_eq, ok = _newton(fields, r0, h, max_step=L / 4, tol=L * 1e-7, bounds=(centre, ranges))
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
    out.modes = modes
    out.stable = bool(np.all(ev > 0))
    return out
