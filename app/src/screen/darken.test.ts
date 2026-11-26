import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, Result, Setup } from "../engine/types.ts";
import { darkened, darkFocus } from "./darken.ts";
import { PRESETS } from "./presets.ts";
import { RECORDED } from "./recorded.ts";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.setup;
const powers = (s: Setup) => s.trap.fields.map((f) => (f as BeamField).power);

test("the WS2 bottle beam is already dark: the button reproduces its split within the preset's rounding (#79)", () => {
  const s = preset("ws2-bottle");
  const r = RECORDED["ws2-bottle"]!;
  const dark = darkFocus(s, r, 1)!;
  assert.deepEqual(dark.pair, [0, 1]);
  // the engine's split, OTT's for this pair (tests/test_dark_split.py), and a null at the focus
  assert.ok(Math.abs(dark.split - 0.6292439) < 1e-6);
  assert.ok(dark.residual < 1e-9);
  // the preset's powers are this split of 0.8 W, rounded to 0.1 mW
  const [p1, p2] = powers(darkened(s, dark));
  assert.ok(Math.abs(p1 - 0.2966) < 5e-5 && Math.abs(p2 - 0.5034) < 5e-5);
  assert.ok(Math.abs(p1 + p2 - 0.8) < 1e-12);
  assert.ok(Math.abs(dark.now - dark.split) < 5e-4);
  // either beam of the pair offers it
  assert.deepEqual(darkFocus(s, r, 0), dark);
});

test("an even split is set to the dark one at the same total power (#79)", () => {
  const s = preset("ws2-bottle");
  const even = { ...s, trap: { fields: s.trap.fields.map((f) => ({ ...(f as BeamField), power: 0.4 })) } };
  const dark = darkFocus(even, RECORDED["ws2-bottle"]!, 1)!;
  assert.equal(dark.now, 0.5);
  const [p1, p2] = powers(darkened(even, dark));
  assert.ok(Math.abs(p2 / (p1 + p2) - dark.split) < 1e-12 && Math.abs(p1 + p2 - 0.8) < 1e-12);
});

test("no button without a pair in the result, for a group of three, or for a split that would empty a beam (#79)", () => {
  const s = preset("ws2-bottle");
  const r = RECORDED["ws2-bottle"]!;
  // a result from another setup has no such pair
  assert.equal(darkFocus(s, RECORDED.tweezer!, 1), null);
  assert.equal(darkFocus(s, null, 1), null);
  // a beam that interferes with nothing
  assert.equal(darkFocus(preset("counter"), RECORDED.counter!, 0), null);
  // three beams in one group have no single split
  const [b1, b2] = s.trap.fields as BeamField[];
  const three: Setup = { ...s, trap: { fields: [b1, b2, { ...b2, id: "b3", coherent_with: "b2" }] } };
  assert.equal(darkFocus(three, r, 1), null);
  // one of the two dark at the focus (a doughnut): only all the power in it darkens the focus
  const doughnut = { ...r, coherent: [{ fields: [0, 1] as [number, number], dark_split: 1, residual: 1 }] } as Result;
  assert.equal(darkFocus(s, doughnut, 1), null);
});
