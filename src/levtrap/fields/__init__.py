"""Fields: one source of force each (``docs/ARCHITECTURE.md`` §5).

A field answers ``force(r)``: the time-averaged force [N] on the particle at
positions ``r`` [m], shape (N, 3) in and out, lab frame, SI.  The solver
(:mod:`levtrap.solver`) only ever sees the sum of the fields' forces, so a
new kind of trap is a new field.

``length_scale`` is the distance [m] over which the field's force changes
appreciably (the wavelength in the medium for a beam); the solver takes its
finite-difference steps and Newton step limits from it.  ``None`` means the
force is uniform (gravity) and sets no scale.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import numpy as np

from ..derived import C, power_balance
from ..force import forcetorque

__all__ = ["ModelInfo", "Field", "GravityField", "OpticalField", "total_force"]


@dataclass
class ModelInfo:
    """The approximation behind a field's force."""
    name: str                      # e.g. "mie", "pseudopotential", "exact"
    validity: str = "ok"           # "ok" | "approximate" | "outside"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return dict(model=self.name, validity=self.validity, notes=list(self.notes))


@runtime_checkable
class Field(Protocol):
    kind: str
    length_scale: float | None

    def force(self, r: np.ndarray) -> np.ndarray:
        """(N, 3) positions [m] -> (N, 3) forces [N], time-averaged."""
        ...

    def model(self) -> ModelInfo: ...


def _positions(r) -> np.ndarray:
    r = np.asarray(r, dtype=float)
    return r.reshape(1, 3) if r.ndim == 1 else r


def total_force(fields, r) -> np.ndarray:
    """Sum of the fields' forces at positions r, shape (N, 3) [N]."""
    r = _positions(r)
    out = np.zeros_like(r)
    for f in fields:
        out += f.force(r)
    return out


class GravityField:
    """Uniform force m g on the particle."""

    kind = "gravity"
    length_scale = None

    def __init__(self, mass: float, g=(0.0, -9.81, 0.0)):
        self.mass = float(mass)
        self.g = np.asarray(g, dtype=float)

    def force(self, r) -> np.ndarray:
        r = _positions(r)
        return np.broadcast_to(self.mass * self.g, r.shape).copy()

    def model(self) -> ModelInfo:
        return ModelInfo("exact")


class OpticalField:
    """Force of one optical field (a beam, or a coherent group summed into one
    beam) on a sphere, from the T-matrix (OTT port).

    ``beam`` is a :class:`levtrap.bsc.Bsc` whose coefficients are scaled so
    that ``beam.power`` is the power in watts; then F [N] = Q n_medium / c
    with Q from :func:`levtrap.force.forcetorque` (see :mod:`levtrap.derived`).
    """

    kind = "beam"

    def __init__(self, beam, tmatrix, n_medium: float):
        self.beam = beam
        self.T = tmatrix
        self.n_medium = float(n_medium)
        self.length_scale = 2 * np.pi / beam.k_medium  # wavelength in the medium [m]

    def force(self, r) -> np.ndarray:
        r = _positions(r)
        f = forcetorque(self.beam, self.T, position=r.T)[0]
        return np.asarray(f).reshape(3, -1).T * (self.n_medium / C)

    def scattering(self, r) -> dict:
        """Scattered and absorbed power [W] with the particle at r."""
        r = np.asarray(r, dtype=float)
        b = self.beam.translate_xyz(r) if np.any(r != 0) else self.beam
        sbeam, _ = b.scatter(self.T)
        pb = power_balance(b, sbeam)
        if abs(pb["abs"]) < 1e-12:  # round-off for (nearly) lossless particles
            pb["abs"] = max(pb["abs"], 0.0)
        P = self.beam.power
        return dict(P_sca=pb["sca"] * P, P_abs=pb["abs"] * P)

    def model(self) -> ModelInfo:
        return ModelInfo("mie")
