/**
 * Geometry of the drawn trap. Lab frame as in the Setup: z is the optical
 * axis of the first beam, y is up. Lengths in metres, screen points in px.
 *
 * The view is a cabinet projection: the y-z plane is the picture plane and
 * x recedes up and to the right at 45° with half its length. So z runs to
 * the right, y up, and lengths in the picture plane are true to the scale bar.
 */
import type { BeamField, Focus, Setup, Vec3 } from "../../engine/types.ts";
import { formatSI } from "../../lib/format.ts";
import { directionOf, environmentOf } from "../model.ts";

export type Point = [number, number];

/** How far one metre along x moves a point on screen, per metre of scale, right and up. */
export const RECEDE = Math.SQRT1_2 / 2;

export interface View {
  /** px per metre */
  scale: number;
  /** screen position of the lab origin */
  cx: number;
  cy: number;
}

export interface Box {
  width: number;
  height: number;
  /** px kept free on each side (islands, inspector) */
  inset: { top: number; right: number; bottom: number; left: number };
}

// --- vectors ---------------------------------------------------------------

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scaleV = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => scaleV(a, 1 / (norm(a) || 1));

/** Two unit vectors perpendicular to `d` and to each other. */
export function perpendicular(d: Vec3): [Vec3, Vec3] {
  const n = unit(d);
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(n, helper));
  return [e1, cross(n, e1)];
}

// --- projection ------------------------------------------------------------

/** Screen displacement of a lab displacement (screen y points down). */
export function projectVector(scale: number, [x, y, z]: Vec3): Point {
  return [scale * (z + RECEDE * x), -scale * (y + RECEDE * x)];
}

export function project(view: View, p: Vec3): Point {
  const [u, v] = projectVector(view.scale, p);
  return [view.cx + u, view.cy + v];
}

/** Unit vector from the scene towards the viewer (lines along it project to a point). */
export const TO_VIEWER: Vec3 = unit([-1, RECEDE, RECEDE]);

// --- beams -----------------------------------------------------------------

/**
 * Half-angle of the focused cone [rad], by the engine's own definitions
 * (api._beam_angle): NA = n sin θ; a waist W gives the paraxial divergence
 * tan θ = λ / (π n W) of the fundamental mode.
 */
export function coneHalfAngle(focus: Focus, wavelength: number, nMedium = 1): number {
  if (focus.NA != null) return Math.asin(Math.min(1, focus.NA / nMedium));
  if (focus.angle_deg != null) return (focus.angle_deg * Math.PI) / 180;
  return Math.atan(wavelength / (Math.PI * nMedium * focus.waist));
}

/** Waist radius drawn at the focus [m]: the given waist, or the paraxial one for the cone angle. */
export function waistRadius(focus: Focus, wavelength: number, nMedium = 1): number {
  if (focus.waist != null) return focus.waist;
  return wavelength / (Math.PI * nMedium * Math.tan(coneHalfAngle(focus, wavelength, nMedium)));
}

/** Radius of the drawn beam at distance `zeta` from the focus: a hyperbola from the waist to the cone. */
export function beamRadius(zeta: number, w0: number, theta: number): number {
  return Math.hypot(w0, zeta * Math.tan(theta));
}

export interface BeamShape {
  /** m */
  w0: number;
  /** rad */
  theta: number;
  /** distance of the lens from the focus, upstream [m]. The lens is a symbol: this is not the focal length. */
  lensDistance: number;
  /** m */
  lensRadius: number;
}

/** Where the lens symbol sits on a beam so that it fits the view. */
export function beamShape(beam: BeamField, nMedium: number, view: View, box: Box): BeamShape {
  const theta = coneHalfAngle(beam.focus, beam.wavelength, nMedium);
  const w0 = waistRadius(beam.focus, beam.wavelength, nMedium);
  const w = box.width - box.inset.left - box.inset.right;
  const h = box.height - box.inset.top - box.inset.bottom;
  const [au, av] = projectVector(1, unit(directionOf(beam)));
  const len = Math.hypot(au, av) || 1;
  // room along the beam on screen, and across it
  const along = 0.4 * (Math.abs(au / len) * w + Math.abs(av / len) * h);
  const across = 0.36 * (Math.abs(av / len) * w + Math.abs(au / len) * h);
  const w0px = w0 * view.scale;
  const tan = Math.tan(theta);
  const reach = across > w0px ? Math.sqrt(across * across - w0px * w0px) / tan : 0;
  const distancePx = Math.max(Math.min(reach, along), 0.12 * along);
  const lensDistance = distancePx / (view.scale * len);
  return { w0, theta, lensDistance, lensRadius: 1.1 * beamRadius(lensDistance, w0, theta) };
}

// --- view ------------------------------------------------------------------

