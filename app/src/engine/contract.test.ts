/**
 * The app and the Python engine must agree: same default setup, and the
 * same Pyodide as CI's wheel check (scripts/pyodide_check.mjs under the
 * workflows' pinned pyodide). Needs `python3` with numpy importable (as in CI).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PYODIDE_VERSION } from "./protocol.ts";
import { DEFAULT_SETUP } from "./setup.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("Pyodide is pinned to the version CI checks the wheel with", () => {
  for (const workflow of ["test.yml", "pages.yml"]) {
    const text = readFileSync(`${repo}.github/workflows/${workflow}`, "utf8");
    const pins = [...text.matchAll(/pyodide@([\d.]+)/g)].map((m) => m[1]);
    assert.ok(pins.length, `no pyodide@ pin in ${workflow}`);
    for (const v of pins) assert.equal(v, PYODIDE_VERSION, workflow);
  }
});

test("DEFAULT_SETUP matches levtrap.setup.DEFAULT_SETUP", () => {
  const py = process.env.PYTHON ?? "python3";
  const out = execFileSync(
    py,
    ["-c", "import json, sys; sys.path.insert(0, 'src'); from levtrap.setup import DEFAULT_SETUP; print(json.dumps(DEFAULT_SETUP))"],
    { cwd: repo, encoding: "utf8" },
  );
  assert.deepEqual(DEFAULT_SETUP, JSON.parse(out));
});
