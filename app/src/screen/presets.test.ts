import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETUP } from "../engine/setup.ts";
import type { BeamField } from "../engine/types.ts";
import { withParticle } from "./model.ts";
import { buildPresets, PRESETS } from "./presets.ts";
import type { Reference } from "./referenceTypes.ts";
import { shortCitation } from "./referenceTypes.ts";
import { RECORDED } from "./recorded.ts";
import { REFERENCES } from "./references.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("references.ts is generated from docs/validation/references.json", () => {
  const data = JSON.parse(readFileSync(`${repo}docs/validation/references.json`, "utf8"));
  const ids = (list: { id: string }[]) => list.map((e) => e.id);
  assert.deepEqual(
    REFERENCES.filter((r) => r.status === "verified").map((r) => r.id),
    ids(data.verified),
    "run npm run record",
  );
  assert.deepEqual(
    REFERENCES.filter((r) => r.status === "wanted").map((r) => r.id),
    ids(data.wanted),
    "run npm run record",
  );
});

test("today every preset is example values, waiting for its paper or naming one levtrap disagrees with", () => {
  for (const p of PRESETS.filter((x) => !x.illustrative)) {
    assert.equal(p.source, "Example values, not from a paper yet");
    assert.ok(p.references.length > 0, `${p.id} names a paper to check`);
    assert.ok(p.references.every((r) => (r.status === "wanted" || r.disagrees) && r.slot === p.slot));
  }
  // the tweezer's papers are read (C3, C4) but levtrap disagrees with both (#61, #70): named, not used
  const tweezer = PRESETS.find((p) => p.id === "tweezer")!;
  assert.equal(shortCitation(tweezer.references[0]), "Jain et al., Phys. Rev. Lett. 116, 243601 (2016)");
  assert.ok(tweezer.references.every((r) => r.status === "verified" && r.disagrees));
  assert.deepEqual([...new Set(tweezer.references.map((r) => r.disagrees))], [61, 70]);
});

test("a verified paper's setup replaces the example of its trap type, and is cited", () => {
  const paper: Reference = {
    id: "someone2030",
    slot: "single_beam_tweezer",
    status: "verified",
    authors: "A. Someone, B. Other, C. Third",
    title: "A tweezer",
    journal: "Phys. Rev. A 1, 1 (2030)",
    doi: null,
    setup: withParticle(DEFAULT_SETUP, { radius: 7.5e-8 }),
    schema_gaps: [],
  };
  const presets = buildPresets([...REFERENCES, paper]);
  const tweezer = presets.find((p) => p.id === "tweezer")!;
  assert.equal(tweezer.setup.particle.radius, 7.5e-8);
  assert.equal(tweezer.source, "A. Someone et al., Phys. Rev. A 1, 1 (2030)");
  assert.deepEqual(tweezer.references, [paper]);
  // a paper levtrap disagrees with is named but not used
  const disputed = buildPresets([{ ...paper, disagrees: 99 }]).find((p) => p.id === "tweezer")!;
  assert.equal(disputed.setup, DEFAULT_SETUP);
  assert.deepEqual(disputed.references, [{ ...paper, disagrees: 99 }]);
  // a setup the schema cannot hold yet stays out
  const gapped = buildPresets([{ ...paper, schema_gaps: ["focus.kind"] }]).find((p) => p.id === "tweezer")!;
  assert.equal(gapped.setup, DEFAULT_SETUP);
});

test("the WS2 bottle beam is illustrative, not validated, and its focus is dark", () => {
  const ws2 = PRESETS.find((p) => p.id === "ws2-bottle")!;
  assert.ok(ws2.illustrative);
  assert.match(ws2.source, /^Illustrative, not validated: after Illetschek et al\., arXiv:2607\.09896/);
  // its paper is read (C4) but does not state the power split: named, still to check
  assert.deepEqual(ws2.references.map((r) => [r.id, r.status]), [["illetschek2026_ws2_dark_trap", "wanted"]]);
  const [b1, b2] = ws2.setup.trap.fields as BeamField[];
  // two coherent beams, opposite in phase, 0.8 W together
  assert.equal(b2.coherent_with, b1.id);
  assert.equal(b2.phase, Math.PI);
  assert.ok(Math.abs(b1.power + b2.power - 0.8) < 1e-12);
  // the engine holds the sphere above the dark focus (recorded)
  const r = RECORDED["ws2-bottle"]!;
  assert.ok(r.stable && r.equilibrium![2] > 0.2e-6 && r.equilibrium![2] < 0.3e-6);
});

test("the counter-propagating bottle beams are the WS2 pair from both sides, holding the sphere at the dark focus (#71, #97)", () => {
  const ws2 = PRESETS.find((p) => p.id === "ws2-bottle")!;
  const both = PRESETS.find((p) => p.id === "ws2-counter-bottle")!;
  assert.ok(both.illustrative);
  assert.equal(both.slot, "dark_trap");
  assert.match(both.source, /^Illustrative, not validated: the mirror-symmetric trap of #71/);
  assert.deepEqual(both.references.map((r) => r.id), ["illetschek2026_ws2_dark_trap"]);
  const beams = both.setup.trap.fields as BeamField[];
  const pair = ws2.setup.trap.fields as BeamField[];
  assert.equal(beams.length, 4);
  // all four interfere, as #71 set them up
  assert.ok(beams.slice(1).every((b) => b.coherent_with === "b1"));
  // each pair is the WS2 bottle beam at half its power, in the same split
  beams.forEach((b, i) => {
    const p = pair[i % 2];
    assert.ok(Math.abs(b.power - p.power / 2) < 1e-12);
    assert.deepEqual([b.mode, b.focus, b.wavelength], [p.mode, p.focus, p.wavelength]);
  });
  // the second pair goes the other way, turned by 180° about x: Circular − and the phases swapped
  assert.deepEqual(beams.map((b) => b.direction ?? [0, 0, 1]), [[0, 0, 1], [0, 0, 1], [0, 0, -1], [0, 0, -1]]);
  assert.deepEqual(beams.map((b) => b.polarisation), ["circular+", "circular+", "circular-", "circular-"]);
  assert.deepEqual(beams.map((b) => b.phase ?? 0), [0, Math.PI, Math.PI, 0]);
  // mirror symmetry puts the sphere at the dark focus, held in all three directions (recorded)
  const r = RECORDED["ws2-counter-bottle"]!;
  assert.ok(r.stable && Math.max(...r.equilibrium!.map(Math.abs)) < 1e-12);
  const f = Object.fromEntries(r.modes!.map((m) => [m.name, m.frequency ?? NaN]));
  assert.ok(Math.abs(f.x / f.y - 1) < 1e-6 && f.z > f.x);
});
