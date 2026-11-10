/**
 * The app and the Python engine must agree: same default setup, same
 * Pyodide as web/worker.js. Needs `python3` with numpy importable (as in CI).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PYODIDE_VERSION } from "./protocol.ts";
import { DEFAULT_SETUP } from "./setup.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("Pyodide is pinned to the version web/worker.js uses", () => {
  const worker = readFileSync(`${repo}web/worker.js`, "utf8");
  const m = worker.match(/PYODIDE_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(m, "PYODIDE_VERSION not found in web/worker.js");
  assert.equal(PYODIDE_VERSION, m[1]);
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
