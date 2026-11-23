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
  // the tweezer's paper is read (C3) but levtrap disagrees with it (#61): named, not used
  const tweezer = PRESETS.find((p) => p.id === "tweezer")!;
  assert.equal(shortCitation(tweezer.references[0]), "Jain et al., Phys. Rev. Lett. 116, 243601 (2016)");
  assert.ok(tweezer.references.every((r) => r.status === "verified" && r.disagrees === 61));
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
  assert.deepEqual(ws2.references, []);
  const [b1, b2] = ws2.setup.trap.fields as BeamField[];
  // two coherent beams, opposite in phase, 0.8 W together
  assert.equal(b2.coherent_with, b1.id);
  assert.equal(b2.phase, Math.PI);
  assert.ok(Math.abs(b1.power + b2.power - 0.8) < 1e-12);
  // the engine holds the sphere above the dark focus (recorded)
  const r = RECORDED["ws2-bottle"]!;
  assert.ok(r.stable && r.equilibrium![2] > 0.2e-6 && r.equilibrium![2] < 0.3e-6);
});
