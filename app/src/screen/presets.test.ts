import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETUP } from "../engine/setup.ts";
import { withParticle } from "./model.ts";
import { buildPresets, PRESETS } from "./presets.ts";
import type { Reference } from "./referenceTypes.ts";
import { shortCitation } from "./referenceTypes.ts";
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

test("today every preset is example values, waiting for its paper", () => {
  for (const p of PRESETS) {
    assert.equal(p.source, "Example values, not from a paper yet");
    assert.ok(p.references.length > 0, `${p.id} names a paper to check`);
    assert.ok(p.references.every((r) => r.status === "wanted" && r.slot === p.slot));
  }
  assert.equal(shortCitation(PRESETS[0].references[0]), "Jain et al., Phys. Rev. Lett. 116, 243601 (2016)");
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
  // a setup the schema cannot hold yet stays out
  const gapped = buildPresets([{ ...paper, schema_gaps: ["focus.kind"] }]).find((p) => p.id === "tweezer")!;
  assert.equal(gapped.setup, DEFAULT_SETUP);
});
