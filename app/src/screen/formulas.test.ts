import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { explainDepth, explainFrequency, secondaryNumbers, type Explanation } from "./explain.ts";
import { FORMULAS, type FormulaId } from "./formulas.ts";
import { PRESETS } from "./presets.ts";
import { ASPHERE_RESULT, ASPHERE_SETUP } from "./asphere.fixture.ts";
import { RECORDED } from "./recorded.ts";

const typeset = (tex: string, displayMode = true) => katex.renderToString(tex, { throwOnError: true, strict: "error", displayMode, output: "htmlAndMathml" });

/** Every explanation of every recorded preset. */
function allExplanations(): { preset: string; e: Explanation }[] {
  const out: { preset: string; e: Explanation }[] = [];
  for (const preset of PRESETS) {
    const result = RECORDED[preset.id];
    if (!result) continue;
    const add = (e: Explanation) => out.push({ preset: preset.id, e });
    result.modes.forEach((_, i) => add(explainFrequency(result, preset.setup, i)));
    add(explainDepth(result, preset.setup));
    secondaryNumbers(result, preset.setup).forEach((s) => add(s.explain()));
  }
  // and a beam focused by a real lens (E1), as the engine computes it
  secondaryNumbers(ASPHERE_RESULT, ASPHERE_SETUP).forEach((s) => out.push({ preset: "asphere", e: s.explain() }));
  return out;
}

test("every formula in the sheet typesets, without a KaTeX warning", () => {
  for (const [id, f] of Object.entries(FORMULAS)) {
    const html = typeset(f.tex);
    assert.match(html, /class="katex-display"/, id);
    assert.match(html, /<math/, `${id}: carries MathML for screen readers`);
    assert.ok(f.text.length > 0, `${id}: has a plain-text form`);
  }
});

test("every input symbol of every explanation typesets inline", () => {
  const symbols = new Set(allExplanations().flatMap(({ e }) => e.inputs.map((i) => i.symbol)));
  assert.ok(symbols.size > 20);
  for (const s of symbols) assert.doesNotThrow(() => typeset(s, false), s);
});

test("every formula is used by some explanation, and every explanation names one in the sheet", () => {
  const used = new Set<FormulaId>();
  for (const { preset, e } of allExplanations()) {
    assert.ok(e.formula in FORMULAS, `${preset}: ${e.title}`);
    used.add(e.formula);
  }
  // the exact-Mathieu frequency is used only when q is large; none of the presets is
  const unused = Object.keys(FORMULAS).filter((id) => !used.has(id as FormulaId));
  assert.deepEqual(unused, ["paul-exact"]);
});
