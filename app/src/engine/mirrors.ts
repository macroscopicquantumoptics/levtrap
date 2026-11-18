/**
 * A parabolic mirror (focus.kind "parabolic_mirror", levtrap.mirror): its
 * angles, its equivalent cone and its surface, for drawing it and for the
 * linked fields. mirrors.test.ts checks them against the Python.
 *
 * In the beam's own frame the focus is at the origin, the beam's direction is
 * +z and the mirror's vertex at z = −f: the surface is z = ρ²/(4f) − f.
 */
import type { MirrorFocus } from "./types.ts";

/** [hole, rim] [rad]: the angles from −z at which the focus sees the hole's edge and the rim (mirror.mirror_angles). */
export function mirrorAngles(m: MirrorFocus): [number, number] {
  return [2 * Math.atan((m.hole_radius ?? 0) / (2 * m.focal_length)), 2 * Math.atan(m.rim_radius / (2 * m.focal_length))];
}

/** Fraction of the input beam's power reflected to the focus: inside the rim, outside the hole (a Gaussian, exactly). */
export function mirrorReflected(m: MirrorFocus): number {
  const w = m.beam_diameter / 2;
  return Math.exp((-2 * (m.hole_radius ?? 0) ** 2) / w ** 2) - Math.exp((-2 * m.rim_radius ** 2) / w ** 2);
}

/**
 * The cone a drawn beam stands for: the angle of the beam's 1/e² radius on the
 * mirror (2 atan(w / 2f)), at most the rim's, and below 80° (a deep mirror's
 * light comes from beyond 90°, which a cone cannot draw).
 */
export function mirrorHalfAngle(m: MirrorFocus): number {
  const edge = 2 * Math.atan(m.beam_diameter / 2 / (2 * m.focal_length));
  return Math.min(edge, mirrorAngles(m)[1], (80 * Math.PI) / 180);
}

/** The surface's height above the focus [m] at ρ from the axis, along the beam's direction. */
export const mirrorSag = (m: MirrorFocus, rho: number): number => (rho * rho) / (4 * m.focal_length) - m.focal_length;
