/**
 * The Design tab's model: the trap you want (its frequencies, its depth) and
 * the inputs levtrap may change to get it. The search is Nelder–Mead on the
 * mismatch Σ ln²(achieved / wanted), one engine solve per trial; each input
 * is searched on a scale that keeps it in its allowed range (a log scale for
 * a positive input, a logistic one for a numerical aperture). Pure:
 * design.test.ts.
 *
 * Power is an exact scale for a trap of light only (#102): with no gravity
 * and no Paul trap, every force is proportional to the beams' power when all
 * of them are scaled together by s. The equilibrium stays put, stiffness and
 * depth go as s, every frequency as √s. So a common power scale is not
 * searched: it is fitted in closed form (fitScale). Alone, it is set in one
 * step and checked with one solve; with other inputs, Nelder–Mead searches
 * them and fits the scale for each trial, one dimension fewer.
 */
import type { Result, Setup } from "../../engine/types.ts";
import { shownFrequency } from "../answer.ts";
import { environmentOf } from "../model.ts";
import { groupPower, sweepParams, withGroupPower, type SweepParam } from "./sweep.ts";

export type TargetId = "x" | "y" | "z" | "depth";

export interface Target {
  id: TargetId;
  label: string;
  /** the unit typed */
  unit: string;
  quantity: "frequency" | "number";
}

export const TARGETS: Target[] = [
  { id: "x", label: "f_x", unit: "kHz", quantity: "frequency" },
  { id: "y", label: "f_y", unit: "kHz", quantity: "frequency" },
  { id: "z", label: "f_z", unit: "kHz", quantity: "frequency" },
  { id: "depth", label: "Depth (k_BT)", unit: "", quantity: "number" },
];

/** A target's value in a result; null where the trap has none (not stable, no mode). */
export function readTarget(result: Result | null, id: TargetId): number | null {
  if (!result?.stable) return null;
  if (id === "depth") return result.depth.kT ?? null;
  const mode = result.modes.find((m) => m.name === id);
  return mode ? shownFrequency(result, mode) : null;
}

/** The id of the input that scales every beam's power together, keeping their split (#102). */
export const ALL_POWER = "beams-power";

/** The indices (into trap.fields) of the beams. */
export function beamIndices(setup: Setup): number[] {
  return setup.trap.fields.flatMap((f, i) => (f.kind === "beam" ? [i] : []));
}

/** Every beam's power times s: their split is kept. */
export function scalePowers(setup: Setup, s: number): Setup {
  const beams = beamIndices(setup);
  return withGroupPower(setup, beams, s * groupPower(setup, beams));
}

/** The input "All beams · power": the total of every beam's power; a new total scales each beam, keeping the split (#102). */
export function allPowerKnob(): SweepParam {
  return {
    id: ALL_POWER,
    label: "All beams · power",
    quantity: "power",
    unit: "mW",
    get: (s) => groupPower(s, beamIndices(s)),
    set: (s, v) => withGroupPower(s, beamIndices(s), v),
    log: true,
    check: (v) => (v > 0 ? null : "Must be greater than 0."),
  };
}

/**
 * The inputs a design may change: those of the sweep that are positive by
 * nature (not tilts, DC or positions), and, with two beams or more, the
 * power of all of them together (what "more power" usually means).
 */
export function designKnobs(setup: Setup): SweepParam[] {
  const knobs = sweepParams(setup).filter((p) => !/tilt|dc_voltage|endcap_voltage|hole_radius|charge|pressure|temperature/.test(p.id));
  return beamIndices(setup).length > 1 ? [allPowerKnob(), ...knobs] : knobs;
}

