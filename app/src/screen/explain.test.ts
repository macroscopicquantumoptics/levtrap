import assert from "node:assert/strict";
import { test } from "node:test";
import { explainDepth, explainFrequency, secondaryNumbers } from "./explain.ts";
import { PRESETS } from "./presets.ts";
import { RECORDED } from "./recorded.ts";

const tweezer = PRESETS.find((p) => p.id === "tweezer")!;
const paul = PRESETS.find((p) => p.id === "paul-linear")!;

test("every number of every recorded preset has an explanation with real values", () => {
  for (const preset of PRESETS) {
    const result = RECORDED[preset.id];
    if (!result) continue;
    const all = [
      ...result.modes.map((_, i) => explainFrequency(result, preset.setup, i)),
      explainDepth(result, preset.setup),
      ...secondaryNumbers(result, preset.setup).map((s) => s.explain()),
    ];
    for (const e of all) {
      assert.ok(e.title && e.formula, `${preset.id}: ${e.title}`);
      assert.doesNotMatch(e.value, /—|NaN|undefined/, `${preset.id}: ${e.title} value`);
      assert.ok(e.copy.length > 0);
      assert.ok(e.inputs.length >= 1);
      for (const input of e.inputs) assert.doesNotMatch(input.value, /—|NaN|undefined|Infinity/, `${preset.id}: ${e.title}: ${input.symbol}`);
      if (e.title !== "Mass") assert.ok(e.model, `${preset.id}: ${e.title} names its model`);
    }
  }
});

test("an optical frequency is explained by stiffness and mass", () => {
  const e = explainFrequency(RECORDED.tweezer!, tweezer.setup, 0);
  assert.equal(e.title, "Trap frequency along x");
  assert.equal(e.value, "227 kHz");
  assert.equal(e.formula, "optical-frequency");
  assert.deepEqual(
    e.inputs.map((i) => [i.symbol, i.value]),
    [
      ["k_x", "18.8 µN/m"],
      ["m", "9.22 fg"],
    ],
  );
  assert.equal(e.model?.name, "Mie theory (T-matrix): exact for a homogeneous sphere of any size");
  assert.equal(e.model?.validity, "Valid here");
  // the formula holds for the numbers shown
  const r = RECORDED.tweezer!;
  const f = Math.sqrt(r.modes[0].stiffness! / r.particle.mass) / (2 * Math.PI);
  assert.ok(Math.abs(f - r.modes[0].frequency!) < 1e-6 * f);
});

test("a Paul-trap frequency is explained by a, q and the RF frequency", () => {
  const r = RECORDED["paul-linear"]!;
  const e = explainFrequency(r, paul.setup, 0);
  assert.equal(e.value, "556 Hz");
  assert.equal(e.formula, "paul-pseudopotential");
  assert.deepEqual(
    e.inputs.map((i) => i.symbol),
    ["a_x", "q_x", String.raw`f_\mathrm{RF}`],
  );
  assert.equal(e.inputs[2].value, "5 kHz");
  // the formula holds for the numbers shown
  const f = (5000 / 2) * Math.sqrt(r.paul!.a.x + r.paul!.q.x ** 2 / 2);
  assert.ok(Math.abs(f - r.modes[0].frequency!) < 1e-6 * f, `${f} vs ${r.modes[0].frequency}`);
});

test("the depth is explained in joules, kelvin and per axis", () => {
  const e = explainDepth(RECORDED.tweezer!, tweezer.setup);
  assert.equal(e.value, "386 k_BT");
  assert.deepEqual(
    e.inputs.map((i) => [i.symbol, i.value]),
    [
      ["U", "1.60 aJ"],
      [String.raw`U / k_\mathrm{B}`, "116 kK"],
      ["T", "300 K"],
      ["U_x", "574 k_BT"],
      ["U_y", "574 k_BT"],
      ["U_z", "386 k_BT"],
    ],
  );
});


test("the second row: every number of a tweezer and of a Paul trap, explained", () => {
  const ids = (id: "tweezer" | "paul-linear") => secondaryNumbers(RECORDED[id]!, PRESETS.find((p) => p.id === id)!.setup).map((s) => s.id);
  assert.deepEqual(ids("tweezer"), ["position", "stiffness", "mass", "scattered", "absorbed", "damping", "reheating", "crossover"]);
  assert.deepEqual(ids("paul-linear"), ["position", "stiffness", "mass", "mathieu-q", "mathieu-a", "micromotion"]);
  const rows = secondaryNumbers(RECORDED.tweezer!, tweezer.setup);
  const row = (id: string) => rows.find((r) => r.id === id)!;
  assert.equal(row("absorbed").value, "14.0 aW");
  assert.equal(row("scattered").explain().formula, "scattered-power");
  assert.equal(row("damping").explain().formula, "gas-damping");
  // the mass formula holds for the numbers shown
  const m = (4 / 3) * Math.PI * tweezer.setup.particle.radius ** 3 * 2200;
  assert.ok(Math.abs(m - RECORDED.tweezer!.particle.mass) < 1e-6 * m);
  // the micromotion formula holds: A = |q x0| / 2 along y
  const r = RECORDED["paul-linear"]!;
  const A = Math.abs(r.paul!.q.y * r.equilibrium![1]) / 2;
  assert.ok(Math.abs(A - r.paul!.micromotion![1]) < 1e-6 * A);
});

test("a real lens adds what it does to the focus: moved, clipped, the trap axis tilted", async () => {
  const { ASPHERE_RESULT, ASPHERE_SETUP } = await import("./asphere.fixture.ts");
  const rows = secondaryNumbers(ASPHERE_RESULT, ASPHERE_SETUP);
  const row = (id: string) => rows.find((r) => r.id === id)!;
  const lens = ASPHERE_RESULT.lenses![0];
  // a tilt about y moves the focus along x (which way depends on how full the aperture is)
  assert.ok(Math.abs(lens.focus_shift[0]) > 1e-7 && Math.abs(lens.focus_shift[1]) < 1e-12, "along x");
  assert.equal(row("lens0-focus").label, "Focus moved by the lens");
  assert.equal(row("lens0-focus").explain().formula, "lens-focus-shift");
  assert.match(row("lens0-clipping").value, / %$/);
  assert.equal(row("lens0-axis").explain().formula, "trap-axis-tilt");
  assert.match(row("lens0-axis").value, /mrad$/);
});
