import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { describeWarning, RULES, type WarningCode } from "./warnings.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ENGINE = ["src/levtrap/solve.py", "src/levtrap/solver.py", "src/levtrap/fields/paul.py"].map((f) => readFileSync(`${repo}${f}`, "utf8")).join("\n");

/**
 * Each warning as the engine writes it (the f-strings filled in), the words
 * of it that are fixed in the engine's source, and what the screen says.
 */
const CASES: { code: WarningCode; engine: string; fixed: string; text: string; hint?: RegExp; fatal: boolean }[] = [
  {
    code: "no-trap-axial",
    engine: "No stable trap: the force along the beam axis (z) never restores the particle.",
    fixed: "No stable trap: the force along the beam axis (z) never restores the particle.",
    text: "No stable trap along z: the force along the beam never pulls the particle back.",
    hint: /larger NA.*counter-propagating beam/,
    fatal: true,
  },
  {
    code: "no-trap-nowhere",
    engine: "No stable trap: nowhere in the searched region does the force vanish and pull the particle back.",
    fixed: "No stable trap: nowhere in the searched region does the force vanish and pull the ",
    text: "No stable trap: nowhere in the searched region does the force vanish and pull the particle back.",
    hint: /gravity/,
    fatal: true,
  },
  {
    code: "no-trap-loose",
    engine: "No stable trap: the particle is pushed away along x, y.",
    fixed: "No stable trap: the particle is pushed away along ",
    text: "No stable trap along x and y: the force there pushes the particle away.",
    hint: /dark centre/,
    fatal: true,
  },
  {
    code: "no-trap-mathieu",
    engine: "No stable trap: outside the first Mathieu stability region along x, y.",
    fixed: "No stable trap: outside the first Mathieu stability region along ",
    text: "No stable trap along x and y: outside the first Mathieu stability region.",
    hint: /raise the RF frequency/,
    fatal: true,
  },
  {
    code: "no-trap-paul",
    engine: "No stable trap: the Paul trap does not confine the particle here.",
    fixed: "No stable trap: the Paul trap does not confine the particle here.",
    text: "No stable trap: the Paul trap does not confine the particle here.",
    hint: /RF voltage or the charge/,
    fatal: true,
  },
  {
    code: "no-trap-parametric",
    engine: "No stable trap: the RF drives a parametric resonance along x, even with the light's restoring force.",
    fixed: "No stable trap: the RF drives a parametric resonance along ",
    text: "No stable trap along x: the RF drives a parametric resonance, even with the light's restoring force.",
    hint: /half the RF frequency/,
    fatal: true,
  },
  {
    code: "micromotion",
    engine:
      "The particle sits 1000 nm from the Paul trap's centre along x, more than its thermal spread (34 nm): expect excess micromotion (amplitude 1.6e+02 nm).",
    fixed: "The particle sits {off * 1e9:.0f} nm from the Paul trap's centre along ",
    text: "The particle sits 1000 nm from the Paul trap's centre along x, more than its thermal spread (34 nm): expect excess micromotion (amplitude 1.6e+02 nm).",
    hint: /onto the Paul trap's axis/,
    fatal: false,
  },
  {
    code: "not-converged",
    engine: "The equilibrium search did not converge inside the scanned region.",
    fixed: "The equilibrium search did not converge inside the scanned region.",
    text: "The equilibrium search did not converge inside the scanned region.",
    hint: /rough/,
    fatal: false,
  },
  {
    code: "nonconservative",
    engine: "The force is not conservative here: the antisymmetric part of the stiffness matrix is 12% of the symmetric part, so the depth and frequencies are approximate.",
    fixed: "The force is not conservative here: the antisymmetric part of the ",
    text: "The force is not conservative here: the antisymmetric part of the stiffness matrix is 12% of the symmetric part, so the depth and frequencies are approximate.",
    fatal: false,
  },
  {
    code: "spirals-out",
    engine:
      "The particle spirals out at this pressure: the curl of the force grows its motion along x, y at 9.74e+03 /s, faster than the gas damps it; the gas holds it above 6.54e+03 Pa.",
    fixed: "The particle spirals out at this pressure: the curl of the force grows its motion ",
    text: "The particle spirals out along x and y at this pressure: the light's curl force makes its motion grow faster than the gas damps it.",
    hint: /^The gas holds it above 65\.4 mbar\. Usually the spin of circularly polarised light/,
    fatal: false,
  },
  {
    code: "pseudopotential-inaccurate",
    engine: "Paul q = 0.45: pseudopotential is inaccurate, using Mathieu",
    fixed: ": pseudopotential is inaccurate, using Mathieu",
    text: "Mathieu q = 0.45 is too large for the pseudopotential: the frequencies are the exact Mathieu ones.",
    fatal: false,
  },
  {
    code: "ring-endcap",
    engine: "endcap_voltage is not used by a ring trap; use dc_voltage",
    fixed: "endcap_voltage is not used by a ring trap; use dc_voltage",
    text: "A ring trap does not use the end-cap voltage: set the DC voltage instead.",
    fatal: false,
  },
];

test("every warning code has its copy, and the screen's sentence for it", () => {
  for (const c of CASES) {
    const w = describeWarning(c.engine);
    assert.equal(w.code, c.code, c.engine);
    assert.equal(w.text, c.text, c.code);
    assert.equal(w.fatal, c.fatal, c.code);
    if (c.hint) assert.match(w.hint ?? "", c.hint, c.code);
    else assert.equal(w.hint, undefined, c.code);
    // every sentence shown ends as a sentence
    for (const s of [w.text, w.hint].filter(Boolean)) assert.match(s!, /[.!?]$/, c.code);
  }
  // and every code is covered here
  assert.deepEqual(new Set(CASES.map((c) => c.code)), new Set(RULES.map((r) => r.code)));
});

test("every warning matched is still written by the engine", () => {
  for (const c of CASES) {
    // the engine splits long strings over lines: compare without the line breaks between literals
    const source = ENGINE.replace(/"\s*\n\s*f?"/g, "");
    assert.ok(source.includes(c.fixed), `${c.code}: the engine no longer writes "${c.fixed}"`);
  }
});

test("every no-trap sentence says along which axis when the engine names one", () => {
  for (const c of CASES.filter((c) => c.fatal && /along [xyz]/.test(c.engine))) {
    assert.match(describeWarning(c.engine).text, /^No stable trap along [xyz]( and [xyz])?:/, c.code);
  }
});

test("a warning the screen does not know is shown as the engine wrote it", () => {
  assert.deepEqual(describeWarning("something new happened"), { code: "other", fatal: false, text: "Something new happened." });
  assert.equal(describeWarning("No stable trap: a new reason").fatal, true);
});
