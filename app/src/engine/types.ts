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

/**
 * An ideal lens: give exactly one of NA, waist [m] or angle_deg. With NA,
 * `filling` makes it an aplanatic objective whose aperture (sin θ = NA / n)
 * the beam fills: its 1/e² radius is `filling` times the aperture's (#61).
 * Without it the focus is the Gaussian of that NA, with no aperture.
 */
export type IdealFocus = { kind?: "lens" } & (
  | { NA: number; filling?: number; waist?: never; angle_deg?: never }
  | { waist: number; NA?: never; angle_deg?: never; filling?: never }
  | { angle_deg: number; NA?: never; waist?: never; filling?: never }
);

/**
 * A real lens, ray traced (levtrap.lens): the beam is collimated,
 * `beam_diameter` [m] across on the lens (1/e² intensity). The beam's
 * `position` is where the aligned lens focuses; a tilt [deg, about x and y,
 * about the lens's centre] or a decentre [m] moves the focus.
 */
export interface AsphereFocus {
  kind: "asphere";
  lens?: "354330-C";
  beam_diameter: number;
  tilt_deg?: [number, number];
  decentre?: [number, number];
  NA?: never;
  waist?: never;
  angle_deg?: never;
}

/**
 * A parabolic mirror (levtrap.mirror): the collimated beam, `beam_diameter`
 * [m] across (1/e² intensity), is reflected to the focus, the beam's
 * `position`. Lengths in m; a rim beyond twice the focal length is above the
 * focal plane (a deep mirror, light from beyond 90°). The beam's `direction`
 * points from the mirror's vertex through the focus.
 */
export interface MirrorFocus {
  kind: "parabolic_mirror";
  focal_length: number;
  rim_radius: number;
  hole_radius?: number;
  beam_diameter: number;
  NA?: never;
  waist?: never;
  angle_deg?: never;
}

export type Focus = IdealFocus | AsphereFocus | MirrorFocus;

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
export type Want = "curves" | "dipole" | "pattern" | "field" | "lens";

