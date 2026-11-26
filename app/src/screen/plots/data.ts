/**
 * The data behind the drawer's plots, from a Result: pure functions, tested
 * in data.test.ts.
 */
import type { ConeFractions, Pattern, Result, Setup, Vec3 } from "../../engine/types.ts";
import { gasDamping, gasHeating, KB, logSpace } from "../../lib/gas.ts";
import { environmentOf, partsOf } from "../model.ts";

const LAB: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export interface AxisCut {
  /** the mode's name, "x", "y" or "z" */
  name: string;
  axis: Vec3;
  /** displacement from the equilibrium along the axis [m] */
  s: number[];
  /** force along the axis [N] */
  force: number[];
  /** the same with the light as a dipole [N] */
  dipole?: number[];
  /** the mode's stiffness [N/m]; null when not positive */
  stiffness: number | null;
}

/** The force cuts through the equilibrium, one per eigen-axis. */
export function axisCuts(result: Result): AxisCut[] {
  if (!result.curves) return [];
  return Object.entries(result.curves).map(([name, c]) => {
    const axis = c.axis ?? LAB[name] ?? [0, 0, 1];
    const centre = result.equilibrium ? dot(result.equilibrium, axis) : (c.position[0] + c.position[c.position.length - 1]) / 2;
    const mode = result.modes.find((m) => m.name === name);
    return { name, axis, s: c.position.map((p) => p - centre), force: c.force, dipole: c.dipole, stiffness: mode?.stiffness ?? null };
  });
}

/**
 * The potential along a cut, U(s) = −∫₀ˢ F ds′ from the equilibrium, by the
 * trapezoid rule, in units of k_B T.
 */
export function potential(s: number[], force: number[], temperature: number): number[] {
  const kT = KB * temperature;
  const n = s.length;
  const U = new Array<number>(n).fill(0);
  // start from the sample nearest the equilibrium, and integrate out both ways
  let i0 = 0;
  for (let i = 1; i < n; i += 1) if (Math.abs(s[i]) < Math.abs(s[i0])) i0 = i;
  // the step from s = 0 to that sample, with F linear in between
  const f0 = i0 + 1 < n && s[i0 + 1] !== s[i0] ? force[i0] - (s[i0] * (force[i0 + 1] - force[i0])) / (s[i0 + 1] - s[i0]) : force[i0];
  U[i0] = -0.5 * (f0 + force[i0]) * s[i0];
  for (let i = i0 + 1; i < n; i += 1) U[i] = U[i - 1] - 0.5 * (force[i] + force[i - 1]) * (s[i] - s[i - 1]);
  for (let i = i0 - 1; i >= 0; i -= 1) U[i] = U[i + 1] - 0.5 * (force[i] + force[i + 1]) * (s[i] - s[i + 1]);
  return U.map((u) => u / kT);
}

/** The harmonic potential ½ k s² of the trap's stiffness, in k_B T. */
export function harmonic(s: number[], stiffness: number, temperature: number): number[] {
  return s.map((x) => (0.5 * stiffness * x * x) / (KB * temperature));
}

export interface HeatingCurves {
  /** Pa */
  pressure: number[];
  modes: {
    name: string;
    /** phonons/s at each pressure */
    gas: number[];
    /** phonons/s, independent of pressure */
    recoil: number;
    total: number[];
    /** Pa, or null */
    crossover: number | null;
  }[];
  /** Pa: the setup's pressure */
  now: number;
}

/**
 * Heating rates against pressure, from 10⁻⁹ to 10³ mbar: the gas part scales
 * with the damping γ(p) (the Knudsen interpolation), the recoil part does not
 * depend on pressure. Everything else is the Result's.
 */
export function heatingCurves(result: Result, setup: Setup, points = 121): HeatingCurves | null {
  const rates = result.rates;
  if (!rates) return null;
  const env = environmentOf(setup);
  const pressure = logSpace(1e-7, 1e5, points); // Pa: 1e-9 to 1e3 mbar
  const R = setup.particle.radius;
  const m = result.particle.mass;
  const { viscosity, molecular_mass: gasMass } = rates.gas;
  const T = env.temperature;
  const gammas = pressure.map((p) => gasDamping(p, R, m, viscosity, gasMass, T));
  const modes = rates.modes.flatMap((mode) => {
    const f = result.modes.find((x) => x.name === mode.name)?.frequency;
    if (!f || mode.recoil_heating == null) return [];
    const omega = 2 * Math.PI * f;
    const gas = gammas.map((g) => gasHeating(g, T, omega));
    const recoil = mode.recoil_heating;
    return [{ name: mode.name, gas, recoil, total: gas.map((g) => g + recoil), crossover: mode.crossover_pressure }];
  });
  return { pressure, modes, now: env.pressure };
}