/** The knobs ticked at first: the power (of all beams, when there are several) and the first lens's NA, or the Paul trap's RF voltage and frequency. */
export function defaultKnobs(knobs: SweepParam[]): string[] {
  const power = knobs.some((k) => k.id === ALL_POWER) ? ALL_POWER : "beam0-power";
  const wanted = [power, "lens0-NA", "paul0-rf_voltage", "paul0-rf_frequency"];
  const ids = knobs.map((k) => k.id).filter((id) => wanted.includes(id));
  if (ids.length) return ids.slice(0, 2);
  return knobs.slice(0, 1).map((k) => k.id);
}

/** The search's scale for a knob: u = forward(v), v = back(u); a numerical aperture lives in (0, n), a share of a pair's power in (0, 1), a phase anywhere. */
export function scaleFor(knob: SweepParam, setup: Setup): { forward(v: number): number; back(u: number): number } {
  if (knob.id.endsWith("-NA")) {
    const top = 0.98 * environmentOf(setup).medium_index;
    return {
      forward: (v) => Math.log(Math.min(Math.max(v, 1e-3), top - 1e-6) / (top - Math.min(Math.max(v, 1e-3), top - 1e-6))),
      back: (u) => top / (1 + Math.exp(-u)),
    };
  }
  if (knob.id.endsWith("-split")) {
    // a share of a pair's power (#79) lives in (0, 1): logistic, as the NA
    const clamp = (v: number) => Math.min(Math.max(v, 1e-4), 1 - 1e-4);
    return { forward: (v) => Math.log(clamp(v) / (1 - clamp(v))), back: (u) => 1 / (1 + Math.exp(-u)) };
  }
  // a phase (#79) is any number, periodic: searched as it is
  if (knob.id.endsWith("-phase")) return { forward: (v) => v, back: (u) => u };
  return { forward: (v) => Math.log(Math.max(v, 1e-300)), back: (u) => Math.exp(u) };
}

/** What a trial misses by: Σ ln²(achieved / wanted); a trial without a trap scores PENALTY. */
export const PENALTY = 100;
export function mismatch(result: Result | null, targets: Partial<Record<TargetId, number>>): number {
  let sum = 0;
  for (const [id, want] of Object.entries(targets) as [TargetId, number][]) {
    const got = readTarget(result, id);
    if (got === null || !(got > 0) || !(want > 0)) return PENALTY;
    sum += Math.log(got / want) ** 2;
  }
  return sum;
}

/** The typical miss, as a fraction: exp(√(mismatch / n)) − 1. */
export function typicalMiss(score: number, n: number): number {
  return n > 0 ? Math.exp(Math.sqrt(score / n)) - 1 : 0;
}

/**
 * A trap of light only: it has a beam, and no gravity and no Paul trap. A
 * charge without a field to act on does not matter. Every force is then
 * proportional to the beams' power, scaled together (#102).
 */
export function opticalOnly(setup: Setup): boolean {
  const kinds = setup.trap.fields.map((f) => f.kind);
  return kinds.includes("beam") && kinds.every((k) => k === "beam");
}

/**
 * The input among `chosen` that scales every force of the trap by a common
 * factor, or null: in a trap of light only, "All beams · power", or the
 * power of the only beam. One beam's power among several is not one: it
 * changes the split between the beams.
 */
export function powerScaleKnob(chosen: SweepParam[], setup: Setup): SweepParam | null {
  if (!opticalOnly(setup)) return null;
  const beams = beamIndices(setup);
  const single = beams.length === 1 ? `beam${beams[0]}-power` : null;
  return chosen.find((k) => k.id === ALL_POWER || k.id === single) ?? null;
}

/**
 * How each target goes with a common power scale s, as an exponent p in
 * target ∝ s^p: a frequency as √s, the depth (in k_BT, at a fixed
 * temperature) as s. null would mark a target that is not a power law of s
 * (none yet); such a target needs the search.
 */
export const POWER_EXPONENT: Record<TargetId, number | null> = { x: 0.5, y: 0.5, z: 0.5, depth: 1 };

