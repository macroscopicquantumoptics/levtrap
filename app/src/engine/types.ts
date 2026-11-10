// Setup and Result, version 1: the contract between the screen and the engine.
// Mirrors src/levtrap/setup.py and src/levtrap/solve.py (docs/ARCHITECTURE.md §4, §6).
// Everything is SI; particle charge is in elementary charges.

export type Vec3 = [number, number, number];

export type Material = "SiO2" | (string & {});
export type Gas = "N2" | "He" | "air";
export type JonesVector = [[number, number], [number, number]];
export type Polarisation = "x" | "y" | "circular+" | "circular-" | JonesVector;

export interface Particle {
  radius: number; // m
  material?: Material | null; // fills n, k, density at the beam wavelength
  n?: number | null;
  k?: number | null;
  density?: number | null; // kg/m³
  charge?: number; // e
}

export interface Environment {
  pressure?: number; // Pa
  temperature?: number; // K
  gas?: Gas;
  medium_index?: number;
}

/** Exactly one of NA, waist or angle_deg. */
export type Focus =
  | { kind?: "lens"; NA: number; waist?: never; angle_deg?: never }
  | { kind?: "lens"; waist: number; NA?: never; angle_deg?: never }
  | { kind?: "lens"; angle_deg: number; NA?: never; waist?: never };

export interface BeamMode {
  type?: "lg" | "hg";
  indices?: [number, number];
}

export interface BeamField {
  kind: "beam";
  id?: string;
  wavelength: number; // m
  power: number; // W
  focus: Focus;
  mode?: BeamMode;
  polarisation?: Polarisation;
  direction?: Vec3; // propagation axis
  position?: Vec3; // focus point, m
  phase?: number; // rad
  coherent_with?: string | null;
}

export interface PaulField {
  kind: "paul";
  id?: string;
  geometry: "linear" | "ring";
  rf_voltage: number; // V amplitude
  rf_frequency: number; // Hz
  dc_voltage?: number; // V
  endcap_voltage?: number; // V
  r0: number; // m
  z0: number; // m
  geometry_factors?: { radial?: number; axial?: number };
}

export interface GravityField {
  kind: "gravity";
  id?: string;
  g?: Vec3; // m/s²
}

export type Field = BeamField | PaulField | GravityField;

export interface Setup {
  version: 1;
  particle: Particle;
  environment?: Environment;
  trap: { fields: Field[] };
}

// ---------------------------------------------------------------------------

export interface Mode {
  /** Nearest lab axis, "x" | "y" | "z". */
  name?: string;
  axis: Vec3; // unit vector
  frequency: number | null; // Hz; null where the stiffness is not positive
  stiffness: number | null; // N/m
  depth?: number | null; // J
}

export interface ModelEntry {
  quantity: string;
  model: string;
  validity: "ok" | "marginal" | "invalid" | (string & {});
  notes: string[];
}

export interface Curve {
  position: number[]; // m
  force: number[]; // N
}

export interface Result {
  version: 1;
  engine?: string;
  stable: boolean;
  equilibrium: Vec3 | null;
  modes: Mode[];
  depth: { J: number; K: number; kT: number };
  particle?: { n: number; k: number; density: number; mass: number };
  optical?: {
    P_sca: number;
    P_abs: number;
    power?: number;
    Qext?: number;
    Qsca: number;
    Qabs: number;
    size_parameter?: number;
    Nmax?: { beam: number; particle: number };
  };
  paul?: Record<string, unknown>;
  rates?: Record<string, unknown>;
  pattern?: Record<string, unknown>;
  curves?: Record<string, Curve>;
  models: ModelEntry[];
  warnings: string[];
  time?: number; // s
}

/** Extra blocks to compute on request. */
export type Want = "curves";

/** How solve_json reports a failure. */
export interface EngineFailure {
  ok: false;
  kind: "setup" | "unsupported" | "internal";
  error: string;
  path?: string;
}

export type SolveReply = { ok: true; result: Result } | EngineFailure;