export interface PolarCut {
  /** angle from +z [rad], −π … π: positive on the +x (or +y) side */
  angle: number[];
  /** W/sr */
  value: number[];
}

/**
 * The scattered pattern in a plane through the beam axis: the x-z plane
 * (φ = 0 and π) or the y-z plane (φ = π/2 and 3π/2), as a closed polar curve.
 */
export function polarCut(theta: number[], phi: number[], value: number[], plane: "xz" | "yz"): PolarCut {
  const [plus, minus] = plane === "xz" ? [0, Math.PI] : [Math.PI / 2, (3 * Math.PI) / 2];
  const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-6;
  const side = (target: number, sign: number) =>
    theta
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => near(phi[i], target))
      .map(({ t, i }) => ({ angle: sign * t, value: value[i] }));
  const points = [...side(plus, 1), ...side(minus, -1)].sort((a, b) => a.angle - b.angle);
  return { angle: points.map((p) => p.angle), value: points.map((p) => p.value) };
}

/**
 * Where a collection lens looks from the particle (#75). The engine's four
 * directions (levtrap.pattern.DIRECTIONS: forward is +z, the beam's way), and
 * "both": a lens forward and one backward of the same NA. Their cones of
 * half-angle asin(NA/n) meet only at θ = 90°, and only when NA = n, so what
 * they collect adds.
 */
export type LensDirection = "backward" | "forward" | "both" | "side_x" | "side_y";

/** label: the menu; phrase: the plot's title; name: the results CSV. */
export const LENS_DIRECTIONS: { value: LensDirection; label: string; phrase: string; name: string }[] = [
  { value: "backward", label: "Backward (−z)", phrase: "a backward lens (−z)", name: "backward lens (-z)" },
  { value: "forward", label: "Forward (+z)", phrase: "a forward lens (+z)", name: "forward lens (+z)" },
  { value: "both", label: "Forward + backward", phrase: "a forward and a backward lens of the same NA", name: "forward + backward lenses" },
  { value: "side_x", label: "Side, on the x axis", phrase: "a side lens on the x axis", name: "side lens (+x)" },
  { value: "side_y", label: "Side, on the y axis", phrase: "a side lens on the y axis", name: "side lens (+y)" },
];

const sum = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + b[i]);

/** The fraction of P_sca a lens of each NA in `pattern.NA` collects; null if the result lacks the direction. */
export function collectedAgainstNA(pattern: Pattern, direction: LensDirection): number[] | null {
  const c = pattern.collection;
  if (direction === "both") return c.forward && c.backward ? sum(c.forward, c.backward) : null;
  return c[direction] ?? null;
}

/** The fraction of the position information along `axis` a lens of each NA collects. */
export function informationAgainstNA(pattern: Pattern, direction: LensDirection, axis: "x" | "y" | "z"): number[] | null {
  const e = pattern.information_efficiency;
  if (direction === "both") return e.forward && e.backward ? sum(e.forward[axis], e.backward[axis]) : null;
  return e[direction]?.[axis] ?? null;
}

/**
 * What lenses of the trapping lens's NA collect (`at_trap_NA`): backward is
 * the trapping lens itself, looking back at the particle; forward a lens of the
 * same NA opposite it; both the two together. Null for the side directions
 * (the engine gives none) or when the result has no trapping lens's NA.
 */
export function atTrapNA(pattern: Pattern, direction: LensDirection): ConeFractions | null {
  const at = pattern.at_trap_NA;
  if (!at || !pattern.trap_NA) return null;
  if (direction === "forward" || direction === "backward") return at[direction] ?? null;
  if (direction !== "both" || !at.forward || !at.backward) return null;
  const { forward: f, backward: b } = at;
  return {
    collection: f.collection + b.collection,
    information: { x: f.information.x + b.information.x, y: f.information.y + b.information.y, z: f.information.z + b.information.z },
  };
}

/**
 * Which NA the trapping lens has, in words (#97): the beam whose NA it is,
 * and the beams going the first beam's way through that one lens. Null with
 * one beam in the trap (its own lens, nothing to say) or when the result
 * does not say which beams (an older recording).
 */
export function trapLensNote(pattern: Pattern, setup: Setup): string | null {
  const fields = pattern.trap_NA_fields;
  const field = pattern.trap_NA_field;
  if (!pattern.trap_NA || !fields?.length || field == null) return null;
  const parts = partsOf(setup);
  if (parts.filter((p) => p.kind === "beam").length < 2) return null;
  const name = (i: number) => parts.find((p) => p.id === `field:${i}`)?.name ?? `field ${i + 1}`;
  if (fields.length === 1) return `${name(field)}'s; no other beam goes its way`;
  const names = fields.map(name);
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${name(field)}'s: ${list} go the same way through one lens, which needs the ${fields.length === 2 ? "larger" : "largest"} of their NAs`;
}