/** Whether every target goes exactly as a power of the scale, so the scale can be fitted instead of searched. */
export function scalesExactly(targets: Partial<Record<TargetId, number>>): boolean {
  return (Object.keys(targets) as TargetId[]).every((id) => POWER_EXPONENT[id] !== null);
}

/** The range a design may put the total power of the beams in [W] (#102). */
export const POWER_RANGE: readonly [number, number] = [1e-6, 100];

export interface ScaleFit {
  /** the factor on every beam's power */
  s: number;
  /** the mismatch the scaled trap has: Σ ln²(achieved / wanted) */
  score: number;
  /** the best s was outside the allowed range and was clamped to its "low" or "high" end */
  clamped: "low" | "high" | null;
}

/**
 * The power scale that best meets the targets, in closed form: with
 * d_i = ln(got_i / wanted_i) and target i ∝ s^p_i, Σ (d_i + p_i ln s)² is
 * least at ln s = −Σ p_i d_i / Σ p_i². One target is met exactly; several,
 * at the best compromise. `range` bounds s; a scale beyond it is clamped.
 * A result without a trap, or without one of the targets, has no fit (null).
 */
export function fitScale(result: Result | null, targets: Partial<Record<TargetId, number>>, range: readonly [number, number] = [0, Infinity]): ScaleFit | null {
  const terms: { d: number; p: number }[] = [];
  for (const [id, want] of Object.entries(targets) as [TargetId, number][]) {
    const got = readTarget(result, id);
    const p = POWER_EXPONENT[id];
    if (got === null || !(got > 0) || !(want > 0) || p === null) return null;
    terms.push({ d: Math.log(got / want), p });
  }
  if (!terms.length) return null;
  const pp = terms.reduce((sum, x) => sum + x.p * x.p, 0);
  let t = pp > 0 ? -terms.reduce((sum, x) => sum + x.p * x.d, 0) / pp : 0;
  let clamped: ScaleFit["clamped"] = null;
  const [lo, hi] = [Math.log(range[0]), Math.log(range[1])];
  if (t < lo) [t, clamped] = [lo, "low"];
  else if (t > hi) [t, clamped] = [hi, "high"];
  return { s: Math.exp(t), score: terms.reduce((sum, x) => sum + (x.d + x.p * t) ** 2, 0), clamped };
}

/** The factors the total power of `setup` may be multiplied by and stay in POWER_RANGE. */
export function scaleRange(setup: Setup): [number, number] {
  const total = groupPower(setup, beamIndices(setup));
  return total > 0 ? [POWER_RANGE[0] / total, POWER_RANGE[1] / total] : [1, 1];
}

/**
 * The result of a trap of light only with every beam's power times s,
 * without solving it: the equilibrium and the axes stay; stiffness, depth
 * and the light's powers go as s, frequencies as √s. Exact for such a trap;
 * the search shows it until a solve checks it. Other blocks (rates, Paul,
 * lenses) are left as they were.
 */
export function scaleResult(result: Result, s: number): Result {
  const r = Math.sqrt(s);
  return {
    ...result,
    modes: result.modes.map((m) => ({
      ...m,
      frequency: m.frequency === null ? null : m.frequency * r,
      stiffness: m.stiffness === null ? null : m.stiffness * s,
      depth: m.depth === null ? null : m.depth * s,
    })),
    depth: { J: result.depth.J * s, K: result.depth.K * s, kT: result.depth.kT * s },
    optical: result.optical && { ...result.optical, P_sca: result.optical.P_sca * s, P_abs: result.optical.P_abs * s, power: result.optical.power * s },
  };
}

export interface Trial {
  u: number[];
  score: number;
}

/**
 * Nelder–Mead (Lagarias et al. 1998 coefficients), with an asynchronous
 * objective: one engine solve per call. Stops after `budget` calls, when the
 * simplex's scores agree within `tol`, or when `aborted()` says so; returns
 * the best trial and every trial made, in order.
 */
