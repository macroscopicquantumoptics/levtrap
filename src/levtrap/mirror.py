"""A collimated Gaussian beam focused by a parabolic mirror (E3, issue #25).

Geometry
--------
The paraboloid has its focus at the origin and its vertex at z = -f; it
opens towards +z: z = rho^2 / (4 f) - f. The collimated input beam travels
along -z (it comes from above, around the focus), hits the mirror at height
rho from the axis and is reflected to the focus. Seen from the focus, the
mirror point is at the angle alpha from -z with

    rho = 2 f tan(alpha / 2),        r(alpha) = 2 f / (1 + cos alpha),

so a mirror whose rim radius exceeds 2 f focuses from beyond 90 degrees: the
rim is above the focal plane ("deep" mirror). A central hole of radius
rho_h removes alpha < 2 atan(rho_h / 2 f).

Far field
---------
Geometric optics, as in Lieb & Meixner, Opt. Express 8, 458 (2001) and the
Debye-integral treatment of Varga & Torok, J. Opt. Soc. Am. A 17, 2081
(2000):

* every ray reaches the focus with the same optical path (the defining
  property of the paraboloid), so the far field has no aberration phase;
* energy conservation between the input annulus rho d rho d phi and the solid
  angle sin(alpha) d alpha d phi gives the amplitude factor
  sqrt(rho |d rho / d alpha| / sin alpha) = 2 f / (1 + cos alpha) = r(alpha),
  which grows towards the rim (an aplanatic lens has sqrt(cos theta),
  which falls);
* the field is reflected by a perfect conductor at the mirror normal n:
  E_r = -E_in + 2 (n . E_in) n. This carries the polarisation onto the
  sphere, including beyond 90 degrees, without the lens's
  radial -> theta / azimuthal -> phi rule.

The far field on the sphere of incoming directions (the field converges on
the focus from the mirror's side) is then projected onto vector spherical
harmonics with :func:`levtrap.lens.project_farfield`, Gauss-Legendre in
cos(theta) over the annulus alone, so the hard edges of the rim and the hole
are integrated exactly. The reflection's global sign is dropped: near the
axis the mirror's beam equals a lens's beam of the same polarisation and
phase (it propagates along +z, from the mirror up through the focus).

Not modelled: the input beam itself at the focus (a collimated beam much
wider than the focus, travelling -z: its intensity there is smaller than
the focused one by about (lambda f / w^2)^2), diffraction at the rim and the
hole beyond geometric optics, and mirror losses.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .bsc import Bsc
from .lens import project_farfield

__all__ = ["MirrorResult", "mirror_angles", "mirror_farfield", "focused_beam", "default_nmax"]


def mirror_angles(focal_length: float, rim_radius: float, hole_radius: float = 0.0) -> tuple[float, float]:
    """(alpha_hole, alpha_rim) [rad]: the angles from -z at which the focus sees
    the hole's edge and the rim. alpha_rim > pi/2 for a deep mirror."""
    f = float(focal_length)
    return 2 * math.atan(float(hole_radius) / (2 * f)), 2 * math.atan(float(rim_radius) / (2 * f))


def mirror_farfield(theta, phi, focal_length: float, beam_waist: float, polarisation=(1, 0)):
    """The far field (E_theta, E_phi) converging on the focus from the
    directions (theta, phi) (theta from +z; the mirror is at theta > pi/2 for
    alpha < pi/2), for an input field exp(-rho^2 / w^2) (w = ``beam_waist``,
    the 1/e^2 intensity radius) polarised along the Jones vector
    ``polarisation`` in the x-y plane. Arrays of the same shape; no aperture."""
    f = float(focal_length)
    th = np.asarray(theta, dtype=float)
    ph = np.asarray(phi, dtype=float)
    alpha = np.pi - th
    rho = 2 * f * np.tan(alpha / 2)
    amp = np.exp(-(rho**2) / float(beam_waist) ** 2) * (2 * f / (1 + np.cos(alpha)))
    ex, ey = complex(polarisation[0]), complex(polarisation[1])
    norm = math.sqrt(abs(ex) ** 2 + abs(ey) ** 2)
    ex, ey = ex / norm, ey / norm
    # incoming direction of the reflected ray, seen from the focus: d (the mirror point's direction)
    d = np.stack([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)], axis=-1)
    # mirror normal: bisects the reversed input direction (+z) and the reflected one (-d)
    n = np.stack([-d[..., 0], -d[..., 1], 1 - d[..., 2]], axis=-1)
    n = n / np.linalg.norm(n, axis=-1, keepdims=True)
    E_in = np.zeros(th.shape + (3,), dtype=complex)
    E_in[..., 0], E_in[..., 1] = ex, ey
    nE = np.sum(n * E_in, axis=-1)
    # perfect conductor; the global sign dropped (module docstring)
    E = E_in - 2 * nE[..., None] * n
    E = E * amp[..., None]
    t_hat = np.stack([np.cos(th) * np.cos(ph), np.cos(th) * np.sin(ph), -np.sin(th)], axis=-1)
    p_hat = np.stack([-np.sin(ph), np.cos(ph), np.zeros_like(ph)], axis=-1)
    return np.sum(E * t_hat, axis=-1), np.sum(E * p_hat, axis=-1)


