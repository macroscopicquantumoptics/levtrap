import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, Pattern, Setup } from "../../engine/types.ts";
import { addField, canonical, newPaulTrap, withField, withParticle } from "../model.ts";
import { PRESETS } from "../presets.ts";
import { RECORDED } from "../recorded.ts";
import { pythonLiteral, pythonSnippet } from "./python.ts";
import { resultRows, resultsCsv, resultsJson, withPattern, type Row } from "./results.ts";
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
  // the scattered power per multipole (#80), one row each
  const split = rows.filter((x) => x.quantity === "scattered power by multipole");
  assert.deepEqual(
    split.map((x) => x.axis),
    ["ED", "MD", "EQ", "MQ", "EO", "MO", "higher"],
  );
  assert.equal(split[0].value, r.optical!.P_sca_multipoles!.ED);
  const paul = resultRows(RECORDED["paul-linear"]!);
  assert.ok(paul.some((x) => x.quantity === "Mathieu q" && x.axis === "x"));
  assert.ok(!paul.some((x) => x.quantity === "scattered power"));
  const json = JSON.parse(resultsJson(PRESETS[0].setup, r));
  assert.equal(json.format, "levtrap result");
  assert.deepEqual(json.result.modes, r.modes);
});

/** The Radiation tab's numbers, cut down: two NAs, the four directions, and the trapping lens's NA (#75). */
const fractions = { x: [0.1, 0.3], y: [0.1, 0.2], z: [0.2, 0.4] };
const pattern = {
  P_sca: 1.5e-12,
  NA: [0.5, 0.8],
  collection: { forward: [0.1, 0.3], backward: [0.05, 0.2], side_x: [0.02, 0.1], side_y: [0.03, 0.12] },
  information_efficiency: { forward: fractions, backward: fractions, side_x: fractions, side_y: fractions },
  trap_NA: 0.8,
  at_trap_NA: {
    forward: { collection: 0.3, information: { x: 0.3, y: 0.2, z: 0.4 } },
    backward: { collection: 0.2, information: { x: 0.3, y: 0.2, z: 0.4 } },
  },
} as unknown as Pattern;

test("the results export carries the radiation pattern once it has been computed (#75)", () => {
  const r = RECORDED.tweezer!;
  // the main answer is solved without the pattern: nothing to add until the Radiation tab has it
  assert.equal(r.pattern, undefined);
  assert.equal(withPattern(r, null), r);
  assert.equal(withPattern(null, pattern), null);
  assert.ok(!resultRows(r).some((x) => x.quantity.includes("collected")));
  const both = withPattern(r, pattern)!;
  assert.equal(both.pattern, pattern);
  assert.deepEqual(both.modes, r.modes);
  // JSON: the whole block, as the engine returned it
  assert.deepEqual(JSON.parse(resultsJson(PRESETS[0].setup, both)).result.pattern, JSON.parse(JSON.stringify(pattern)));
  // CSV: every direction at every NA, forward + backward, and the trapping lens's NA
  const rows = resultRows(both);
  const row = (quantity: string, axis = "") => rows.find((x) => x.quantity === quantity && x.axis === axis)?.value;
  const close = (a: Row["value"] | undefined, b: number) => assert.ok(typeof a === "number" && Math.abs(a - b) < 1e-12, `${a} != ${b}`);
  assert.equal(row("scattered power (pattern)"), 1.5e-12);
  assert.equal(row("light collected by forward lens (+z) at NA 0.8"), 0.3);
  assert.equal(row("light collected by side lens (+y) at NA 0.5"), 0.03);
  close(row("light collected by forward + backward lenses at NA 0.8"), 0.5);
  assert.equal(row("position information collected by backward lens (-z) at NA 0.5", "z"), 0.2);
  assert.equal(row("light collected by backward lens (-z) at the trapping lens's NA 0.8"), 0.2);
  close(row("position information collected by forward + backward lenses at the trapping lens's NA 0.8", "x"), 0.6);
  assert.ok(!rows.some((x) => x.quantity.includes("side lens (+x) at the trapping lens")));
  // no commas in the quantity: each row reads as five plain fields
  assert.ok(rows.every((x) => !x.quantity.includes(",")));
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
