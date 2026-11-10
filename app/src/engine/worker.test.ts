import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pin = (path: string) => {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const m = text.match(/PYODIDE_VERSION = "([^"]+)"/);
  assert.ok(m, `no PYODIDE_VERSION in ${path}`);
  return m[1];
};

test("the app's worker pins the same Pyodide as web/worker.js", () => {
  assert.equal(pin("../../public/engine/worker.js"), pin("../../../web/worker.js"));
});
