import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrapMode } from "../../engine/types.ts";
import { RECORDED } from "../recorded.ts";
import { displacement, FASTEST_SHOWN, K_B, magnification, motionPlan, SLOWEST_PERIOD, step, thermalStart, TRAIL_PERIODS } from "./motion.ts";

const mode = (name: string, axis: [number, number, number], frequency: number | null, stiffness: number | null): TrapMode => ({ name, axis, frequency, stiffness, depth: null });

/** a reproducible uniform generator */
function lcg(seed = 1) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) + 0.5) / 2 ** 32;
}

test("equipartition: each mode's rms displacement is √(k_B T / k)", () => {
  const plan = motionPlan([mode("x", [1, 0, 0], 2e5, 1e-5), mode("z", [0, 0, 1], 1e5, 2.5e-6)], 300)!;
  assert.ok(Math.abs(plan.modes[0].sigma - Math.sqrt((K_B * 300) / 1e-5)) < 1e-20);
  assert.ok(Math.abs(plan.modes[1].sigma / plan.modes[0].sigma - 2) < 1e-12);
});

test("the slowest mode takes SLOWEST_PERIOD on screen, and the trail ten of its periods", () => {
  const plan = motionPlan([mode("x", [1, 0, 0], 2e5, 1e-5), mode("z", [0, 0, 1], 1e5, 2.5e-6)], 300)!;
  assert.ok(Math.abs(plan.slowdown / 1e5 - SLOWEST_PERIOD) < 1e-12);
  assert.ok(Math.abs(plan.trail - TRAIL_PERIODS * SLOWEST_PERIOD) < 1e-9);
  // far apart frequencies: the fastest is capped instead
  const wide = motionPlan([mode("x", [1, 0, 0], 1e6, 1e-5), mode("z", [0, 0, 1], 1e3, 1e-8)], 300)!;
  assert.ok(Math.abs(1e6 / wide.slowdown - FASTEST_SHOWN) < 1e-9);
});

test("nothing moves without a restoring force", () => {
  assert.equal(motionPlan([mode("x", [1, 0, 0], null, -1)], 300), null);
  assert.equal(motionPlan([], 300), null);
  const plan = motionPlan([mode("x", [1, 0, 0], null, -1), mode("z", [0, 0, 1], 1e5, 1e-6)], 300)!;
  assert.deepEqual(plan.modes.map((m) => m.name), ["z"]);
});

test("the recorded tweezer moves by tens of nanometres at 300 K", () => {
  const r = RECORDED.tweezer!;
  const plan = motionPlan(r.modes, 300)!;
  for (const m of plan.modes) assert.ok(m.sigma > 5e-9 && m.sigma < 1e-7, `${m.name}: ${m.sigma}`);
});

test("the wandering quadratures keep the thermal variance, and the motion is along the mode's axis", () => {
  const plan = motionPlan([mode("x", [1, 0, 0], 2e5, 1e-5)], 300)!;
  const random = lcg(7);
  let q = thermalStart(plan, random);
  let sum = 0;
  const N = 20000;
  for (let i = 0; i < N; i += 1) {
    q = step(plan, q, 2, random);
    sum += (q[0].X ** 2 + q[0].Y ** 2) / 2;
  }
  const ratio = sum / N / plan.modes[0].sigma ** 2;
  assert.ok(ratio > 0.85 && ratio < 1.15, `variance ratio ${ratio}`);
  const d = displacement(plan, q, 0.3, 10);
  assert.equal(d[1], 0);
  assert.equal(d[2], 0);
  assert.ok(Math.abs(d[0] - 10 * displacement(plan, q, 0.3)[0]) < 1e-20);
});

test("magnification is a round factor that makes the motion visible", () => {
  assert.equal(magnification(20, 8), 1);
  assert.equal(magnification(4, 8), 2);
  assert.equal(magnification(1, 8), 10);
  assert.equal(magnification(0.03, 8), 500);
  assert.equal(magnification(0, 8), 1);
});
