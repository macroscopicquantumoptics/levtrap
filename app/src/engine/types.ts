/**
 * Setup and Result, version 1: the only contract between the screen and the
 * engine (docs/ARCHITECTURE.md §4 and §6). Mirrors src/levtrap/setup.py and
 * src/levtrap/solve.py. Plain JSON, SI units, charge in elementary charges.
 *
 * Optional keys are those `setup.parse` fills with a default; the engine
 * accepts a setup that leaves them out.
 */

export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Setup (setup.py)
// ---------------------------------------------------------------------------

export type Gas = "N2" | "He" | "air";

export interface Particle {
  /** m */
  radius: number;
  /** Name from levtrap.materials, e.g. "SiO2"; n, k and density default to it. */
  material?: string | null;
  n?: number | null;
  k?: number | null;
  /** kg/m³ */
  density?: number | null;
  /** elementary charges */
  charge?: number;
}

export interface Environment {
  /** Pa, default 1e-4 */
  pressure?: number;
  /** K, default 300 */
  temperature?: number;
  gas?: Gas;
  /** default 1 */
  medium_index?: number;
}

/** Give exactly one of NA, waist [m] or angle_deg. */
export type Focus = { kind?: "lens" } & (
  | { NA: number; waist?: never; angle_deg?: never }
  | { waist: number; NA?: never; angle_deg?: never }
  | { angle_deg: number; NA?: never; waist?: never }
);

export interface BeamMode {
  type?: "lg" | "hg";
  /** LG: [p, l]; HG: [m, n] */
  indices?: [number, number];
}

/** Jones vector [[re, im], [re, im]] in the beam's own (x, y) frame. */
export type Jones = [[number, number], [number, number]];
export type Polarisation = "x" | "y" | "circular+" | "circular-" | Jones;

interface FieldBase {
  /** Unique within the trap; required to be referenced by `coherent_with`. */
  id?: string;
}

export interface BeamField extends FieldBase {
  kind: "beam";
  /** m, in vacuum */
  wavelength: number;
  /** W */
  power: number;
  focus: Focus;
  mode?: BeamMode;
  polarisation?: Polarisation;
  /** propagation axis, default [0, 0, 1] */
  direction?: Vec3;
  /** focus point [m], default origin */
  position?: Vec3;
  /** rad */
  phase?: number;
  /** id of another beam this one interferes with */
  coherent_with?: string | null;
}

export interface PaulField extends FieldBase {
  kind: "paul";
  geometry: "linear" | "ring";
  /** V, amplitude */
  rf_voltage: number;
  /** Hz */
  rf_frequency: number;
  /** V */
  dc_voltage?: number;
  /** V */
  endcap_voltage?: number;
  /** m */
  r0: number;
  /** m */
  z0: number;
  geometry_factors?: { radial?: number; axial?: number };
}

export interface GravityField extends FieldBase {
  kind: "gravity";
  /** m/s², default [0, -9.81, 0] (y is up) */
  g?: Vec3;
}

export type Field = BeamField | PaulField | GravityField;

export interface Setup {
  version: 1;
  particle: Particle;
  environment?: Environment;
  trap: { fields: Field[] };
}

// ---------------------------------------------------------------------------
// Result (solve.py)
// ---------------------------------------------------------------------------

/** Extra blocks `solve` computes only on request (solve.WANTS). */
export type Want = "curves";

export interface TrapMode {
  /** "x" | "y" | "z" while the solver works along the lab axes */
  name: string;
  /** unit vector */
  axis: Vec3;
  /** Hz; null where the stiffness is not positive */
  frequency: number | null;
  /** N/m */
  stiffness: number | null;
  /** J, to the nearest barrier along this axis */
  depth: number | null;
}

export interface ModelInfo {
  quantity: string;
  model: string;
  validity: string;
  notes: string[];
}

export interface Curve {
  /** m */
  position: number[];
  /** N */
  force: number[];
}

export interface Result {
  version: 1;
  /** levtrap version that computed it */
  engine: string;
  stable: boolean;
  /** m; null when there is no equilibrium */
  equilibrium: Vec3 | null;
  modes: TrapMode[];
  /** the smallest depth over the modes; zero when not stable */
  depth: { J: number; K: number; kT: number };
  /** resolved from the material; mass in kg */
  particle: { n: number; k: number; density: number; mass: number };
  optical: {
    P_sca: number;
    P_abs: number;
    power: number;
    Qext: number;
    Qsca: number;
    Qabs: number;
    size_parameter: number;
    Nmax: number;
  };
  models: ModelInfo[];
  /** sentences, ready to show */
  warnings: string[];
  /** s, engine wall time */
  time: number;
  curves?: { x: Curve; y: Curve; z: Curve };
}

/** What `solve_json` returns. */
export type SolveResponse =
  | { ok: true; result: Result }
  | { ok: false; kind: "setup"; path: string; error: string }
  | { ok: false; kind: "unsupported" | "internal"; error: string };