export async function nelderMead(
  f: (u: number[]) => Promise<number>,
  start: number[],
  { step = 0.4, budget = 40, tol = 1e-5, aborted = () => false, onTrial }: { step?: number; budget?: number; tol?: number; aborted?: () => boolean; onTrial?(t: Trial, best: Trial): void } = {},
): Promise<{ best: Trial; trials: Trial[] }> {
  const n = start.length;
  const trials: Trial[] = [];
  let best: Trial = { u: start, score: Infinity };
  const evaluate = async (u: number[]): Promise<Trial> => {
    const t = { u, score: await f(u) };
    trials.push(t);
    if (t.score < best.score) best = t;
    onTrial?.(t, best);
    return t;
  };
  const simplex: Trial[] = [await evaluate(start)];
  for (let i = 0; i < n && !aborted(); i += 1) {
    const u = start.slice();
    u[i] += step;
    simplex.push(await evaluate(u));
  }
  const add = (a: number[], b: number[], s: number) => a.map((v, i) => v + s * (b[i] - v));
  while (trials.length < budget && !aborted() && simplex.length === n + 1) {
    simplex.sort((a, b) => a.score - b.score);
    if (simplex[n].score - simplex[0].score < tol && best.score < PENALTY) break;
    const centroid = Array.from({ length: n }, (_, i) => simplex.slice(0, n).reduce((s, t) => s + t.u[i], 0) / n);
    const worst = simplex[n];
    const r = await evaluate(add(centroid, worst.u, -1));
    if (r.score < simplex[0].score) {
      const e = await evaluate(add(centroid, worst.u, -2));
      simplex[n] = e.score < r.score ? e : r;
    } else if (r.score < simplex[n - 1].score) {
      simplex[n] = r;
    } else {
      const outside = r.score < worst.score;
      const c = await evaluate(add(centroid, outside ? r.u : worst.u, 0.5));
      if (c.score < (outside ? r.score : worst.score)) {
        simplex[n] = c;
      } else {
        // shrink towards the best
        for (let i = 1; i <= n && !aborted() && trials.length < budget; i += 1) simplex[i] = await evaluate(add(simplex[0].u, simplex[i].u, 0.5));
      }
    }
  }
  return { best, trials };
}

/** A design found: the setup, its result, its mismatch. */
export interface Found {
  setup: Setup;
  result: Result;
  score: number;
  /** the power wanted was beyond POWER_RANGE, and is at its "low" or "high" end */
  clamped: ScaleFit["clamped"];
  /** the result is scaleResult's prediction, not yet solved: its recoil and Paul numbers are the unscaled trial's */
  predicted?: boolean;
}

/**
 * How a design is found (#102): "scale" sets a power scale alone in one
 * step from fitScale, then solves to check; "search+scale" searches the
 * other inputs with Nelder–Mead and fits the power scale for each trial;
 * "search" searches every input.
 */
export type DesignMethod = "scale" | "search+scale" | "search";

/** The method for these inputs and targets in this setup, and the power scale input it fits, if any. */
export function designMethod(chosen: SweepParam[], setup: Setup, targets: Partial<Record<TargetId, number>>): { method: DesignMethod; scale: SweepParam | null } {
  const scale = scalesExactly(targets) ? powerScaleKnob(chosen, setup) : null;
  if (!scale) return { method: "search", scale: null };
  return { method: chosen.length === 1 ? "scale" : "search+scale", scale };
}

/** The most solves that check the one-step scale: one, more only if the first misses (a stale result, rounding, the trap lost). One solve more comes first when there is no current result. */
export const SCALE_STEPS = 3;
/** The most solves that check the power fitted in a search: a second only if the first failed. */
export const CHECK_TRIES = 2;
/** A fitted scale this close to 1 (in ln s) is the answer already. */
const SCALE_TOL = 1e-4;

