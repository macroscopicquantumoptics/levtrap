import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, PaulField, Pattern } from "../../engine/types.ts";
import { PRESETS } from "../presets.ts";
import { environmentOf } from "../model.ts";
import { RECORDED } from "../recorded.ts";
import {
  coherentGroups,
  defaultRange,
  followFrom,
  idealNA,
  infoCollector,
  informationOutput,
  jumpsAt,
  logByDefault,
  naLadder,
  OUTPUTS,
  sweepParams,
  sweepValues,
  unstableRuns,
  type InfoChoice,
} from "./sweep.ts";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.setup;

test("a tweezer sweeps its beam, lens, particle and environment", () => {
  assert.deepEqual(
    sweepParams(preset("tweezer")).map((p) => p.id),
    ["beam0-power", "beam0-wavelength", "lens0-NA", "particle-radius", "environment-pressure", "environment-temperature"],
  );
  assert.deepEqual(
    sweepParams(preset("paul-linear")).map((p) => p.id),
    ["paul0-rf_voltage", "paul0-rf_frequency", "paul0-endcap_voltage", "paul0-dc_voltage", "particle-radius", "particle-charge", "environment-pressure", "environment-temperature"],
  );
});

test("a parameter reads and writes its setup without touching the original", () => {
  const s = preset("tweezer");
  const power = sweepParams(s).find((p) => p.id === "beam0-power")!;
  assert.equal(power.get(s), 0.2);
  const t = power.set(s, 0.1);
  assert.equal((t.trap.fields[0] as BeamField).power, 0.1);
  assert.equal((s.trap.fields[0] as BeamField).power, 0.2);
  const na = sweepParams(s).find((p) => p.id === "lens0-NA")!;
  assert.deepEqual((na.set(s, 0.6).trap.fields[0] as BeamField).focus, { kind: "lens", NA: 0.6 });
  const rf = sweepParams(preset("paul-linear")).find((p) => p.id === "paul0-rf_frequency")!;
  assert.equal((rf.set(preset("paul-linear"), 3e3).trap.fields[0] as PaulField).rf_frequency, 3e3);
});

