import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, Result, Setup } from "../../engine/types.ts";
import { PRESETS } from "../presets.ts";
import { RECORDED } from "../recorded.ts";
import {
  ALL_POWER,
  allPowerKnob,
  defaultKnobs,
  designKnobs,
  designMethod,
  findDesign,
  fitScale,
  mismatch,
  nelderMead,
  opticalOnly,
  PENALTY,
  POWER_RANGE,
  powerScaleKnob,
  readTarget,
  scaleFor,
  scalePowers,
  scaleResult,
  typicalMiss,
} from "./design.ts";

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

test("a coherent pair's split and phase are design knobs, searched where they can be (#79)", () => {
  const s = preset("ws2-bottle");
  const knobs = designKnobs(s);
  const split = knobs.find((k) => k.id === "pair0-1-split")!;
  const phase = knobs.find((k) => k.id === "beam1-phase")!;
  // the split stays a fraction strictly between 0 and 1 wherever the search goes
  const f = scaleFor(split, s);
  assert.ok(Math.abs(f.back(f.forward(0.63)) - 0.63) < 1e-12);
  assert.ok(f.back(50) <= 1 && f.back(-50) >= 0 && Number.isFinite(f.forward(0)) && Number.isFinite(f.forward(1)));
  // a phase may be any number, so it is searched as it is (not on a log scale, which would refuse 0)
  const p = scaleFor(phase, s);
  assert.equal(p.forward(0), 0);
  assert.equal(p.back(-1), -1);
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

// ---- power is an exact scale for a trap of light only (#102) ---------------------------------------

const withPower = (setup: Setup, P: number) => scalePowers(setup, P / allPowerKnob().get(setup));

test("a power scale is fitted in closed form: f ∝ √P, depth ∝ P, the least squares of several", () => {
  const r = RECORDED.tweezer!;
  const fx = readTarget(r, "x")!;
  // one frequency: met exactly
  const one = fitScale(r, { x: 150e3 })!;
  assert.ok(Math.abs(one.s - (150e3 / fx) ** 2) < 1e-12);
  assert.ok(one.score < 1e-24 && one.clamped === null);
  // the depth goes as the power itself
  const depth = fitScale(r, { depth: 2 * r.depth.kT })!;
  assert.ok(Math.abs(depth.s - 2) < 1e-12);
  // two targets that want different scales: ln s = −Σ p d / Σ p², and the residual is what is left
  const both = fitScale(r, { x: 2 * fx, depth: r.depth.kT })!;
  const t = -(0.5 * Math.log(0.5)) / (0.25 + 1);
  assert.ok(Math.abs(Math.log(both.s) - t) < 1e-12);
  assert.ok(Math.abs(both.score - ((Math.log(0.5) + 0.5 * t) ** 2 + t ** 2)) < 1e-12);
  assert.ok(Math.abs(both.score - mismatch(scaleResult(r, both.s), { x: 2 * fx, depth: r.depth.kT })) < 1e-12);
  // beyond the range: clamped, and said so
  const high = fitScale(r, { x: 100 * fx }, [0.5, 2])!;
  assert.ok(Math.abs(high.s - 2) < 1e-12);
  assert.equal(high.clamped, "high");
  assert.equal(fitScale(r, { x: fx / 100 }, [0.5, 2])!.clamped, "low");
  // no trap, no fit
  assert.equal(fitScale({ ...r, stable: false } as Result, { x: fx }), null);
});

test("a scaled result keeps the equilibrium and scales stiffness and depth as s, frequencies as √s", () => {
  const r = RECORDED.tweezer!;
  const s = scaleResult(r, 4);
  assert.deepEqual(s.equilibrium, r.equilibrium);
  const [a, b] = [r.modes.find((m) => m.name === "x")!, s.modes.find((m) => m.name === "x")!];
  assert.ok(Math.abs(b.frequency! / a.frequency! - 2) < 1e-12);
  assert.ok(Math.abs(b.stiffness! / a.stiffness! - 4) < 1e-12);
  assert.ok(Math.abs(s.depth.kT / r.depth.kT - 4) < 1e-12);
});

test("the power is an exact scale only for light alone: the only beam's, or every beam's together", () => {
  const tweezer = preset("tweezer");
  const knobs = designKnobs(tweezer);
  const power = knobs.find((k) => k.id === "beam0-power")!;
  const na = knobs.find((k) => k.id === "lens0-NA")!;
  assert.ok(opticalOnly(tweezer));
  assert.equal(powerScaleKnob([na, power], tweezer), power);
  assert.equal(powerScaleKnob([na], tweezer), null);
  // a charge with no field to act on changes nothing
  const charged = { ...tweezer, particle: { ...tweezer.particle, charge: 100 } };
  assert.equal(powerScaleKnob([power], charged), power);
  // gravity does not scale with the power
  const heavy: Setup = { ...tweezer, trap: { fields: [...tweezer.trap.fields, { kind: "gravity" }] } };
  assert.ok(!opticalOnly(heavy));
  assert.equal(powerScaleKnob([power], heavy), null);
  assert.equal(designMethod([power], heavy, { x: 1e5 }).method, "search");
  // nor a Paul trap
  const paul = preset("paul-linear");
  assert.equal(powerScaleKnob(designKnobs(paul), paul), null);
  // two beams: one beam's power changes the split, so it is not a scale; all beams' power is
  const counter = preset("counter");
  const cKnobs = designKnobs(counter);
  assert.equal(cKnobs[0].id, ALL_POWER);
  assert.deepEqual(defaultKnobs(cKnobs), [ALL_POWER, "lens0-NA"]);
  assert.equal(powerScaleKnob([cKnobs.find((k) => k.id === "beam0-power")!], counter), null);
  assert.equal(powerScaleKnob(cKnobs, counter)!.id, ALL_POWER);
  // the tweezer has no "All beams" input: its one power is that already
  assert.ok(!knobs.some((k) => k.id === ALL_POWER));
  // the method: the scale alone in one step; with others, fitted per trial; else the search
  assert.equal(designMethod([power], tweezer, { x: 1e5 }).method, "scale");
  assert.equal(designMethod([power, na], tweezer, { x: 1e5, z: 4e4 }).method, "search+scale");
  assert.equal(designMethod([na], tweezer, { x: 1e5 }).method, "search");
});

test("All beams · power scales every beam and keeps their split", () => {
  const ws2 = preset("ws2-bottle");
  const knob = allPowerKnob();
  const total = knob.get(ws2);
  const doubled = knob.set(ws2, 2 * total);
  assert.ok(Math.abs(knob.get(doubled) - 2 * total) < 1e-15);
  const powers = (s: Setup) => s.trap.fields.map((f) => (f as BeamField).power);
  powers(doubled).forEach((p, i) => assert.ok(Math.abs(p - 2 * powers(ws2)[i]) < 1e-15));
});

/** A fake engine for the tweezer preset: every force goes as the power, and the NA sets f_z : f_x. */
function fakeTweezer(calls: Setup[]) {
  const base = RECORDED.tweezer!;
  const NA0 = ((preset("tweezer").trap.fields[0] as BeamField).focus as { NA: number }).NA;
  return async (s: Setup): Promise<Result | null> => {
    calls.push(s);
    const beam = s.trap.fields[0] as BeamField;
    const na = (beam.focus as { NA: number }).NA / NA0;
    const r = scaleResult(base, beam.power / 0.2);
    return { ...r, modes: r.modes.map((m) => ({ ...m, frequency: m.frequency! * (m.name === "z" ? na * na : na) })) };
  };
}

test("a power alone is set in one step: f_x 150 kHz on the tweezer takes one solve, 86.9 mW", async () => {
  const setup = preset("tweezer");
  const calls: Setup[] = [];
  const power = designKnobs(setup).find((k) => k.id === "beam0-power")!;
  const { method, best, solves } = await findDesign({ setup, result: RECORDED.tweezer!, chosen: [power], targets: { x: 150e3 }, solve: fakeTweezer(calls) });
  assert.equal(method, "scale");
  assert.equal(solves, 1);
  assert.equal(calls.length, 1);
  const P = power.get(best!.setup);
  assert.ok(Math.abs(P / 0.0869 - 1) < 1e-3, `P ${P}`);
  assert.ok(typicalMiss(best!.score, 1) < 1e-6);
  assert.equal(best!.clamped, null);
  // without the current result, one solve more
  const again = await findDesign({ setup, result: null, chosen: [power], targets: { x: 150e3 }, solve: fakeTweezer([]) });
  assert.equal(again.solves, 2);
  assert.ok(Math.abs(power.get(again.best!.setup) - P) < 1e-12);
});

test("a power beyond the allowed range is clamped, and the design says so", async () => {
  const setup = preset("tweezer");
  const power = designKnobs(setup).find((k) => k.id === "beam0-power")!;
  const { best, solves } = await findDesign({ setup, result: RECORDED.tweezer!, chosen: [power], targets: { x: 1e9 }, solve: fakeTweezer([]) });
  assert.equal(best!.clamped, "high");
  assert.ok(Math.abs(power.get(best!.setup) - POWER_RANGE[1]) < 1e-9);
  assert.ok(solves <= 2);
  const low = await findDesign({ setup: withPower(setup, 2e-6), result: null, chosen: [power], targets: { depth: 1e-9 }, solve: fakeTweezer([]) });
  assert.equal(low.best!.clamped, "low");
  assert.ok(Math.abs(power.get(low.best!.setup) - POWER_RANGE[0]) < 1e-15);
});

test("with the NA too, the search is over the NA alone, the power fitted for each trial", async () => {
  const setup = preset("tweezer");
  const knobs = designKnobs(setup);
  const chosen = [knobs.find((k) => k.id === "beam0-power")!, knobs.find((k) => k.id === "lens0-NA")!];
  // reachable: P = 0.5 W, NA = 0.6
  const want = (await fakeTweezer([])(chosen[1].set(withPower(setup, 0.5), 0.6)))!;
  const targets = { x: readTarget(want, "x")!, z: readTarget(want, "z")! };
  const calls: Setup[] = [];
  const { method, best, solves } = await findDesign({ setup, result: RECORDED.tweezer!, chosen, targets, solve: fakeTweezer(calls), budget: 40 });
  assert.equal(method, "search+scale");
  assert.equal(solves, calls.length);
  assert.ok(solves <= 40);
  assert.ok(!best!.predicted, "the fitted power is checked with a solve");
  assert.ok(typicalMiss(best!.score, 2) < 2e-3, `miss ${typicalMiss(best!.score, 2)}`);
  assert.ok(Math.abs(chosen[0].get(best!.setup) / 0.5 - 1) < 0.02, `P ${chosen[0].get(best!.setup)}`);
  assert.ok(Math.abs(chosen[1].get(best!.setup) / 0.6 - 1) < 0.01, `NA ${chosen[1].get(best!.setup)}`);
  // every trial is solved at the setup's own power: the scale is not searched
  for (const s of calls.slice(0, -1)) assert.equal((s.trap.fields[0] as BeamField).power, 0.2);
});

test("a check solve that fails is tried once more; if that fails too, the design stays a prediction", async () => {
  const setup = preset("tweezer");
  const knobs = designKnobs(setup);
  const chosen = [knobs.find((k) => k.id === "beam0-power")!, knobs.find((k) => k.id === "lens0-NA")!];
  const targets = { x: 150e3, z: 40e3 };
  // the trials are at the setup's power; only the checks are not
  const failing = (fails: number) => {
    const inner = fakeTweezer([]);
    let left = fails;
    return async (s: Setup) => ((s.trap.fields[0] as BeamField).power !== 0.2 && left-- > 0 ? null : inner(s));
  };
  const once = await findDesign({ setup, result: RECORDED.tweezer!, chosen, targets, solve: failing(1), budget: 20 });
  assert.equal(once.best!.predicted, false, "the second try checks it");
  assert.ok(once.solves <= 20);
  const twice = await findDesign({ setup, result: RECORDED.tweezer!, chosen, targets, solve: failing(2), budget: 20 });
  assert.equal(twice.best!.predicted, true, "both checks failed: still a prediction");
  assert.ok(twice.solves <= 20);
});
