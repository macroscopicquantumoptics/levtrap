import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, Setup } from "../../engine/types.ts";
import { ASPHERE_SETUP } from "../asphere.fixture.ts";
import { MIRROR_SETUP } from "../mirror.fixture.ts";
import { withField } from "../model.ts";
import { presetById } from "../presets.ts";
import { radiationUnavailable, unavailableTabs } from "./availability.ts";

const preset = (id: string): Setup => presetById(id)!.setup;

test("the tweezer can compute every tab but the wavefront, which needs a real lens (#81)", () => {
  assert.deepEqual(Object.keys(unavailableTabs(preset("tweezer"))), ["wavefront"]);
  assert.match(unavailableTabs(preset("tweezer")).wavefront!, /Asphere 354330-C/);
});

test("counter-propagating beams have a radiation pattern, as the engine now computes it (#76)", () => {
  assert.equal(radiationUnavailable(preset("counter")), null);
  assert.equal(unavailableTabs(preset("counter")).radiation, undefined);
});

test("the dark trap's two coherent beams along +z through one focus have a radiation pattern", () => {
  assert.equal(radiationUnavailable(preset("ws2-bottle")), null);
});

test("opposing beams that interfere, or a beam moved off the origin or tilted, have a radiation pattern (#76)", () => {
  const coherent = withField<BeamField>(preset("counter"), 1, { coherent_with: "beam1" });
  assert.equal(radiationUnavailable(coherent), null);
  assert.equal(radiationUnavailable(withField<BeamField>(preset("tweezer"), 0, { position: [1e-6, 0, 0] })), null);
  assert.equal(radiationUnavailable(withField<BeamField>(preset("tweezer"), 0, { direction: [1, 0, 1] })), null);
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

test("a parabolic mirror: the radiation pattern is not computed yet", () => {
  assert.match(radiationUnavailable(MIRROR_SETUP)!, /parabolic mirror/);
});
