/**
 * The particle's motion in the trap, for the scene's Play button. Pure:
 * motion.test.ts.
 *
 * Each mode of the trap is a harmonic oscillator along its eigen-axis. In
 * thermal equilibrium with the gas at temperature T its position is Gaussian
 * with variance k_B T / k (equipartition: k the mode's stiffness), and its
 * two quadratures wander slowly (here an Ornstein–Uhlenbeck process, so the
 * motion is a slowly changing Lissajous figure, as a thermal oscillator
 * with a long coherence time is). The motion is slowed down so the slowest
 * mode takes SLOWEST_PERIOD seconds on screen; the frequency ratios are kept.
 */
import type { TrapMode, Vec3 } from "../../engine/types.ts";

export const K_B = 1.380649e-23;
/** s on screen: the period the slowest mode is shown with */
export const SLOWEST_PERIOD = 1.6;
/** Hz on screen: the fastest mode is never shown faster than this (it would blur) */
export const FASTEST_SHOWN = 6;
/** the trail covers this many periods of the slowest mode */
export const TRAIL_PERIODS = 10;
/** the quadratures' correlation time, in periods of the slowest mode */
export const COHERENCE_PERIODS = 12;

export interface MotionMode {
  name: string;
  axis: Vec3;
  /** Hz, the real frequency */
  frequency: number;
  /** m, rms displacement */
  sigma: number;
}

export interface MotionPlan {
  modes: MotionMode[];
  /** real time / screen time */
  slowdown: number;
  /** s on screen the trail covers */
  trail: number;
  /** s on screen, the quadratures' correlation time */
  coherence: number;
}

/**
 * The modes that can move (positive stiffness, a frequency) and how much
 * they are slowed; null if there is nothing to animate.
 */
export function motionPlan(modes: TrapMode[], temperature: number): MotionPlan | null {
  const moving = modes
    .filter((m) => m.frequency !== null && m.frequency > 0 && m.stiffness !== null && m.stiffness > 0)
    .map((m) => ({ name: m.name, axis: m.axis, frequency: m.frequency!, sigma: Math.sqrt((K_B * temperature) / m.stiffness!) }));
  if (!moving.length || !(temperature > 0)) return null;
  const fmin = Math.min(...moving.map((m) => m.frequency));
  const fmax = Math.max(...moving.map((m) => m.frequency));
  const slowdown = Math.max(fmin * SLOWEST_PERIOD, fmax / FASTEST_SHOWN);
  const slowest = slowdown / fmin; // s on screen
  return { modes: moving, slowdown, trail: TRAIL_PERIODS * slowest, coherence: COHERENCE_PERIODS * slowest };
}

/** A round factor (1, 2 or 5 × 10ⁿ, at least 1) that makes `px` at least `want` px. */
export function magnification(px: number, want: number): number {
  if (!(px > 0) || px >= want) return 1;
  const raw = want / px;
  const decade = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 2, 5, 10]) if (step * decade >= raw) return step * decade;
  return 10 * decade;
}

/** One oscillator's quadratures: x(t) = X cos ωt + Y sin ωt. */
export interface Quadratures {
  X: number;
  Y: number;
}

/** A standard normal number from two uniform ones (Box–Muller). */
export function gaussian(random: () => number = Math.random): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Quadratures drawn from the thermal state: each Gaussian with variance σ². */
export function thermalStart(plan: MotionPlan, random: () => number = Math.random): Quadratures[] {
  return plan.modes.map((m) => ({ X: m.sigma * gaussian(random), Y: m.sigma * gaussian(random) }));
}

/**
 * Advance the quadratures by `dt` s on screen: an exact Ornstein–Uhlenbeck
 * step with correlation time `plan.coherence`, keeping the variance σ².
 */
export function step(plan: MotionPlan, q: Quadratures[], dt: number, random: () => number = Math.random): Quadratures[] {
  const a = Math.exp(-dt / plan.coherence);
  const b = Math.sqrt(1 - a * a);
  return q.map((s, i) => ({ X: a * s.X + b * plan.modes[i].sigma * gaussian(random), Y: a * s.Y + b * plan.modes[i].sigma * gaussian(random) }));
}

/** The displacement [m, lab] at screen time `t` [s], magnified by `gain`. */
export function displacement(plan: MotionPlan, q: Quadratures[], t: number, gain = 1): Vec3 {
  const d: Vec3 = [0, 0, 0];
  plan.modes.forEach((m, i) => {
    const w = (2 * Math.PI * m.frequency) / plan.slowdown;
    const x = gain * (q[i].X * Math.cos(w * t) + q[i].Y * Math.sin(w * t));
    const n = Math.hypot(...m.axis) || 1;
    for (let k = 0; k < 3; k += 1) d[k] += (x * m.axis[k]) / n;
  });
  return d;
}