/**
 * Finds the inputs that give the targets, one `solve` per trial (null for a
 * solve that failed; an abort throws). `result` is the current setup's
 * result, if known: it starts the search where the trap is, and the scale
 * method fits from it, so a scale alone takes one solve. `onSolve` sees the
 * best so far after each solve.
 */
export async function findDesign({
  setup,
  result,
  chosen,
  targets,
  solve,
  budget = 40,
  aborted = () => false,
  onSolve,
}: {
  setup: Setup;
  result: Result | null;
  chosen: SweepParam[];
  targets: Partial<Record<TargetId, number>>;
  solve(setup: Setup, start: Result["equilibrium"]): Promise<Result | null>;
  budget?: number;
  aborted?: () => boolean;
  onSolve?(best: Found | null, solves: number): void;
}): Promise<{ method: DesignMethod; best: Found | null; solves: number }> {
  const { method, scale } = designMethod(chosen, setup, targets);
  let start: Result["equilibrium"] = result?.stable && result.equilibrium ? result.equilibrium : null;
  let best: Found | null = null;
  let solves = 0;
  const consider = (found: Found) => {
    if (found.score < (best?.score ?? Infinity)) {
      best = found;
      // continuation: from the best trap so far, so the search follows one trap
      if (found.result.stable && found.result.equilibrium) start = found.result.equilibrium;
    }
  };
  const run = async (s: Setup) => {
    const r = await solve(s, start);
    solves += 1;
    return r;
  };
  const done = () => onSolve?.(best, solves);

  if (method === "scale") {
    // f ∝ √s, depth ∝ s: fit s, solve once to check; fit again only if the check misses
    let base: { setup: Setup; result: Result | null } = { setup, result: result?.stable ? result : null };
    if (!base.result) {
      base.result = await run(setup);
      done();
    }
    for (let step = 0; step <= SCALE_STEPS && !aborted(); step += 1) {
      const fit = fitScale(base.result, targets, scaleRange(base.setup));
      if (!fit) break; // no trap: with light only, no power makes one
      if (best && Math.abs(Math.log(fit.s)) < SCALE_TOL) {
        best = { ...(best as Found), clamped: fit.clamped };
        break;
      }
      if (step === SCALE_STEPS) break;
      const trial = scalePowers(base.setup, fit.s);
      const r = await run(trial);
      if (r) best = { setup: trial, result: r, score: mismatch(r, targets), clamped: fit.clamped };
      done();
      base = { setup: trial, result: r };
    }
    return { method, best, solves };
  }

  const others = chosen.filter((k) => k !== scale);
  const scales = others.map((k) => scaleFor(k, setup));
  const build = (u: number[]) => others.reduce((s, k, i) => k.set(s, scales[i].back(u[i])), setup);
  await nelderMead(
    async (u) => {
      const trial = build(u);
      const r = await run(trial);
      let score = mismatch(r, targets);
      if (r && scale) {
        // the power scale is not searched: it is fitted for this trial, in closed form
        const fit = fitScale(r, targets, scaleRange(trial));
        if (fit) {
          score = fit.score;
          consider({ setup: scalePowers(trial, fit.s), result: scaleResult(r, fit.s), score, clamped: fit.clamped, predicted: true });
        }
      } else if (r) {
        consider({ setup: trial, result: r, score, clamped: null });
      }
      done();
      return score;
    },
    others.map((k, i) => scales[i].forward(k.get(setup))),
    { budget: scale ? budget - CHECK_TRIES : budget, aborted },
  );
  const predicted = best as Found | null;
  // one solve checks the fitted power; a second only if the first failed.
  // If both fail, the best stays a prediction (predicted: true) and the table says so.
  if (predicted?.predicted) {
    for (let tries = 0; tries < CHECK_TRIES && !aborted(); tries += 1) {
      const r = await run(predicted.setup);
      if (r) best = { ...predicted, result: r, score: mismatch(r, targets), predicted: false };
      done();
      if (r) break;
    }
  }
  return { method, best, solves };
}
