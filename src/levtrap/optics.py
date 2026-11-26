"""Beams placed in the lab: direction, focus position, coherent groups.

A beam field of a setup is built in its own frame (propagating along +z,
focus at its origin, polarisation in its own x-y plane: the OTT beam of
:func:`levtrap.api._single_beam`) and then placed in the lab by a rotation R
that takes +z to the beam's ``direction`` and a translation to its
``position``.

**Rotation convention.** R is the smallest rotation taking +z to the
direction (about the axis z x d), so a beam tilted away from z keeps its
polarisation as close to the lab's as the tilt allows. A beam along -z is
rotated by 180 degrees about x: its own x is the lab's x, its own y the
lab's -y. So two opposing beams both polarised "x" are polarised along the
same lab axis, and with equal phases they interfere constructively at a
common focus. (No rotation can keep both x and y: it would flip the
handedness of the frame.) Polarisation ("x", "y", circular, Jones vectors)
is always given in the beam's own frame and is carried by R; circular
polarisation keeps its helicity.

**Incoherent beams** (not linked by ``coherent_with``) are separate fields
whose forces add. Each is computed in its own frame and the force rotated
back (:class:`levtrap.fields.OpticalField`), which is exact: nothing is
re-expanded. Beams of different wavelengths get their own T-matrix.

**Coherent groups** (beams linked by ``coherent_with``, directly or through
other beams; they share one wavelength) interfere, so their coefficients
are added in one frame: the lab orientation, at the first beam's focus. Each
beam is rotated (Wigner matrices, exact at fixed Nmax) and, if its focus is
elsewhere, translated, with Nmax raised so the translated beam stays
converged (:func:`translation_nmax`). The amplitudes are sqrt(P) e^{i phase}.
As before (PLAN.md, note 8), the sum of the beams' ``power`` entries is the
power of the coherent superposition: interference between the beams'
angular spectra changes it, and the whole group is rescaled to that total.
Beams whose angular spectra do not overlap (two opposing beams with
NA < n / sqrt(2)) do not interfere in this sense, so each keeps its power.
"""

from __future__ import annotations

import math

import numpy as np

from .bsc import Bsc
from .fields import OpticalField

__all__ = ["beam_rotation", "coherent_groups", "dark_split", "optical_fields", "translation_nmax", "is_simple"]

_Z = np.array([0.0, 0.0, 1.0])


def beam_rotation(direction) -> np.ndarray:
    """The rotation R taking +z to ``direction`` (see the module docstring)."""
    d = np.asarray(direction, dtype=float)
    d = d / np.linalg.norm(d)
    c = float(d @ _Z)
    if c > 1 - 1e-12:
        return np.eye(3)
    if c < -1 + 1e-12:
        return np.diag([1.0, -1.0, -1.0])  # 180 degrees about x
    axis = np.cross(_Z, d)
    s = np.linalg.norm(axis)
    k = axis / s
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + s * K + (1 - c) * (K @ K)


def coherent_groups(beams: list[dict]) -> list[list[int]]:
    """Indices of the beams that interfere, grouped; groups in setup order."""
    parent = list(range(len(beams)))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    ids = {b.get("id"): i for i, b in enumerate(beams) if b.get("id") is not None}
    for i, b in enumerate(beams):
        other = ids.get(b.get("coherent_with"))
        if other is not None:
            a, c = root(i), root(other)
            parent[max(a, c)] = min(a, c)
    groups: dict[int, list[int]] = {}
    for i in range(len(beams)):
        groups.setdefault(root(i), []).append(i)
    return list(groups.values())


def is_simple(beams: list[dict]) -> bool:
    """All beams along +z with their focus at the origin (the original engine's case)."""
    return all(b["direction"][0] == 0 and b["direction"][1] == 0 and b["direction"][2] > 0
               and not any(b["position"]) for b in beams)


def translation_nmax(beam: Bsc, offset: float, particle_nmax: int = 0) -> int:
    """Nmax for a beam re-expanded about a point ``offset`` [m] from its focus.

    The beam's own Nmax plus the Wiscombe-like rule for a sphere of radius
    ``offset``: k d + 3 (k d)^(1/3) + 2, at least the particle's Nmax.
    """
    kd = beam.k_medium * float(offset)
    extra = int(math.ceil(kd + 3 * kd ** (1 / 3) + 2)) if kd > 0 else 0
    return max(beam.Nmax + extra, particle_nmax)


