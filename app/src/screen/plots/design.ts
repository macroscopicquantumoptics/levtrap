/**
 * The Design tab's model: the trap you want (its frequencies, its depth) and
 * the inputs levtrap may change to get it. The search is Nelder–Mead on the
 * mismatch Σ ln²(achieved / wanted), one engine solve per trial; each input
 * is searched on a scale that keeps it in its allowed range (a log scale for
 * a positive input, a logistic one for a numerical aperture). Pure:
 * design.test.ts.
 */
import type { Result, Setup } from "../../engine/types.ts";
import { shownFrequency } from "../answer.ts";
import { environmentOf } from "../model.ts";
import { sweepParams, type SweepParam } from "./sweep.ts";

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

/** The inputs a design may change: those of the sweep that are positive by nature (not tilts, DC or positions). */
export function designKnobs(setup: Setup): SweepParam[] {
  return sweepParams(setup).filter((p) => !/tilt|dc_voltage|endcap_voltage|hole_radius|charge|pressure|temperature/.test(p.id));
}

/** The knobs ticked at first: the first beam's power and NA, or the Paul trap's RF voltage and frequency. */
export function defaultKnobs(knobs: SweepParam[]): string[] {
  const wanted = ["beam0-power", "lens0-NA", "paul0-rf_voltage", "paul0-rf_frequency"];
  const ids = knobs.map((k) => k.id).filter((id) => wanted.includes(id));
  if (ids.length) return ids.slice(0, 2);
  return knobs.slice(0, 1).map((k) => k.id);
}

/** The search's scale for a knob: u = forward(v), v = back(u); a numerical aperture lives in (0, n). */
export function scaleFor(knob: SweepParam, setup: Setup): { forward(v: number): number; back(u: number): number } {
  if (knob.id.endsWith("-NA")) {
    const top = 0.98 * environmentOf(setup).medium_index;
    return {
      forward: (v) => Math.log(Math.min(Math.max(v, 1e-3), top - 1e-6) / (top - Math.min(Math.max(v, 1e-3), top - 1e-6))),
      back: (u) => top / (1 + Math.exp(-u)),
    };
  }
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
