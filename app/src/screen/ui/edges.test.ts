import assert from "node:assert/strict";
import { test } from "node:test";
import { edgesOf } from "./edges.ts";

test("a row that fits has nothing past either edge", () => {
  assert.deepEqual(edgesOf(0, 375, 375), { start: false, end: false });
  assert.deepEqual(edgesOf(0, 375, 300), { start: false, end: false });
});

test("a row wider than its box: more at the end, then at both, then at the start", () => {
  assert.deepEqual(edgesOf(0, 300, 600), { start: false, end: true });
  assert.deepEqual(edgesOf(150, 300, 600), { start: true, end: true });
  assert.deepEqual(edgesOf(300, 300, 600), { start: true, end: false });
});

test("a fraction of a pixel is rounding, not more to see", () => {
  assert.deepEqual(edgesOf(0.5, 300, 300.6), { start: false, end: false });
  assert.deepEqual(edgesOf(299.4, 300, 600), { start: true, end: false });
});
