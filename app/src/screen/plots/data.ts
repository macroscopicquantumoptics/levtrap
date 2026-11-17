/**
 * The data behind the drawer's plots, from a Result: pure functions, tested
 * in data.test.ts.
 */
import type { Result, Setup, Vec3 } from "../../engine/types.ts";
import { gasDamping, gasHeating, KB, logSpace } from "../../lib/gas.ts";
import { environmentOf } from "../model.ts";

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