export interface TrapMode {
  /** the lab axis the eigen-axis is nearest to: "x" | "y" | "z" */
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

/** A force cut through the equilibrium along one eigen-axis (solve._curves). */
export interface Curve {
  /** unit vector; absent in results recorded before D5 (then the lab axis of its name) */
  axis?: Vec3;
  /** m, the coordinate along the axis */
  position: number[];
  /** N, along the axis */
  force: number[];
  /** N, the same with the light in the dipole approximation (want "dipole") */
  dipole?: number[];
}

/** The radiation pattern (levtrap.pattern.pattern_block). Grids are flat lists. */
export interface Pattern {
  frame: string;
  grid: { theta: number[]; phi: number[]; weight: number[] };
  /** W/sr */
  scattered: number[];
  total: number[];
  /** W/(sr m²), per axis */
  information: { x: number[]; y: number[]; z: number[] };
  P_sca: number;
  P_total: number;
  information_total: { x: number; y: number; z: number };
  /** numerical apertures of the collection lens */
  NA: number[];
  directions: Record<string, Vec3>;
  /** fraction of P_sca collected by a lens of each NA, per direction */
  collection: Record<string, number[]>;
  /** fraction of the position information collected, per direction and axis */
  information_efficiency: Record<string, { x: number[]; y: number[]; z: number[] }>;
  /** NA of the trapping lens, and what it collects looking back at the particle */
  trap_NA?: number | null;
  at_trap_NA?: Record<string, unknown> | null;
}

/** Rates of one mode (rates.mode_rates). Heating rates are in phonons/s. */
export interface ModeRates {
  name: string;
  axis: Vec3;
  gas_heating: number | null;
  recoil_heating: number | null;
  recoil_scattered: number | null;
  recoil_incident: number | null;
  /** gas + recoil */
  reheating: number | null;
  Q: number | null;
  /** s */
  coherence_time: number | null;
  coherent_oscillations: number | null;
  /** Pa: below this pressure recoil heating exceeds gas heating */
  crossover_pressure: number | null;
}

/** The `rates` block (rates.rates_block). */
export interface Rates {
  gas: {
    species: Gas;
    /** Pa */
    pressure: number;
    /** K */
    temperature: number;
    /** kg */
    molecular_mass: number;
    /** Pa s */
    viscosity: number;
    /** m */
    mean_free_path: number;
    knudsen: number;
  };
  /** 1/s, the Knudsen-number interpolation used for the heating rates */
  gas_damping: number;
  /** 1/s, continuum limit */
  stokes_damping: number;
  /** 1/s, free-molecular limit */
  epstein_damping: number;
  /** phonons/s per mode */
  recoil_heating: (number | null)[];
  reheating_phonons_per_s: (number | null)[];
  modes: ModeRates[];
  /** W */
  P_sca: number;
  P_abs: number;
}

/** Per lab axis. */
export type PerAxis<T> = { x: T; y: T; z: T };

/**
 * The `paul` block of a Paul-trap result (solve._solve_paul, conventions in
 * levtrap/fields/paul.py: Leibfried et al., Rev. Mod. Phys. 75, 281 (2003)).
 */
export interface PaulResult {
  /** Mathieu a per axis */
  a: PerAxis<number>;
  /** Mathieu q per axis (signed) */
  q: PerAxis<number>;
  /** every axis is stable (with light: the RF drives no parametric resonance) */
  stable: boolean;
  /**
   * Secular frequencies [Hz] of the Paul trap alone; `exact` is null on an
   * axis outside the stability region. With light, `with_light` holds the
   * exact frequency of the hybrid trap (null: a parametric resonance), and
   * `a_effective` the Mathieu a the light's static force adds up to.
   */
  secular: {
    pseudopotential: PerAxis<number | null>;
    exact: PerAxis<number | null>;
    with_light?: Partial<PerAxis<number | null>>;
  };
  a_effective?: Partial<PerAxis<number>>;
  /** micromotion amplitude at the equilibrium [m]; null without an equilibrium */
  micromotion: Vec3 | null;
}

/** What a real lens does to its beam (solve._lens_block). */
export interface LensResult {
  /** index into trap.fields */
  field: number;
  lens: string;
  /** m, lab frame: where the best focus went, from the aligned lens's */
  focus_shift: Vec3;
  /** mrad: angle between the trap's axial mode and the beam */
  trap_axis_tilt_mrad: number | null;
  /** fraction of the beam's power through the lens */
  transmitted: number;
  clipping_loss: number;
  /** rms wavefront error about the best focus, in waves */
  rms_waves: number;
  rms_waves_untilted: number;
  n_glass: number;
  /** m, of the aligned lens */
  back_focal_length: number;
  /** mrad, the light's mean direction in the beam's frame (x, y) */
  pointing_mrad: [number, number];
  /** on request (want "lens"): two fans of traced rays, lab frame */
  rays?: TracedRay[];
  /** on request (want "lens"): the wavefront error about the best focus, on the input ray grid */
  wavefront?: Wavefront;
}

/** One traced ray (api.lens_detail): from the incoming beam, to the front and back surfaces, to the best-focus plane [m]. */
export interface TracedRay {
  fan: "x" | "y";
  /** the input intensity, 1 on the axis */
  weight: number;
  points: Vec3[];
}

/** The wavefront error W [waves] on the input grid x, y [m]; null where no ray passes. */
export interface Wavefront {
  x: number[];
  y: number[];
  /** W[j][i] at (x[i], y[j]) */
  W: (number | null)[][];
  /** the input intensity at each node; the rms of W weighted by it is rms_waves */
  weight: number[][];
}

export type SlicePlane = "xz" | "yz" | "xy";

/** The light's intensity on the lab planes through the trap (solve._field_block, want "field"). */
export interface FieldBlock {
  /** m: the planes pass through here (the equilibrium, or the searched centre) */
  centre: Vec3;
  planes: Record<SlicePlane, {
    /** m, along the plane's first lab axis (absolute) */
    u: number[];
    /** m, along its second */
    v: number[];
    /** W/m², I[j][i] at (u[i], v[j]) */
    I: number[][];
  }>;
  /** W/m², the largest on any plane */
  max: number;
}

/** What a parabolic mirror does to its beam (api.mirror_focus). */
export interface MirrorResult {
  /** index into trap.fields */
  field: number;
  /** fraction of the input beam's power reflected to the focus (inside the rim, outside the hole) */
  reflected: number;
  clipping_loss: number;
  /** deg from the axis behind the focus, as seen from the focus */
  rim_angle_deg: number;
  hole_angle_deg: number;
  /** the rim is above the focal plane */
  deep: boolean;
  Nmax: number;
}

/** One field's share at the equilibrium (solve.breakdown). */
export interface FieldShare {
  kind: "beam" | "paul" | "gravity";
  /** indices into trap.fields (a coherent group of beams is one share) */
  fields: number[];
  /** N */
  force: Vec3;
  /** N/m, along each mode's axis, by mode name */
  stiffness: Record<string, number>;
}

export interface Result {
  version: 1;
  /** with a start (continuation): where the search began, and whether the followed trap vanished */
  followed?: { start: Vec3; jumped: boolean };
  /** levtrap version that computed it */
  engine: string;
  stable: boolean;
  /** m; null when there is no equilibrium */
  equilibrium: Vec3 | null;
  /** empty when there is no equilibrium */
  modes: TrapMode[];
  /** the smallest depth over the modes; zero when not stable */
  depth: { J: number; K: number; kT: number };
  /** n and k resolved from the material at the beam's wavelength (null without a beam); mass in kg */
  particle: { n: number | null; k: number | null; density: number; mass: number; charge?: number };
  /** null when the trap has no beam */
  optical: {
    /** W, at the equilibrium */
    P_sca: number;
    P_abs: number;
    power: number;
    /** plane-wave Mie efficiencies */
    Qext: number;
    Qsca: number;
    Qabs: number;
    size_parameter: number;
    Nmax: { beam: number; particle: number };
  } | null;
  /** present for a Paul trap */
  paul?: PaulResult | null;
  /** per beam focused by a real lens (focus.kind "asphere") */
  lenses?: LensResult[];
  /** on request (want "field"): the light's intensity on the lab planes; null without light */
  field?: FieldBlock | null;
  /** per beam focused by a parabolic mirror */
  mirrors?: MirrorResult[];
  /** each field's force and stiffness at the equilibrium; absent without one */
  breakdown?: FieldShare[];
  /** null when the trap has no beam */
  rates?: Rates | null;
  models: ModelInfo[];
  /** sentences, ready to show */
  warnings: string[];
  /** s, engine wall time */
  time: number;
  /** on request: keyed by mode name */
  curves?: Record<string, Curve>;
  /** on request; see levtrap.pattern.pattern_block */
  pattern?: Pattern;
}

/** What `solve_json` returns. */
export type SolveResponse =
  | { ok: true; result: Result }
  | { ok: false; kind: "setup"; path: string; error: string }
  | { ok: false; kind: "unsupported" | "internal"; error: string };
