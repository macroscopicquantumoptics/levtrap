/**
 * Geometry of the 3D scene (D3). Lab frame as in the Setup: z is the optical
 * axis of the first beam, y is up. Lengths here are in metres; the scene
 * draws them in micrometres (WORLD), so that float32 holds a 0.2 µm waist and
 * a 3 mm electrode in one picture.
 *
 * The camera is orthographic: a length perpendicular to the view is drawn
 * at the same scale wherever it is, so the scale bar is true everywhere.
 */
import type { BeamField, PaulField, Setup, Vec3 } from "../../engine/types.ts";
import { directionOf, environmentOf, positionOf } from "../model.ts";
import { beamRadius, coneHalfAngle, cross, dot, norm, unit, waistRadius } from "./geometry.ts";

/** Scene units per metre: the scene is drawn in micrometres. */
export const WORLD = 1e6;

export const toWorld = (v: Vec3): Vec3 => [v[0] * WORLD, v[1] * WORLD, v[2] * WORLD];

// --- electrodes ----------------------------------------------------------------

/**
 * Rod radius over r0 that best mimics hyperbolic electrodes with round rods
 * (Denison, J. Vac. Sci. Technol. 8, 266 (1971)).
 */
export const ROD_RATIO = 1.145;

export type ElectrodeRole = "rf" | "ground" | "endcap";

export type Electrode =
  | { shape: "rod"; role: ElectrodeRole; name: string; from: Vec3; to: Vec3; radius: number }
  | { shape: "ring"; role: ElectrodeRole; name: string; centre: Vec3; axis: Vec3; inner: number; outer: number; thickness: number };

/**
 * The electrodes of a Paul trap, to scale with r0 and z0 [m].
 *
 * Linear (levtrap/fields/paul.py: the RF potential goes as x² − y²): four rods
 * along z whose surfaces are r0 from the axis, the RF pair on x, the grounded
 * pair on y; two ring end caps at ±z0, inside the rods, open so that light
 * along z passes. Ring: an RF ring of inner radius r0 in the x-y plane and two
 * open end caps on its axis at ±z0.
 */
export function electrodes(paul: PaulField): Electrode[] {
  const { r0, z0 } = paul;
  if (paul.geometry === "linear") {
    const a = ROD_RATIO * r0;
    const rho = r0 + a;
    const half = z0 + 0.5 * r0;
    const rod = (name: string, role: ElectrodeRole, x: number, y: number): Electrode => ({ shape: "rod", role, name, from: [x, y, -half], to: [x, y, half], radius: a });
    const cap = (name: string, z: number): Electrode => ({ shape: "ring", role: "endcap", name, centre: [0, 0, z], axis: [0, 0, 1], inner: 0.35 * r0, outer: 0.9 * r0, thickness: 0.2 * r0 });
    return [rod("RF +x", "rf", rho, 0), rod("RF −x", "rf", -rho, 0), rod("ground +y", "ground", 0, rho), rod("ground −y", "ground", 0, -rho), cap("end cap −z", -z0), cap("end cap +z", z0)];
  }
  const cap = (name: string, z: number): Electrode => ({ shape: "ring", role: "endcap", name, centre: [0, 0, z], axis: [0, 0, 1], inner: 0.25 * r0, outer: 1.2 * r0, thickness: 0.2 * r0 });
  return [{ shape: "ring", role: "rf", name: "RF ring", centre: [0, 0, 0], axis: [0, 0, 1], inner: r0, outer: 2 * r0, thickness: 0.4 * r0 }, cap("end cap −z", -z0), cap("end cap +z", z0)];
}

/** Half the size of the box that holds a Paul trap's electrodes, per lab axis [m]. */
export function electrodeExtent(paul: PaulField): Vec3 {
  let e: Vec3 = [0, 0, 0];
  for (const el of electrodes(paul)) {
    const r = el.shape === "rod" ? el.radius : el.outer;
    const ends = el.shape === "rod" ? [el.from, el.to] : [el.centre];
    const along = el.shape === "rod" ? 0 : el.thickness / 2;
    for (const p of ends) {
      // a rod or ring along z: its radius spreads in x and y
      e = [Math.max(e[0], Math.abs(p[0]) + r), Math.max(e[1], Math.abs(p[1]) + r), Math.max(e[2], Math.abs(p[2]) + along)];
    }
  }
  return e;
}

