import assert from "node:assert/strict";
import { test } from "node:test";
import { interpolate, niceTicks, siPrefix } from "./ticks.ts";

test("ticks are round and inside the range", () => {
  assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(-3, 3), [-2, 0, 2]);
  assert.deepEqual(niceTicks(-2.7, 3.2, 6), [-2, -1, 0, 1, 2, 3]);
  assert.deepEqual(niceTicks(-2.4e-12, 2.4e-12, 4), [-2e-12, 0, 2e-12]);
  assert.deepEqual(niceTicks(0.1, 0.9, 4), [0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual(niceTicks(5, 5), [5]);
  // 2.9999998 is 3 up to the rounding of recorded data
  assert.deepEqual(niceTicks(-3.0000002, 2.9999998, 6), [-3, -2, -1, 0, 1, 2, 3]);
  for (const [a, b] of [[-1.5e-6, 1.5e-6], [0, 7.3], [-0.004, 0.011]]) {
    const t = niceTicks(a, b);
    assert.ok(t.length >= 3 && t.length <= 8, `${t.length} ticks for [${a}, ${b}]`);
    assert.ok(t.every((v) => v >= a - 1e-12 && v <= b + 1e-12));
  }
});

test("the prefix that suits a range", () => {
  assert.deepEqual(siPrefix(3e-6), { factor: 1e-6, prefix: "µ" });
  assert.deepEqual(siPrefix(-2.4e-12), { factor: 1e-12, prefix: "p" });
  assert.deepEqual(siPrefix(1e-3), { factor: 1e-3, prefix: "m" });
  assert.deepEqual(siPrefix(0), { factor: 1, prefix: "" });
  assert.deepEqual(siPrefix(4.2e5), { factor: 1e3, prefix: "k" });
});

test("interpolation between samples, nothing outside them", () => {
  const points = [[0, 0], [1, 10], [3, 30]] as const;
  assert.equal(interpolate(points, 0.5), 5);
  assert.equal(interpolate(points, 2), 20);
  assert.equal(interpolate(points, 3), 30);
  assert.equal(interpolate(points, 0), 0);
  assert.equal(interpolate(points, -0.1), null);
  assert.equal(interpolate(points, 3.1), null);
  assert.equal(interpolate([], 1), null);
});
