import assert from "node:assert/strict";
import { test } from "node:test";
import { explainDepth, explainFrequency } from "./explain.ts";
import { PRESETS } from "./presets.ts";
import { RECORDED } from "./recorded.ts";

const tweezer = PRESETS.find((p) => p.id === "tweezer")!;
const paul = PRESETS.find((p) => p.id === "paul-linear")!;

test("every number of every recorded preset has an explanation with real values", () => {
  for (const preset of PRESETS) {
    const result = RECORDED[preset.id];
    if (!result) continue;
    const all = [...result.modes.map((_, i) => explainFrequency(result, preset.setup, i)), explainDepth(result, preset.setup)];
    for (const e of all) {
      assert.ok(e.title && e.formula, `${preset.id}: ${e.title}`);
      assert.doesNotMatch(e.value, /—|NaN|undefined/, `${preset.id}: ${e.title} value`);
      assert.ok(e.copy.length > 0);
      assert.ok(e.inputs.length >= 2);
      for (const input of e.inputs) assert.doesNotMatch(input.value, /—|NaN|undefined|Infinity/, `${preset.id}: ${e.title}: ${input.symbol}`);
      assert.ok(e.model, `${preset.id}: ${e.title} names its model`);
    }
  }
});

test("an optical frequency is explained by stiffness and mass", () => {
  const e = explainFrequency(RECORDED.tweezer!, tweezer.setup, 0);
  assert.equal(e.title, "Trap frequency along x");
  assert.equal(e.value, "227 kHz");
  assert.equal(e.formula, "f = √(k / m) / 2π");
  assert.deepEqual(
    e.inputs.map((i) => [i.symbol, i.value]),
    [
      ["k", "18.8 µN/m"],
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
  assert.equal(e.formula, "f = (f_RF / 2) · √(a + q² / 2)");
  assert.deepEqual(
    e.inputs.map((i) => i.symbol),
    ["a", "q", "f_RF"],
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
      ["U / k_B", "116 kK"],
      ["T", "300 K"],
      ["U_x", "574 k_BT"],
      ["U_y", "574 k_BT"],
      ["U_z", "386 k_BT"],
    ],
  );
});
