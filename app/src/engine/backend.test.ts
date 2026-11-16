import assert from "node:assert/strict";
import { test } from "node:test";
import { backendFromSearch, DEFAULT_LOCAL_API, wheelBase } from "./backend.ts";

test("Pyodide is the default backend", () => {
  assert.deepEqual(backendFromSearch(""), { kind: "pyodide" });
  assert.deepEqual(backendFromSearch("?backend=pyodide"), { kind: "pyodide" });
});

test("?backend=local talks to the devserver", () => {
  assert.deepEqual(backendFromSearch("?backend=local"), { kind: "local", api: DEFAULT_LOCAL_API });
  assert.deepEqual(backendFromSearch("?backend=local&api=http://127.0.0.1:9000/api"), {
    kind: "local",
    api: "http://127.0.0.1:9000/api",
  });
});

test("the wheel lives under the base path", () => {
  assert.equal(wheelBase("https://example.org", "/levtrap/next"), "https://example.org/levtrap/next/wheels/");
  assert.equal(wheelBase("https://example.org", "/levtrap/next/"), "https://example.org/levtrap/next/wheels/");
  assert.equal(wheelBase("http://localhost:3000", ""), "http://localhost:3000/wheels/");
});
