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
 * Without it the focus is the Gaussian of that NA, with no aperture. A filled
 * objective may carry an `aberration`.
 */
export type IdealFocus = { kind?: "lens"; mapping?: "ott" | "sine" } & (
  | { NA: number; filling?: number; aberration?: Aberration; waist?: never; angle_deg?: never }
  | { waist: number; NA?: never; angle_deg?: never; filling?: never; aberration?: never }
  | { angle_deg: number; NA?: never; waist?: never; filling?: never; aberration?: never }
);

/**
 * A filled objective's wavefront error (#83): Zernike terms (Noll-normalised)
 * in waves rms over its pupil, rho = sin θ / NA, the azimuth from x.
 */
export type Aberration = Partial<Record<"spherical" | "astigmatism_0" | "astigmatism_45" | "coma_x" | "coma_y", number>>;

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

/** The radiation pattern (levtrap.pattern.pattern_block), lab frame. Grids are flat lists. With
 * several beams (#76) it is the pattern of them all: a coherent group scatters its summed field,
 * groups that do not interfere add their light, collected powers and information. */
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
  /** NA of the trapping lens: the lens the first beam goes through, as wide as the widest beam going
   * the same way as the first (same direction, not merely the same axis), at most n_medium (#76, #97) */
  trap_NA?: number | null;
  /** the beams going the first beam's way, through the trapping lens (indices into trap.fields, #97) */
  trap_NA_fields?: number[] | null;
  /** the beam whose NA trap_NA is (index into trap.fields, #97) */
  trap_NA_field?: number | null;
  /** the first beam's direction (lab frame): the trapping lens looks back along −trap_axis (#76) */
  trap_axis?: Vec3 | null;
  /** at trap_NA: backward is the trapping lens itself (a cone about −trap_axis), forward a lens of the
   * same NA opposite it (about +trap_axis) (#75, #76) */
  at_trap_NA?: { forward: ConeFractions; backward: ConeFractions } | null;
}

/** What a lens collects: fractions of P_sca and of the 4π position information per axis. */
export interface ConeFractions {
  collection: number;
  information: { x: number; y: number; z: number };
}

/** Rates of one mode (rates.mode_rates). Heating rates are in phonons/s. */
export interface ModeRates {
  name: string;
  axis: Vec3;
  gas_heating: number | null;
  recoil_heating: number | null;
  /** the scattered photons' part of recoil_heating */
  recoil_scattered: number | null;
  /** the beam photons' part: what the sphere scatters from the incident field's gradient at
   * its position (#95); in a plane wave, shot noise along the beam */
  recoil_incident: number | null;
  /** their cross term (the interference of the two): negative for forward scattering (#78);
   * -2 (u·e_in)(u·<n>) in a plane wave */
  recoil_cross: number | null;
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
/** levtrap.solve._dynamics: linear stability with the full stiffness matrix and the gas damping (#101). */
export interface Dynamics {
  /** 1/s per mode (same order as Result.modes): the motion along it goes as exp(rate t); negative when damped */
  growth_rate: number[];
  /** some motion grows at this pressure: the particle spirals out */
  unstable: boolean;
  /** 1/s: the smallest damping that holds every motion; 0 without a curl */
  damping_needed: number;
  /** 1/s, at the setup's pressure */
  gas_damping: number;
  /** Pa: below it the motion grows; null without a curl, or when no gas pressure damps it enough */
  pressure_threshold: number | null;
  /** N/m: the antisymmetric part of K per block, (K_ij − K_ji) / 2; 0 below round-off */
  curl: { xy: number; xz: number; yz: number };
  /** the antisymmetric part's norm over the symmetric part's */
  curl_ratio: number;
  /** N/m, lab frame: K_ij = −∂F_i/∂x_j, curl included */
  K: number[][];
  notes: string[];
}

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
  /** direction moments of the scattered photons (lab frame) from the Mie pattern at the
   * equilibrium; absent when the dipole pattern was used (#78) */
  scattered_moments?: { mean: Vec3; second: [Vec3, Vec3, Vec3] };
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

/** One number per multipole of the scattered light (#80): ED, MD the electric
 * and magnetic dipole, EQ, MQ quadrupole, EO, MO octupole, "higher" n >= 4. */
export interface Multipoles {
  ED: number;
  MD: number;
  EQ: number;
  MQ: number;
  EO: number;
  MO: number;
  higher: number;
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
    /** plane-wave Q_sca per multipole (#80) */
    Qsca_multipoles?: Multipoles;
    /** W: the beams' own scattered power per multipole at the equilibrium; adds up to P_sca (#80) */
    P_sca_multipoles?: Multipoles;
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
  /** per coherent pair of beams; absent when no two beams interfere (#79) */
  coherent?: CoherentPair[];
  /** null when the trap has no beam */
  rates?: Rates | null;
  /**
   * The motion with the curl of the force and the gas damping (#101).
   * `stable` is static: the symmetric part of the stiffness matrix. This
   * says whether the motion still grows. null when not stable, or for a
   * Paul trap alone (no curl); absent in a Result from before #101.
   */
  dynamics?: Dynamics | null;
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

/**
 * A coherent pair of beams and the power split that darkens the focus
 * (levtrap.optics.dark_split, #79): equal intensities of the two beams at the
 * first beam's focus, which nulls the field there when the two fields are
 * antiparallel (a bottle beam: one circular polarisation, opposite phases).
 */
export interface CoherentPair {
  /** indices into trap.fields, in setup order */
  fields: [number, number];
  /** fraction of the pair's total power in the second beam; null when neither has a field at the focus */
  dark_split: number | null;
  /** |E|² left at the focus at that split, in the field the engine traps with (the pair rescaled to its total power), over the two beams' intensities there added: 0 a null, about 2 or more in phase */
  residual: number | null;
}

/** What `solve_json` returns. */
export type SolveResponse =
  | { ok: true; result: Result }
  | { ok: false; kind: "setup"; path: string; error: string }
  | { ok: false; kind: "unsupported" | "internal"; error: string };