// --- beams ---------------------------------------------------------------------

export interface BeamGeometry {
  /** unit propagation direction */
  direction: Vec3;
  /** focus [m] */
  focus: Vec3;
  /** waist radius [m] */
  w0: number;
  /** cone half-angle [rad] */
  theta: number;
}

export function beamGeometry(beam: BeamField, nMedium: number): BeamGeometry {
  return {
    direction: unit(directionOf(beam)),
    focus: positionOf(beam),
    w0: waistRadius(beam.focus, beam.wavelength, nMedium),
    theta: coneHalfAngle(beam.focus, beam.wavelength, nMedium),
  };
}

/**
 * How far upstream of the focus the lens is drawn [m]: where the cone is 40 %
 * of the view's half-size wide, kept within the view. The lens is a symbol of
 * the focusing optic; its distance is not the focal length.
 */
export function lensDistance(w0: number, theta: number, halfView: number): number {
  const wide = 0.4 * halfView;
  const reach = wide > w0 ? Math.sqrt(wide * wide - w0 * w0) / Math.tan(theta) : 0;
  return Math.min(Math.max(reach, 0.2 * halfView), 0.9 * halfView);
}

/**
 * The beam's radius along its axis, from `from` to `to` [m] from the focus,
 * sampled densely at the waist (where it changes fastest) and sparsely far
 * from it: the samples are uniform in asinh(ζ / z_R).
 */
export function beamProfile(w0: number, theta: number, from: number, to: number, samples = 96): [number, number][] {
  const zR = w0 / Math.tan(theta);
  const a = Math.asinh(from / zR);
  const b = Math.asinh(to / zR);
  const out: [number, number][] = [];
  for (let i = 0; i <= samples; i += 1) {
    const zeta = zR * Math.sinh(a + ((b - a) * i) / samples);
    out.push([zeta, beamRadius(zeta, w0, theta)]);
  }
  return out;
}

// --- camera ----------------------------------------------------------------------

export type ViewName = "fit" | "along" | "side";

export interface Fit {
  /** px per metre */
  pxPerMetre: number;
  /** the point the camera looks at and turns about [m] */
  target: Vec3;
  /** half the size of the drawn trap [m] */
  halfView: number;
  /** the scale the trap is drawn at */
  mode: "focus" | "electrodes";
}

/** The area the drawing may use, in px. */
export interface Room {
  width: number;
  height: number;
}

/** The scale and centre that show the whole trap in `room`. */
export function fitScene(setup: Setup, room: Room): Fit {
  const w = Math.max(40, room.width);
  const h = Math.max(40, room.height);
  const n = environmentOf(setup).medium_index;
  const pauls = setup.trap.fields.filter((f): f is PaulField => f.kind === "paul");
  if (pauls.length) {
    const ext = pauls.map(electrodeExtent).reduce((a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]);
    // the oblique view shows z across and x, y up: fit the larger of each
    const across = ext[2] + 0.4 * ext[0];
    const up = Math.max(ext[1], ext[0]) * 1.1;
    const pxPerMetre = Math.min((0.46 * w) / across, (0.42 * h) / up);
    return { pxPerMetre, target: [0, 0, 0], halfView: Math.max(...ext), mode: "electrodes" };
  }
  const beams = setup.trap.fields.filter((f): f is BeamField => f.kind === "beam");
  const waistPx = Math.min(56, Math.max(26, 0.1 * Math.min(w, 1.6 * h)));
  if (!beams.length) {
    const r = setup.particle.radius;
    return { pxPerMetre: waistPx / (4 * r), target: [0, 0, 0], halfView: 40 * r, mode: "focus" };
  }
  const geometries = beams.map((b) => beamGeometry(b, n));
  const pxPerMetre = Math.min(...geometries.map((g) => Math.min(waistPx / g.w0, (0.22 * w) / (g.w0 / Math.tan(g.theta)))));
  return { pxPerMetre, target: geometries[0].focus, halfView: (0.5 * Math.min(w, 1.6 * h)) / pxPerMetre, mode: "focus" };
}

const UP: Vec3 = [0, 1, 0];

/**
 * Where the camera looks from (a unit vector from the target to the camera).
 * Fit: obliquely, from above and in front, with the beam running across.
 * Along: from upstream of the first beam (or along the Paul trap's axis).
 * Side: perpendicular to the beam and to up, the beam running left to right.
 */
