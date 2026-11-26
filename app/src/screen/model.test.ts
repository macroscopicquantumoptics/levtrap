import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETUP } from "../engine/setup.ts";
import type { BeamField } from "../engine/types.ts";
import {
  addField,
  canonical,
  newBeam,
  newGravity,
  newPaulTrap,
  partForPath,
  partsOf,
  removeField,
  withField,
  withParticle,
} from "./model.ts";
import { PRESETS, presetForSetup } from "./presets.ts";
import { initialState, reduce } from "./store.ts";

test("the default setup reads as particle, beam, lens, environment", () => {
  assert.deepEqual(
    partsOf(DEFAULT_SETUP).map((p) => [p.id, p.name, p.summary]),
    [
      ["particle", "Particle", "SiO₂ · 100 nm"],
      ["field:0", "Beam", "1064 nm · 200 mW"],
      ["lens:0", "Lens", "NA 0.8"],
      ["environment", "Environment", "1e-6 mbar · N₂ · 300 K"],
    ],
  );
});

test("a second beam numbers both beams and their lenses", () => {
  const two = addField(DEFAULT_SETUP, newBeam(DEFAULT_SETUP, "counter"));
  assert.deepEqual(
    partsOf(two).map((p) => p.name),
    ["Particle", "Beam 1", "Lens 1", "Beam 2", "Lens 2", "Environment"],
  );
});

test("a counter-propagating beam copies the first and reverses it", () => {
  const b = newBeam(DEFAULT_SETUP, "counter");
  const first = DEFAULT_SETUP.trap.fields[0] as BeamField;
  assert.deepEqual(b.direction, [0, 0, -1]);
  assert.equal(b.power, first.power);
  assert.equal(b.wavelength, first.wavelength);
  assert.deepEqual(b.focus, first.focus);
  assert.equal(b.coherent_with, null);
  assert.equal(b.id, "beam2");
  assert.deepEqual(newBeam(DEFAULT_SETUP, "co").direction, [0, 0, 1]);
});

test("a counter-propagating beam of a circular first beam keeps the lab-frame rotation (#71)", () => {
  // Polarisation is in each beam's own frame and circular light keeps its helicity:
  // "circular+" against beam 1 would turn the other way in the lab (σ⁺σ⁻, no standing wave).
  const withPol = (polarisation: BeamField["polarisation"]) => withField<BeamField>(DEFAULT_SETUP, 0, { polarisation });
  assert.equal(newBeam(withPol("circular+"), "counter").polarisation, "circular-");
  assert.equal(newBeam(withPol("circular-"), "counter").polarisation, "circular+");
  // a co-propagating beam shares beam 1's frame, so it copies the polarisation
  assert.equal(newBeam(withPol("circular+"), "co").polarisation, "circular+");
  // linear and Jones-vector polarisations are copied as they are
  assert.equal(newBeam(withPol("x"), "counter").polarisation, "x");
  assert.equal(newBeam(withPol("y"), "counter").polarisation, "y");
  assert.deepEqual(newBeam(withPol([[1, 0], [0, 1]]), "counter").polarisation, [[1, 0], [0, 1]]);
});

test("Paul trap and gravity read with their key values", () => {
  const s = addField(addField(withParticle(DEFAULT_SETUP, { charge: 50 }), newPaulTrap("linear")), newGravity());
  const parts = Object.fromEntries(partsOf(s).map((p) => [p.name, p.summary]));
  assert.equal(parts["Particle"], "SiO₂ · 100 nm · +50 e");
  assert.equal(parts["Paul trap"], "linear · 5 kHz · 300 V");
  assert.equal(parts["Gravity"], "9.81 m/s² down (−y)");
});

test("removing a beam clears the interference that pointed at it", () => {
  let s = addField(DEFAULT_SETUP, newBeam(DEFAULT_SETUP, "counter"));
  s = withField<BeamField>(s, 0, { coherent_with: "beam2" });
  s = removeField(s, 1);
  assert.equal(s.trap.fields.length, 1);
  assert.equal((s.trap.fields[0] as BeamField).coherent_with, null);
});

test("engine error paths point at a part", () => {
  assert.equal(partForPath("particle.charge"), "particle");
  assert.equal(partForPath("trap.fields[1].focus.NA"), "lens:1");
  assert.equal(partForPath("trap.fields[0].power"), "field:0");
  assert.equal(partForPath("environment.pressure"), "environment");
  assert.equal(partForPath("version"), null);
  assert.equal(partForPath(undefined), null);
});

test("equal setups have equal canonical text, whatever the key order", () => {
  assert.equal(canonical({ a: 1, b: [1, { d: 2, c: 3 }] }), canonical({ b: [1, { c: 3, d: 2 }], a: 1 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

test("a setup edited back to a preset's values is that preset again", () => {
  const edited = withField<BeamField>(DEFAULT_SETUP, 0, { power: 0.1 });
  assert.equal(presetForSetup(edited), undefined);
  assert.equal(presetForSetup(withField<BeamField>(edited, 0, { power: 0.2 }))?.id, "tweezer");
  // adding a counter-propagating beam to the tweezer gives the counter-propagating preset
  assert.equal(presetForSetup(addField(DEFAULT_SETUP, newBeam(DEFAULT_SETUP, "counter")))?.id, "counter");
});

test("presets have unique ids and names", () => {
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  assert.equal(new Set(PRESETS.map((p) => p.name)).size, PRESETS.length);
  assert.equal(PRESETS[0].setup, DEFAULT_SETUP);
});

test("edit, undo and redo move one snapshot at a time", () => {
  const s0 = initialState();
  const a = withField<BeamField>(s0.setup, 0, { power: 0.1 });
  const b = withField<BeamField>(a, 0, { power: 0.4 });
  let s = reduce(s0, { type: "edit", setup: a });
  s = reduce(s, { type: "edit", setup: b });
  assert.equal(s.past.length, 2);
  s = reduce(s, { type: "undo" });
  assert.equal(s.setup, a);
  s = reduce(s, { type: "undo" });
  assert.equal(s.setup, s0.setup);
  assert.equal(reduce(s, { type: "undo" }), s, "nothing left to undo");
  s = reduce(s, { type: "redo" });
  assert.equal(s.setup, a);
  s = reduce(s, { type: "edit", setup: b });
  assert.equal(s.future.length, 0, "a new edit drops the redo branch");
});

test("an edit that changes nothing is not an undo step", () => {
  const s0 = initialState();
  assert.equal(reduce(s0, { type: "edit", setup: s0.setup }).past.length, 0);
});

test("selection follows the parts that exist", () => {
  const s0 = initialState();
  const two = addField(s0.setup, newBeam(s0.setup, "counter"));
  let s = reduce(s0, { type: "edit", setup: two, select: "field:1" });
  assert.equal(s.selected, "field:1");
  s = reduce(s, { type: "undo" });
  assert.equal(s.selected, null, "the selected beam no longer exists");
  s = reduce(s, { type: "select", id: "lens:0" });
  assert.equal(s.selected, "lens:0");
  assert.equal(reduce(s, { type: "select", id: "field:7" }).selected, null);
});

test("loading a preset clears selection and history", () => {
  let s = reduce(initialState(), { type: "edit", setup: withParticle(DEFAULT_SETUP, { radius: 2e-7 }), select: "particle" });
  s = reduce(s, { type: "load", preset: PRESETS[2] });
  assert.equal(s.preset.id, "paul-linear");
  assert.equal(s.setup, PRESETS[2].setup);
  assert.equal(s.selected, null);
  assert.equal(s.past.length, 0);
});