def _group_beam(specs: list[dict], units: list[Bsc], origin: np.ndarray, particle_nmax: int,
                nmax_factor: float = 1.0) -> Bsc:
    """Coherent sum of a group's beams in the lab orientation, about ``origin``."""
    powers = [max(float(b["power"]), 0.0) for b in specs]
    total = None
    for spec, unit, p in zip(specs, units, powers):
        b = unit * (math.sqrt(p) * np.exp(1j * float(spec["phase"])))
        R = beam_rotation(spec["direction"])
        if not np.allclose(R, np.eye(3)):
            # Bsc.rotate(M) turns the beam's force pattern by M^T (OTT's rotation of
            # the coordinates), so M = R^T turns the beam by R.
            b, _ = b.rotate(R.T)
        offset = np.asarray(spec["position"], dtype=float) - origin
        if np.any(offset != 0):
            nmax = int(math.ceil(nmax_factor * translation_nmax(b, np.linalg.norm(offset), particle_nmax)))
            # a beam seen from a point -offset away from its focus has its focus at +offset
            b = b.translate_xyz(-offset, Nmax=nmax)
        total = b if total is None else total + b
    target = sum(powers)
    if len(specs) > 1 and total.power > 0:
        total = total * math.sqrt(target / total.power)
    return total


def optical_fields(s: dict, unit_beam, tmatrix_at, nmax_factor: float = 1.0) -> list[OpticalField]:
    """The optical fields of a parsed, resolved setup: one per coherent group.

    ``unit_beam(spec, n_medium)`` builds a beam field's unit-power beam in its
    own frame; ``tmatrix_at(wavelength)`` the particle's T-matrix at a
    wavelength. ``nmax_factor`` scales the Nmax of translated beams (for
    convergence tests).
    """
    nm = float(s["environment"]["medium_index"])
    beams = [f for f in s["trap"]["fields"] if f["kind"] == "beam"]
    out = []
    tms: dict[float, object] = {}
    for group in coherent_groups(beams):
        specs = [beams[i] for i in group]
        wl = float(specs[0]["wavelength"])
        if wl not in tms:
            tms[wl] = tmatrix_at(wl)
        T = tms[wl]
        units = [unit_beam(b, nm) for b in specs]
        if len(specs) == 1:
            b = specs[0]
            beam = units[0] * math.sqrt(max(float(b["power"]), 0.0))
            out.append(OpticalField(beam, T, nm, rotation=beam_rotation(b["direction"]), origin=b["position"]))
        else:
            origin = np.asarray(specs[0]["position"], dtype=float)
            beam = _group_beam(specs, units, origin, T.Nmax[0], nmax_factor)
            out.append(OpticalField(beam, T, nm, origin=origin))
    return out


def focus_field(spec: dict, unit: Bsc, point) -> np.ndarray:
    """The lab-frame electric field (OTT units, unit power) of one beam at a lab ``point`` [m].

    The beam's own field is taken at R^T (point - position) and turned by R,
    and its phase applied: the same placement as :func:`_group_beam`, without
    re-expanding the beam (exact within the beam's Nmax).
    """
    R = beam_rotation(spec["direction"])
    local = R.T @ (np.asarray(point, dtype=float) - np.asarray(spec["position"], dtype=float))
    E = unit.em_field_xyz(local[None, :])[0]
    return np.exp(1j * float(spec["phase"])) * (R @ E)


def dark_split(specs: list[dict], units: list[Bsc]) -> dict | None:
    """The power split of a coherent pair that darkens the focus (#79).

    The pair's field at the first beam's focus is sqrt(P1) a + sqrt(P2) b,
    with a, b the fields of the unit-power beams there (phases, directions
    and polarisations included, :func:`focus_field`). Equal intensities,
    P1 |a|^2 = P2 |b|^2, null it when a and b are antiparallel (the bottle
    beam: two coaxial beams of one circular polarisation, opposite in
    phase); this is the split of ``dark_split`` in
    examples/paper_2607_09896.py, and OTT's (tests/test_ott_dark_trap.py).
    At fixed total P1 + P2 the fraction in the second beam is then

        split = |a|^2 / (|a|^2 + |b|^2).

    ``residual`` says how dark the focus is at that split: |E|^2 over the
    two beams' intensities added, 1 + Re(a* . b) / (|a| |b|), from 0 (a
    null: the fields are antiparallel) to 2 (in phase). The common rescaling
    of a coherent group to its total power (:func:`_group_beam`) multiplies
    both beams alike and changes neither.

    Returns ``None`` when neither beam has a field at the focus.
    """
    if len(specs) != 2:
        raise ValueError("the dark split is for a pair of coherent beams")
    origin = specs[0]["position"]
    a, b = (focus_field(s, u, origin) for s, u in zip(specs, units))
    ia, ib = float(np.vdot(a, a).real), float(np.vdot(b, b).real)
    if ia + ib <= 0:
        return None
    cross = float(np.vdot(a, b).real)
    residual = 1 + cross / math.sqrt(ia * ib) if ia > 0 and ib > 0 else 1.0
    return dict(split=ia / (ia + ib), residual=residual)
