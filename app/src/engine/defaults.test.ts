import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETUP } from "./defaults.ts";

test("default setup equals the shared fixture the engine is tested on", () => {
  const url = new URL("../../../tests/fixtures/setup_v1.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(url, "utf8"));
  assert.deepEqual(DEFAULT_SETUP, fixture);
});
