import assert from "node:assert/strict";
import { test } from "node:test";
import type { Result } from "../../engine/types.ts";
import { PRESETS } from "../presets.ts";
import { RECORDED } from "../recorded.ts";
import { defaultKnobs, designKnobs, mismatch, nelderMead, PENALTY, readTarget, scaleFor, typicalMiss } from "./design.ts";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.setup;

test("a tweezer is designed with its power and NA; a Paul trap with its RF voltage and frequency", () => {
  const tweezer = designKnobs(preset("tweezer"));
  assert.deepEqual(tweezer.map((k) => k.id), ["beam0-power", "beam0-wavelength", "lens0-NA", "particle-radius"]);
  assert.deepEqual(defaultKnobs(tweezer), ["beam0-power", "lens0-NA"]);
  const paul = designKnobs(preset("paul-linear"));
  assert.deepEqual(defaultKnobs(paul), ["paul0-rf_voltage", "paul0-rf_frequency"]);
});

test("the targets are read off a result, and a result without a trap has none", () => {
  const r = RECORDED.tweezer!;
  assert.ok(Math.abs(readTarget(r, "z")! - r.modes.find((m) => m.name === "z")!.frequency!) < 1e-9);
  assert.equal(readTarget(r, "depth"), r.depth.kT);
  const unstable = { ...r, stable: false } as Result;
  assert.equal(readTarget(unstable, "x"), null);
  assert.equal(mismatch(unstable, { x: 1e5 }), PENALTY);
});

test("the mismatch is zero at the target and grows as the log of the ratio", () => {
  const r = RECORDED.tweezer!;
  const fz = readTarget(r, "z")!;
  assert.ok(mismatch(r, { z: fz }) < 1e-20);
  assert.ok(Math.abs(mismatch(r, { z: fz / Math.E }) - 1) < 1e-12);
  assert.ok(Math.abs(typicalMiss(Math.log(1.1) ** 2, 1) - 0.1) < 1e-12);
});

test("a numerical aperture is searched on a scale that keeps it below the medium index", () => {
  const knob = designKnobs(preset("tweezer")).find((k) => k.id === "lens0-NA")!;
  const s = scaleFor(knob, preset("tweezer"));
  assert.ok(Math.abs(s.back(s.forward(0.8)) - 0.8) < 1e-12);
  assert.ok(s.back(50) < 1 && s.back(-50) > 0);
  const power = designKnobs(preset("tweezer")).find((k) => k.id === "beam0-power")!;
  const p = scaleFor(power, preset("tweezer"));
  assert.ok(Math.abs(p.back(p.forward(0.2)) - 0.2) < 1e-15);
});

test("Nelder–Mead finds the minimum of a tweezer-like model: f ∝ √P, and the ratio set by the NA", async () => {
  // a toy trap: f_r = a √P · NA, f_z = b √P · NA²; targets reachable at P = 0.5, NA = 0.6
  const model = (P: number, NA: number) => ({ r: Math.sqrt(P) * NA, z: 0.5 * Math.sqrt(P) * NA * NA });
  const want = model(0.5, 0.6);
  const f = async ([lp, lna]: number[]) => {
    const got = model(Math.exp(lp), Math.exp(lna));
    return Math.log(got.r / want.r) ** 2 + Math.log(got.z / want.z) ** 2;
  };
  const { best, trials } = await nelderMead(f, [Math.log(0.2), Math.log(0.8)], { budget: 80, tol: 1e-12 });
  assert.ok(trials.length <= 80);
  assert.ok(Math.abs(Math.exp(best.u[0]) - 0.5) < 0.02, `P ${Math.exp(best.u[0])}`);
  assert.ok(Math.abs(Math.exp(best.u[1]) - 0.6) < 0.01, `NA ${Math.exp(best.u[1])}`);
});

test("Nelder–Mead stops when asked, and keeps every trial", async () => {
  let calls = 0;
  const { trials } = await nelderMead(
    async (u) => {
      calls += 1;
      return u[0] ** 2;
    },
    [3],
    { aborted: () => calls >= 5 },
  );
  assert.equal(trials.length, calls);
  assert.ok(calls <= 6);
});
