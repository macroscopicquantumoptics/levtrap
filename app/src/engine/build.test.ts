import assert from "node:assert/strict";
import { test } from "node:test";
import { engineMismatch, parseManifest } from "./build.ts";

test("a manifest names the wheel in its build's folder", () => {
  assert.deepEqual(parseManifest({ wheel: "0123abcd4567/levtrap-0.1.0-py3-none-any.whl", build: "0123abcd4567" }), {
    wheel: "0123abcd4567/levtrap-0.1.0-py3-none-any.whl",
    build: "0123abcd4567",
  });
});

test("a manifest from before #96 has no build", () => {
  assert.deepEqual(parseManifest({ wheel: "levtrap-0.1.0-py3-none-any.whl" }), { wheel: "levtrap-0.1.0-py3-none-any.whl" });
});

test("a manifest that names no wheel, or one outside wheels/, is refused", () => {
  const bad = [
    null,
    "x",
    {},
    { wheel: 3 },
    { wheel: "levtrap.zip" },
    { wheel: "/levtrap-0.1.0-py3-none-any.whl" },
    { wheel: "https://example.org/levtrap-0.1.0-py3-none-any.whl" },
    { wheel: "../levtrap-0.1.0-py3-none-any.whl" },
    { wheel: "a/levtrap-0.1.0-py3-none-any.whl", build: 7 },
  ];
  for (const m of bad) assert.throws(() => parseManifest(m), /manifest/, JSON.stringify(m));
});

test("the page and the engine differ only when both builds are known", () => {
  assert.equal(engineMismatch("aaa", "bbb"), true);
  assert.equal(engineMismatch("aaa", "aaa"), false);
  assert.equal(engineMismatch("", "bbb"), false);
  assert.equal(engineMismatch("aaa", undefined), false);
  assert.equal(engineMismatch(undefined, undefined), false);
});