/** "focus": the scale of the optical focus (µm). "electrodes": the scale of a Paul trap (mm). */
export type ScaleMode = "focus" | "electrodes";

export function fitView(setup: Setup, box: Box): View & { mode: ScaleMode } {
  const w = Math.max(40, box.width - box.inset.left - box.inset.right);
  const h = Math.max(40, box.height - box.inset.top - box.inset.bottom);
  const cx = box.inset.left + w / 2;
  const cy = box.inset.top + h / 2;
  const n = environmentOf(setup).medium_index;
  const pauls = setup.trap.fields.filter((f) => f.kind === "paul");
  if (pauls.length) {
    const r0 = Math.max(...pauls.map((p) => p.r0));
    const z0 = Math.max(...pauls.map((p) => p.z0));
    const halfZ = z0 + 1.6 * r0;
    const halfY = 2.3 * r0;
    return { scale: Math.min((0.46 * w) / halfZ, (0.46 * h) / halfY), cx, cy, mode: "electrodes" };
  }
  const beams = setup.trap.fields.filter((f): f is BeamField => f.kind === "beam");
  const waistPx = Math.min(56, Math.max(26, 0.1 * Math.min(w, 1.6 * h)));
  if (!beams.length) return { scale: waistPx / (4 * setup.particle.radius), cx, cy, mode: "focus" };
  const scale = Math.min(
    ...beams.map((b) => {
      const w0 = waistRadius(b.focus, b.wavelength, n);
      const rayleigh = w0 / Math.tan(coneHalfAngle(b.focus, b.wavelength, n));
      return Math.min(waistPx / w0, (0.22 * w) / rayleigh);
    }),
  );
  return { scale, cx, cy, mode: "focus" };
}

/** A round length (1, 2 or 5 × 10ⁿ m) that draws near `targetPx`. */
export function scaleBar(scale: number, targetPx = 110): { metres: number; px: number; label: string } {
  const ideal = targetPx / scale;
  const decade = 10 ** Math.floor(Math.log10(ideal));
  const metres = [1, 2, 5, 10]
    .map((m) => m * decade)
    .reduce((best, m) => (Math.abs(Math.log(m / ideal)) < Math.abs(Math.log(best / ideal)) ? m : best));
  return { metres, px: metres * scale, label: formatSI(metres, "m", 3, true) };
}

// --- shapes ----------------------------------------------------------------

const cross2 = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];

/** Outline of a disc of `radius` around `centre`, perpendicular to `normal`. */
export function discPoints(view: View, centre: Vec3, normal: Vec3, radius: number, segments = 48, from = 0, to = 2 * Math.PI): Point[] {
  const [e1, e2] = perpendicular(normal);
  const c = project(view, centre);
  const a = projectVector(view.scale * radius, e1);
  const b = projectVector(view.scale * radius, e2);
  const points: Point[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = from + ((to - from) * i) / segments;
    points.push([c[0] + Math.cos(t) * a[0] + Math.sin(t) * b[0], c[1] + Math.cos(t) * a[1] + Math.sin(t) * b[1]]);
  }
  return points;
}

/**
 * A cylinder from `c0` to `c1`: `body` is its silhouette, `face` the end
 * that faces the viewer (draw it over the body).
 */
export function cylinder(view: View, c0: Vec3, c1: Vec3, radius: number): { body: Point[]; face: Point[] } {
  const axis = sub(c1, c0);
  const [near, far] = dot(axis, TO_VIEWER) >= 0 ? [c1, c0] : [c0, c1];
  const [e1, e2] = perpendicular(axis);
  const a = projectVector(view.scale * radius, e1);
  const b = projectVector(view.scale * radius, e2);
  const along = projectVector(view.scale, sub(near, far));
  // where the end ellipse's tangent runs along the axis: the silhouette lines start there
  const t0 = Math.atan2(cross2(b, along), cross2(a, along));
  const at = (c: Vec3, t: number): Point => {
    const p = project(view, c);
    return [p[0] + Math.cos(t) * a[0] + Math.sin(t) * b[0], p[1] + Math.cos(t) * a[1] + Math.sin(t) * b[1]];
  };
  // the half of the far ellipse that looks away from the near end
  const mid: Point = [-Math.sin(t0) * a[0] + Math.cos(t0) * b[0], -Math.sin(t0) * a[1] + Math.cos(t0) * b[1]];
  const outward = mid[0] * along[0] + mid[1] * along[1] < 0;
  const start = outward ? t0 : t0 + Math.PI;
  const body: Point[] = [];
  const segments = 24;
  for (let i = 0; i <= segments; i += 1) body.push(at(far, start + (Math.PI * i) / segments));
  body.push(at(near, start + Math.PI), at(near, start));
  return { body, face: discPoints(view, near, axis, radius, 32) };
}

export function pathOf(points: Point[], close = true): string {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return close ? `${d}Z` : d;
}
