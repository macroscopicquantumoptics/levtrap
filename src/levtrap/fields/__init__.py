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


NMAX_MARGIN = 8  # orders kept beyond k r + 3 (k r)^(1/3) + the particle's (OpticalField.nmax_needed)


class OpticalField:
    """Force of one optical field (a beam, or a coherent group summed into one
    beam) on a sphere, from the T-matrix (OTT port).

    ``beam`` is a :class:`levtrap.bsc.Bsc` whose coefficients are scaled so
    that ``beam.power`` is the power in watts; then F [N] = Q n_medium / c
    with Q from :func:`levtrap.force.forcetorque` (see :mod:`levtrap.derived`).

    ``beam`` is given in its own frame. ``rotation`` R (3x3) and ``origin``
    p [m] place that frame in the lab: a lab point r is R^T (r - p) in the
    beam's frame, and a force F' computed there is R F' in the lab. The
    identity and the origin (the defaults) leave the beam where it is.
    """

    kind = "beam"

    def __init__(self, beam, tmatrix, n_medium: float, rotation=None, origin=None):
        self.beam = beam
        self._truncated: dict[int, object] = {}
        self.T = tmatrix
        self.n_medium = float(n_medium)
        self.length_scale = 2 * np.pi / beam.k_medium  # wavelength in the medium [m]
        self.R = np.eye(3) if rotation is None else np.asarray(rotation, dtype=float)
        self.origin = np.zeros(3) if origin is None else np.asarray(origin, dtype=float)

    def _own(self, r) -> np.ndarray:
        """Lab positions (N, 3) -> positions in the beam's frame (N, 3)."""
        return (_positions(r) - self.origin) @ self.R

    def nmax_needed(self, distance: float) -> int:
        """The beam order that describes the field out to ``distance`` [m]
        from the focus, across the particle: k r + 3 (k r)^(1/3) (the usual
        bound for a multipole series out to radius r) plus the particle's own
        order and a margin of :data:`NMAX_MARGIN`."""
        kr = float(self.beam.k_medium) * float(distance)
        n_particle = int(np.max(np.atleast_1d(self.T.Nmax)))
        return int(np.ceil(kr + 3 * np.cbrt(kr))) + n_particle + NMAX_MARGIN

    def _beam_for(self, own) -> object:
        """The beam, cut to the order the points ``own`` (in the beam's frame)
        need. A focus with an edge (an aperture, a field that does not vanish
        at 90 degrees) keeps Nmax ~ 100 in BscPmGauss; terms above k r carry
        the field far from the focus only, and translating them costs
        ~Nmax^3 per point."""
        n = self.nmax_needed(float(np.max(np.linalg.norm(own, axis=1))) if len(own) else 0.0)
        if n >= self.beam.Nmax:
            return self.beam
        beam = self._truncated.get(n)
        if beam is None:
            if len(self._truncated) > 16:
                self._truncated.clear()
            beam = self._truncated[n] = self.beam.set_Nmax(n)
        return beam

    def force(self, r) -> np.ndarray:
        own = self._own(r)
        f = forcetorque(self._beam_for(own), self.T, position=own.T)[0]
        return (np.asarray(f).reshape(3, -1).T @ self.R.T) * (self.n_medium / C)

    def dipole_force(self, r, radius: float) -> np.ndarray:
        """The same force in the dipole approximation (:mod:`levtrap.dipole`),
        for a sphere of ``radius`` [m] with this field's T-matrix indices: the
        comparison that shows where Mie theory matters. Lab positions (N, 3)
        -> forces (N, 3) [N]."""
        from ..dipole import dipole_force
        m_rel = complex(self.T.k_particle / self.T.k_medium)
        own = self._own(r)
        beam = self._beam_for(own)  # dipole_force divides by the power of the beam it is given
        q = dipole_force(beam, radius, m_rel, own)
        return (np.asarray(q).reshape(3, -1).T @ self.R.T) * beam.power * (self.n_medium / C)

    def scattering(self, r) -> dict:
        """Scattered and absorbed power [W] with the particle at r, and the
        scattered power split per multipole [W] (``P_sca_multipoles``, #80), and the
        direction moments of the scattered photons in the lab frame: ``mean``
        <n> and ``second`` <n n^T> of the Mie far field weighted by dP_sca/dOmega
        (:func:`levtrap.pattern.direction_moments`), for the recoil heating (#78).
        A direction n' in the beam's frame is R n' in the lab."""
        from ..pattern import direction_moments
        r = self._own(r)[0]
        # the whole beam: the fractions below are of the translated beam's power, high orders included
        b = self.beam.translate_xyz(r) if np.any(r != 0) else self.beam
        sbeam, _ = b.scatter(self.T)
        pb = power_balance(b, sbeam)
        if abs(pb["abs"]) < 1e-12:  # round-off for (nearly) lossless particles
            pb["abs"] = max(pb["abs"], 0.0)
        P = self.beam.power
        out = dict(P_sca=pb["sca"] * P, P_abs=pb["abs"] * P,
                   P_sca_multipoles={k: v * P for k, v in pb["sca_multipoles"].items()})
        if pb["sca"] > 0:
            mom = direction_moments(sbeam if sbeam.type == "scattered" else sbeam.scattered_field(b))
            out["mean"] = self.R @ np.real(mom["mean"])
            out["second"] = self.R @ np.real(mom["second"]) @ self.R.T
        return out

    def incident_at(self, r):
        """The incident beam expanded about the particle at lab position r [m],
        in the lab orientation, scaled to watts (#76).

        The beam is translated to the particle in its own frame, as for the
        force, and then turned by R about that point (``Bsc.rotate(R^T)``
        turns a beam by R; see :func:`levtrap.optics._group_beam`), so its
        scattered far field, and the derivatives of it along x, y, z, are in
        the lab frame. A sphere's T-matrix is the same in every orientation.
        """
        own = self._own(r)[0]
        b = self.beam.translate_xyz(own) if np.any(own != 0) else self.beam
        if not np.allclose(self.R, np.eye(3)):
            b, _ = b.rotate(self.R.T)
        return b

    def model(self) -> ModelInfo:
        return ModelInfo("mie")