@dataclass
class MirrorResult:
    beam: Bsc  # about the focus, for 1 W in the input beam: its power is the fraction reflected
    reflected: float  # fraction of the input power that reaches the focus (inside the rim, outside the hole)
    alpha_hole: float  # rad, from -z
    alpha_rim: float  # rad, from -z
    far_field_power: float  # the projected far field's power (Parseval), for the power check


def default_nmax(focal_length: float, rim_radius: float, beam_waist: float, wavelength: float) -> int:
    """Truncation order: ka2nmax of k times twice the paraxial waist of the
    mirror's cone (tan theta = w / f, at most the rim's angle), within 25..90.
    A shallow mirror makes a wide focus and needs more orders."""
    from .special import ka2nmax
    theta = min(math.atan(beam_waist / focal_length), 2 * math.atan(rim_radius / (2 * focal_length)), math.radians(80))
    w0 = wavelength / (math.pi * math.tan(theta))
    return int(min(90, max(25, ka2nmax(2 * np.pi / wavelength * 2 * w0))))


def focused_beam(focal_length: float, rim_radius: float, beam_waist: float, wavelength: float,
                 hole_radius: float = 0.0, polarisation=(1, 0), nmax: int | None = None,
                 ntheta: int | None = None, nphi: int | None = None) -> MirrorResult:
    """The focused beam of a parabolic mirror, as a :class:`Bsc` about the
    focus (regular, incident; k in vacuum), scaled to 1 W of input power.

    Lengths in metres. The input beam is exp(-rho^2/w^2), w = ``beam_waist``
    (1/e^2 intensity radius), centred on the mirror's axis.
    """
    a_h, a_r = mirror_angles(focal_length, rim_radius, hole_radius)
    nmax = nmax or default_nmax(focal_length, rim_radius, beam_waist, wavelength)
    if not 0 <= a_h < a_r < math.pi:
        raise ValueError("the hole must be smaller than the rim")
    w = float(beam_waist)
    # power of the input beam inside the annulus (exactly, for a Gaussian): fraction of the total
    reflected = math.exp(-2 * hole_radius**2 / w**2) - math.exp(-2 * rim_radius**2 / w**2)
    # quadrature over the annulus: theta = pi - alpha in [pi - a_r, pi - a_h]
    nt = ntheta or 4 * nmax + 40
    npf = nphi or 2 * nmax + 4
    x, wx = np.polynomial.legendre.leggauss(nt)
    c_lo, c_hi = math.cos(math.pi - a_h), math.cos(math.pi - a_r)  # cos(theta) at the hole and the rim
    cos_t = 0.5 * (c_hi - c_lo) * x + 0.5 * (c_hi + c_lo)
    wg = 0.5 * abs(c_hi - c_lo) * wx
    th = np.arccos(cos_t)
    ph = np.arange(npf) * 2 * np.pi / npf
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    Et, Ep = mirror_farfield(TH, PH, focal_length, w, polarisation)
    # the far field's power: |E|^2 over the sphere (theta from cos-weights, phi uniform)
    far = float(np.sum(wg[:, None] * (np.abs(Et) ** 2 + np.abs(Ep) ** 2)) * 2 * np.pi / npf)
    a, b = project_farfield(th, ph, Et, Ep, wg, nmax)
    # input power for exp(-rho^2/w^2): pi w^2 / 2; the projected beam carries the reflected part of it
    p_in = math.pi * w**2 / 2
    k = 2 * np.pi / float(wavelength)
    beam = Bsc(a / math.sqrt(p_in), b / math.sqrt(p_in), basis="regular", type="incident", k_medium=k)
    return MirrorResult(beam, reflected, a_h, a_r, far / p_in)
