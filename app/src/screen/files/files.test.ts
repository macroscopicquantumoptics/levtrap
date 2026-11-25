import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, Setup } from "../../engine/types.ts";
import { addField, canonical, newPaulTrap, withField, withParticle } from "../model.ts";
import { PRESETS } from "../presets.ts";
import { RECORDED } from "../recorded.ts";
import { pythonLiteral, pythonSnippet } from "./python.ts";
import { resultRows, resultsCsv, resultsJson } from "./results.ts";
import { linkFragment, readLinkFragment, readSetupText, roundNumber, setupFileText, shareUrl } from "./setupText.ts";

/** Every preset, and each edited a little: what people save and share. */
function setups(): Setup[] {
  const out: Setup[] = [];
  for (const p of PRESETS) {
    out.push(p.setup);
    out.push(withParticle(p.setup, { radius: 1.234567e-7, material: null, n: 1.5, k: 0.001, density: 1900 }));
  }
  const t = PRESETS[0].setup;
  out.push(withField<BeamField>(t, 0, { power: 0.123456789, direction: [0, 0.6, 0.8], polarisation: [[0.6, 0], [0, 0.8]] }));
  out.push(addField(withParticle(t, { charge: 30 }), newPaulTrap("linear")));
  return out;
}

test("save, then open: the identical setup", () => {
  for (const s of setups()) {
    const opened = readSetupText(setupFileText(s));
    assert.ok(opened.ok);
    if (opened.ok) {
      assert.deepEqual(opened.setup, s);
      assert.equal(canonical(opened.setup), canonical(s));
    }
  }
});

test("share, then load the link: the identical setup", () => {
  for (const s of setups()) {
    const back = readLinkFragment(linkFragment(s));
    assert.ok(back?.ok);
    if (back?.ok) assert.deepEqual(back.setup, s);
  }
  // a preset's link is short enough to paste anywhere
  assert.ok(linkFragment(PRESETS[0].setup).length < 400, String(linkFragment(PRESETS[0].setup).length));
});

test("a link and a file carry no float noise: 129.8 mW is stored as 0.1298 (#81)", () => {
  const noisy = withField<BeamField>(PRESETS[0].setup, 0, { power: 129.8 * 1e-3 });
  assert.equal((noisy.trap.fields[0] as BeamField).power, 0.12980000000000003);
  const back = readLinkFragment(linkFragment(noisy));
  assert.ok(back?.ok);
  if (back?.ok) assert.equal((back.setup.trap.fields[0] as BeamField).power, 0.1298);
  assert.match(setupFileText(noisy), /"power": 0\.1298,/);
  // only noise goes: a number with more than twelve real digits is kept, as are integers
  assert.equal(roundNumber(Math.PI), Math.PI);
  assert.equal(roundNumber(1.23456789012345e-7), 1.23456789012345e-7);
  assert.equal(roundNumber(0.1 + 0.2), 0.3);
  assert.equal(roundNumber(1.55e-6 * 1e9 * 1e-9), 1.55e-6);
  assert.equal(roundNumber(123456789012345), 123456789012345);
  assert.equal(roundNumber(-0.30000000000000004), -0.3);
});

test("the link replaces the query's preset and any fragment", () => {
  const url = shareUrl(PRESETS[0].setup, "https://example.org/levtrap/next/?preset=paul-ring&backend=local#old");
  assert.match(url, /^https:\/\/example\.org\/levtrap\/next\/\?backend=local#setup=/);
});

test("what cannot be opened says why", () => {
  assert.deepEqual(readSetupText("{not json"), { ok: false, reason: "it is not JSON" });
  const bad = setupFileText(withParticle(PRESETS[0].setup, { radius: -1 }));
  assert.deepEqual(readSetupText(bad), { ok: false, reason: "particle.radius must be greater than 0" });
  assert.deepEqual(readLinkFragment("#setup=garbage%%%"), { ok: false, reason: "the link is cut short or damaged" });
  assert.equal(readLinkFragment("#other=1"), null);
  assert.equal(readLinkFragment(""), null);
});

test("results as CSV: one quantity per row, SI units, the model", () => {
  const r = RECORDED.tweezer!;
  const rows = resultRows(r);
  const f = rows.filter((x) => x.quantity === "trap frequency");
  assert.deepEqual(
    f.map((x) => [x.axis, x.value, x.unit]),
    r.modes.map((m) => [m.name, m.frequency, "Hz"]),
  );
  assert.equal(f[0].model, "mie (ok)");
  const csv = resultsCsv(r).split("\n");
  assert.equal(csv[0], "quantity,axis,value,unit,model");
  assert.equal(csv[2], `trap frequency,x,${r.modes[0].frequency},Hz,mie (ok)`);
  assert.ok(rows.some((x) => x.quantity === "reheating"));
  const paul = resultRows(RECORDED["paul-linear"]!);
  assert.ok(paul.some((x) => x.quantity === "Mathieu q" && x.axis === "x"));
  assert.ok(!paul.some((x) => x.quantity === "scattered power"));
  const json = JSON.parse(resultsJson(PRESETS[0].setup, r));
  assert.equal(json.format, "levtrap result");
  assert.deepEqual(json.result.modes, r.modes);
});

test("a setup as a Python literal", () => {
  assert.equal(pythonLiteral({ a: true, b: null, c: [1, 2, 3], d: "x" }), '{\n    "a": True,\n    "b": None,\n    "c": [1, 2, 3],\n    "d": "x",\n}');
  assert.equal(pythonLiteral([[0.6, 0], [0, 0.8]]), "[\n    [0.6, 0],\n    [0, 0.8],\n]");
  assert.equal(pythonLiteral([1.064e-6, 1e-4, 0.2, 2.5e6]), "[1.064e-6, 1e-4, 0.2, 2.5e+6]");
  const code = pythonSnippet(PRESETS[0].setup, "Optical tweezer");
  assert.match(code, /^# Optical tweezer: /);
  assert.match(code, /from levtrap\.solve import solve/);
  assert.doesNotMatch(code, /\b(true|false|null)\b/);
});