export function viewDirection(view: ViewName, setup: Setup): Vec3 {
  const beam = setup.trap.fields.find((f): f is BeamField => f.kind === "beam");
  const axis = beam ? unit(directionOf(beam)) : ([0, 0, 1] as Vec3);
  if (view === "along") {
    const d: Vec3 = [-axis[0], -axis[1], -axis[2]];
    // straight down the vertical is a degenerate view for a camera with y up: tilt it a hair
    return Math.abs(d[1]) > 0.999 ? unit([0, d[1], 1e-3]) : d;
  }
  const side = cross(axis, UP);
  const s: Vec3 = norm(side) > 1e-6 ? unit(side) : [-1, 0, 0];
  if (view === "side") return s;
  // oblique: from the side, raised by 30°, and turned 20° towards the beam's source
  const back: Vec3 = [-axis[0], -axis[1], -axis[2]];
  const flat = unit([s[0] + 0.36 * back[0], s[1] + 0.36 * back[1], s[2] + 0.36 * back[2]]);
  const raised = unit([flat[0], flat[1] + 0.58, flat[2]]);
  return Math.abs(dot(raised, UP)) > 0.999 ? unit([raised[0] + 1e-3, raised[1], raised[2]]) : raised;
}

// --- a real lens (focus.kind "asphere") ------------------------------------------

/** levtrap.optics.beam_rotation: the smallest rotation taking +z to `d`; −z is 180° about x. 3×3, row-major. */
export function beamRotation(direction: Vec3): number[][] {
  const d = unit(direction);
  const c = d[2];
  if (c > 1 - 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1 + 1e-12) return [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const axis = cross([0, 0, 1], d);
  const s = norm(axis);
  const k = [axis[0] / s, axis[1] / s, axis[2] / s];
  const K = [
    [0, -k[2], k[1]],
    [k[2], 0, -k[0]],
    [-k[1], k[0], 0],
  ];
  const KK = K.map((row, i) => row.map((_, j) => K[i][0] * K[0][j] + K[i][1] * K[1][j] + K[i][2] * K[2][j]));
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + s * K[i][j] + (1 - c) * KK[i][j]));
}

const matVec = (M: number[][], v: Vec3): Vec3 => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]) as Vec3;

/** levtrap.lens._rot: about x by tx, then about y by ty [deg]. */
export function tiltRotation(tx: number, ty: number): number[][] {
  const [a, b] = [(tx * Math.PI) / 180, (ty * Math.PI) / 180];
  const Rx = [
    [1, 0, 0],
    [0, Math.cos(a), -Math.sin(a)],
    [0, Math.sin(a), Math.cos(a)],
  ];
  const Ry = [
    [Math.cos(b), 0, Math.sin(b)],
    [0, 1, 0],
    [-Math.sin(b), 0, Math.cos(b)],
  ];
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => Ry[i][0] * Rx[0][j] + Ry[i][1] * Rx[1][j] + Ry[i][2] * Rx[2][j]));
}

export interface LensPlacement {
  /** back focal length of the aligned lens [m]: the S2 vertex is this far before the aligned focus */
  bfl: number;
  /** centre thickness [m] */
  thickness: number;
  tilt: [number, number];
  /** [m] */
  decentre: [number, number];
}

/**
 * Where a point of the lens goes in the lab [m]. `p` is in the lens's own
 * frame (levtrap.lens.trace: S1 vertex at the origin, the axis along +z);
 * the lens is tilted about its centre and decentred as the engine traces it,
 * then placed so the aligned lens focuses at the beam's position, along its
 * direction.
 */
export function lensToLab(p: Vec3, beam: { direction: Vec3; position: Vec3 }, lens: LensPlacement): Vec3 {
  const t = lens.thickness;
  const pivot: Vec3 = [0, 0, t / 2];
  const R = tiltRotation(lens.tilt[0], lens.tilt[1]);
  const q = matVec(R, [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]);
  // the beam's own frame: origin at the aligned focus, S1 vertex at z = −(bfl + t)
  const own: Vec3 = [q[0] + pivot[0] + lens.decentre[0], q[1] + pivot[1] + lens.decentre[1], q[2] + pivot[2] - (lens.bfl + t)];
  const lab = matVec(beamRotation(beam.direction), own);
  return [lab[0] + beam.position[0], lab[1] + beam.position[1], lab[2] + beam.position[2]];
}