test("values, evenly or in log, and the default ranges", () => {
  assert.deepEqual(sweepValues(0, 1, 5, false), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(
    sweepValues(1, 100, 3, true).map((v) => Math.round(v)),
    [1, 10, 100],
  );
  const s = preset("tweezer");
  const p = sweepParams(s);
  assert.deepEqual(defaultRange(p.find((x) => x.id === "beam0-power")!, s), [0.1, 0.4]);
  const [lo, hi] = defaultRange(p.find((x) => x.id === "environment-pressure")!, s);
  assert.ok(Math.abs(lo - 1e-5) < 1e-12 && Math.abs(hi - 1e-3) < 1e-12);
  const na = defaultRange(p.find((x) => x.id === "lens0-NA")!, s);
  assert.ok(Math.abs(na[0] - 0.3) < 1e-12 && Math.abs(na[1] - 0.95) < 1e-12);
});

test("an NA sweep keeps the lens model: a sine mapping and a filling stay (#72)", () => {
  const s = preset("tweezer");
  const withFocus = (focus: BeamField["focus"]) => ({ ...s, trap: { ...s.trap, fields: [{ ...(s.trap.fields[0] as BeamField), focus }, ...s.trap.fields.slice(1)] } });
  const sine = withFocus({ kind: "lens", NA: 0.8, mapping: "sine" });
  const na = sweepParams(sine).find((p) => p.id === "lens0-NA")!;
  assert.deepEqual((na.set(sine, 0.6).trap.fields[0] as BeamField).focus, { kind: "lens", NA: 0.6, mapping: "sine" });
  const filled = withFocus({ kind: "lens", NA: 0.9, filling: 1.2 });
  assert.deepEqual((na.set(filled, 0.7).trap.fields[0] as BeamField).focus, { kind: "lens", NA: 0.7, filling: 1.2 });
});

test("a lens given by waist or half-angle starts from its own NA, and the sweep drops only the waist (#72)", () => {
  const s = preset("ws2-bottle");
  const beam = s.trap.fields[0] as BeamField;
  const n = environmentOf(s).medium_index;
  const na = sweepParams(s).find((p) => p.id === "lens0-NA")!;
  // OTT's relation tan θ = λ_m / (π W) for the Gaussian (order 0)
  const expected = n * Math.sin(Math.atan(beam.wavelength / n / (Math.PI * (beam.focus as { waist: number }).waist)));
  assert.ok(Math.abs(na.get(s) - expected) < 1e-12);
  assert.ok(Math.abs(na.get(s) - 0.8) > 0.1, "not the old fallback of 0.8");
  const [lo, hi] = defaultRange(na, s);
  assert.ok(lo < na.get(s) && na.get(s) < hi);
  assert.deepEqual((na.set(s, 0.4).trap.fields[0] as BeamField).focus, { kind: "lens", NA: 0.4 });
  // the LG₁₀ beam's waist means a wider angle (its paraxial waist factor)
  const lg = sweepParams(s).find((p) => p.id === "lens1-NA")!;
  const b1 = s.trap.fields[1] as BeamField;
  const gaussian = n * Math.sin(Math.atan(b1.wavelength / n / (Math.PI * (b1.focus as { waist: number }).waist)));
  assert.equal(lg.get(s), idealNA(b1, n));
  assert.ok(lg.get(s) > gaussian);
  // a sine-mapped half-angle lens: NA = n sin θ, the mapping kept
  const angled = { ...s, trap: { ...s.trap, fields: [{ ...beam, focus: { kind: "lens" as const, angle_deg: 30, mapping: "sine" as const } }, s.trap.fields[1]] } };
  assert.ok(Math.abs(na.get(angled) - n * 0.5) < 1e-12);
  assert.deepEqual((na.set(angled, 0.6).trap.fields[0] as BeamField).focus, { kind: "lens", NA: 0.6, mapping: "sine" });
});

test("log spacing starts on only over a decade or more: a 290–310 nm radius sweep is linear (#72)", () => {
  const s = preset("tweezer");
  const radius = sweepParams(s).find((p) => p.id === "particle-radius")!;
  assert.equal(logByDefault(290e-9, 310e-9), false);
  const xs = sweepValues(290e-9, 310e-9, 21, logByDefault(290e-9, 310e-9));
  assert.ok(Math.abs(xs[10] - 300e-9) < 1e-18, "the middle point is 300 nm");
  assert.ok(xs.every((x, i) => Math.abs(x - (290 + i) * 1e-9) < 1e-18), "whole nanometres");
  // the default ranges that span decades (radius, pressure) still start in log
  assert.equal(logByDefault(...defaultRange(radius, s)), true);
  const pressure = sweepParams(s).find((p) => p.id === "environment-pressure")!;
  assert.equal(logByDefault(...defaultRange(pressure, s)), true);
  // and those within a decade, or through zero, do not
  const power = sweepParams(s).find((p) => p.id === "beam0-power")!;
  assert.equal(logByDefault(...defaultRange(power, s)), false);
  assert.equal(logByDefault(0, 10), false);
  assert.equal(logByDefault(10, 1), true);
});

test("the outputs read a result", () => {
  const r = RECORDED.tweezer!;
  const s = preset("tweezer");
  const read = (id: string) => OUTPUTS.find((o) => o.id === id)!.read(r, s);
  assert.deepEqual(
    read("frequencies").map((v) => v.name),
    ["x", "y", "z"],
  );
  assert.equal(read("depth")[0].value, r.depth.kT);
  assert.equal(read("position")[0].value, r.equilibrium![2]);
  assert.equal(read("scattered")[0].value, r.optical!.P_sca);
  // no trap: no frequencies
  assert.deepEqual(
    OUTPUTS[0].read({ ...r, stable: false }, s).map((v) => v.value),
    [null, null, null],
  );
});

test("unstable runs reach halfway to their stable neighbours", () => {
  assert.deepEqual(unstableRuns([0, 1, 2, 3, 4], [true, false, false, true, true]), [[0.5, 2.5]]);
  assert.deepEqual(unstableRuns([0, 1, 2], [false, true, false]), [
    [0, 0.5],
    [1.5, 2],
  ]);
  assert.deepEqual(unstableRuns([0, 1], [true, true]), []);
});

test("a real lens sweeps its beam diameter and tilts, not an NA", async () => {
  const { ASPHERE_SETUP } = await import("../asphere.fixture.ts");
  const params = sweepParams(ASPHERE_SETUP);
  const ids = params.map((p) => p.id);
  assert.ok(ids.includes("lens0-beam_diameter") && ids.includes("lens0-tilt_y"));
  assert.ok(!ids.includes("lens0-NA"));
  const tilt = params.find((p) => p.id === "lens0-tilt_y")!;
  assert.equal(tilt.get(ASPHERE_SETUP), 0.3);
  const t = tilt.set(ASPHERE_SETUP, 0.5);
  const focus = (t.trap.fields[0] as BeamField).focus;
  assert.equal(focus.kind, "asphere");
  assert.deepEqual(focus.kind === "asphere" && focus.tilt_deg, [0, 0.5]);
  assert.deepEqual(defaultRange(tilt, ASPHERE_SETUP), [-1, 1]);
});

test("a parabolic mirror sweeps its beam, size and hole", async () => {
  const { MIRROR_SETUP } = await import("../mirror.fixture.ts");
  const params = sweepParams(MIRROR_SETUP);
  const ids = params.map((p) => p.id);
  assert.deepEqual(
    ids.filter((id) => id.startsWith("lens0")),
    ["lens0-beam_diameter", "lens0-focal_length", "lens0-rim_radius", "lens0-hole_radius"],
  );
  const hole = params.find((p) => p.id === "lens0-hole_radius")!;
  assert.equal(hole.get(MIRROR_SETUP), 5e-4);
  const t = hole.set(MIRROR_SETUP, 1e-3);
  const focus = (t.trap.fields[0] as BeamField).focus;
  assert.equal(focus.kind === "parabolic_mirror" && focus.hole_radius, 1e-3);
  assert.deepEqual(defaultRange(hole, MIRROR_SETUP), [0, 4.5e-3]);
});

test("continuation: the next start is the last stable equilibrium, and jumps are marked", () => {
  const r = RECORDED.tweezer!;
  const lost = { ...r, stable: false, equilibrium: null };
  const moved = { ...r, equilibrium: [1e-7, 0, 2e-7] as [number, number, number], followed: { start: r.equilibrium!, jumped: true } };
  assert.equal(followFrom([]), null);
  assert.deepEqual(followFrom([r, lost]), r.equilibrium);
  assert.deepEqual(followFrom([r, lost, moved, null]), [1e-7, 0, 2e-7]);
  assert.deepEqual(jumpsAt([0, 1, 2], [r, lost, moved]), [2]);
});

test("the new outputs: absorbed power, and recoil heating per mode", () => {
  const r = RECORDED.tweezer!;
  const read = (id: string) => OUTPUTS.find((o) => o.id === id)!.read(r, preset("tweezer"));
  assert.equal(read("absorbed")[0].value, r.optical!.P_abs);
  assert.deepEqual(
    read("recoil").map((v) => [v.name, v.value]),
    r.rates!.modes.map((m) => [m.name, m.recoil_heating]),
  );
});

// --- #79: the phase and split of coherent beams, and the information a lens collects -------------

test("a coherent pair sweeps the second beam's phase and the pair's split; incoherent beams do neither (#79)", () => {
  const ids = sweepParams(preset("ws2-bottle")).map((p) => p.id);
  assert.ok(ids.includes("beam1-phase") && ids.includes("pair0-1-split"));
  // only differences of phase matter: the first beam of the group has none to sweep
  assert.ok(!ids.includes("beam0-phase"));
  const counter = sweepParams(preset("counter")).map((p) => p.id);
  assert.ok(!counter.some((id) => id.endsWith("-phase") || id.endsWith("-split")));
});

test("the coherent groups follow coherent_with through other beams, in setup order (#79)", () => {
  const s = preset("ws2-bottle");
  const [b1, b2] = s.trap.fields as BeamField[];
  const three = { ...s, trap: { fields: [{ kind: "gravity" as const }, b1, b2, { ...b2, id: "b3", coherent_with: "b2" }, { ...b1, id: "lone" }] } };
  assert.deepEqual(coherentGroups(three), [[1, 2, 3], [4]]);
  const ids = sweepParams(three).map((p) => p.id);
  // a group of three has phases but no single split
  assert.ok(ids.includes("beam2-phase") && ids.includes("beam3-phase") && !ids.some((id) => id.endsWith("-split")));
});

test("the split moves power between the pair at a fixed total, and the phase reads and writes the beam (#79)", () => {
  const s = preset("ws2-bottle");
  const params = sweepParams(s);
  const split = params.find((p) => p.id === "pair0-1-split")!;
  assert.ok(Math.abs(split.get(s) - 0.5034 / 0.8) < 1e-12);
  const t = split.set(s, 0.25);
  const [a, b] = (t.trap.fields as BeamField[]).map((f) => f.power);
  assert.ok(Math.abs(a + b - 0.8) < 1e-12 && Math.abs(b - 0.2) < 1e-12);
  assert.equal((s.trap.fields[1] as BeamField).power, 0.5034);
  assert.equal(split.check(1.2), "A fraction from 0 to 1.");
  assert.equal(split.check(0), null);
  assert.deepEqual(defaultRange(split, s), [0, 1]);
  const phase = params.find((p) => p.id === "beam1-phase")!;
  assert.equal(phase.get(s), Math.PI);
  assert.equal((phase.set(s, 0.5).trap.fields[1] as BeamField).phase, 0.5);
  assert.deepEqual(defaultRange(phase, s), [0, 2 * Math.PI]);
  assert.equal(phase.quantity, "phase");
});

test("the NA ladder is the engine's: 0.05 steps below the medium index, then the index (#79)", () => {
  const one = naLadder(1);
  assert.equal(one.length, 20);
  assert.deepEqual([one[0], one[1], one[18], one[19]], [0.05, 0.1, 0.95, 1]);
  assert.deepEqual(naLadder(1.33).slice(-2), [1.3, 1.33]);
});

/** A pattern block cut down to what the information output reads: three NAs, forward and backward. */
const cones = (scale: number) => ({ x: [0.1, 0.2, 0.3].map((v) => v * scale), y: [0.05, 0.1, 0.15].map((v) => v * scale), z: [0.2, 0.3, 0.4].map((v) => v * scale) });
const pattern = {
  NA: [0.4, 0.8, 1],
  information_efficiency: { forward: cones(1), backward: cones(2) },
  trap_NA: 0.8,
  at_trap_NA: {
    forward: { collection: 0.3, information: { x: 0.2, y: 0.1, z: 0.3 } },
    backward: { collection: 0.2, information: { x: 0.4, y: 0.2, z: 0.6 } },
  },
} as unknown as Pattern;

test("the information output reads the pattern as the Radiation tab does, and asks for it (#79)", () => {
  const r = { ...RECORDED.tweezer!, pattern };
  const s = preset("tweezer");
  const read = (choice: InfoChoice) => informationOutput(choice).read(r, s);
  assert.deepEqual(informationOutput({ direction: "backward", axis: "all", NA: null }).want, ["pattern"]);
  // at the trapping lens's NA: the engine's at_trap_NA, per axis
  assert.deepEqual(read({ direction: "backward", axis: "all", NA: null }), [
    { name: "x", value: 0.4 },
    { name: "y", value: 0.2 },
    { name: "z", value: 0.6 },
  ]);
  // forward + backward add
  assert.ok(Math.abs(read({ direction: "both", axis: "z", NA: null })[0].value! - 0.9) < 1e-12);
  // at an NA of the ladder: that entry, not an interpolation
  assert.deepEqual(read({ direction: "forward", axis: "y", NA: 1 }), [{ name: "y", value: 0.15 }]);
  assert.ok(Math.abs(read({ direction: "both", axis: "x", NA: 0.4 })[0].value! - 0.3) < 1e-12);
  // an NA the engine did not give, or a result without the pattern: no value
  assert.deepEqual(read({ direction: "forward", axis: "x", NA: 0.55 }), [{ name: "x", value: null }]);
  assert.deepEqual(informationOutput({ direction: "forward", axis: "x", NA: null }).read(RECORDED.tweezer!, s), [{ name: "x", value: null }]);
});

test("the information plot's title names the lens (#79)", () => {
  assert.equal(infoCollector({ direction: "backward", axis: "x", NA: null }), "the trapping lens");
  assert.equal(infoCollector({ direction: "both", axis: "x", NA: null }), "the trapping lens and a forward lens of its NA");
  assert.equal(infoCollector({ direction: "forward", axis: "x", NA: 0.9 }), "a forward lens of NA 0.9");
});
