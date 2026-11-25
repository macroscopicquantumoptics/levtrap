import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, Setup } from "../../engine/types.ts";
import { ASPHERE_SETUP } from "../asphere.fixture.ts";
import { withField } from "../model.ts";
import { presetById } from "../presets.ts";
import { coherentGroupCount, radiationUnavailable, unavailableTabs } from "./availability.ts";

const preset = (id: string): Setup => presetById(id)!.setup;

test("the tweezer can compute every tab but the wavefront, which needs a real lens (#81)", () => {
  assert.deepEqual(Object.keys(unavailableTabs(preset("tweezer"))), ["wavefront"]);
  assert.match(unavailableTabs(preset("tweezer")).wavefront!, /Asphere 354330-C/);
});

test("counter-propagating beams: the radiation pattern is greyed out, with the engine's reason (#81, #76)", () => {
  const why = unavailableTabs(preset("counter")).radiation;
  assert.ok(why);
  assert.match(why, /along \+z through one focus/);
});

test("the dark trap's two coherent beams along +z through one focus have a radiation pattern", () => {
  assert.equal(radiationUnavailable(preset("ws2-bottle")), null);
});

test("a Paul trap without light: no radiation, heating, spectrum or wavefront, each saying why", () => {
  const out = unavailableTabs(preset("paul-linear"));
  assert.deepEqual(Object.keys(out).sort(), ["heating", "radiation", "spectrum", "wavefront"]);
  assert.match(out.radiation!, /no light/);
  assert.match(out.heating!, /no light/);
});

test("an asphere: the wavefront tab is open, the radiation pattern is not computed yet", () => {
  const out = unavailableTabs(ASPHERE_SETUP);
  assert.equal(out.wavefront, undefined);
  assert.match(out.radiation!, /asphere/);
});

test("a beam moved off the origin is not the engine's simple case", () => {
  const moved = withField<BeamField>(preset("tweezer"), 0, { position: [1e-6, 0, 0] });
  assert.ok(radiationUnavailable(moved));
});

test("coherent groups follow coherent_with as the engine groups them", () => {
  const b = (id: string, cw: string | null = null): BeamField => ({ kind: "beam", id, wavelength: 1e-6, power: 0.1, focus: { kind: "lens", NA: 0.8 }, coherent_with: cw });
  assert.equal(coherentGroupCount([b("a"), b("b")]), 2);
  assert.equal(coherentGroupCount([b("a"), b("b", "a")]), 1);
  assert.equal(coherentGroupCount([b("a"), b("b", "a"), b("c"), b("d", "c")]), 2);
  assert.equal(coherentGroupCount([b("a", "c"), b("b", "a"), b("c")]), 1);
});
