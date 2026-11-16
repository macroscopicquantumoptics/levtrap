import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFrequency } from "./format.ts";

test("frequencies get an SI prefix and three significant figures", () => {
  assert.equal(formatFrequency(152_340), "152 kHz");
  assert.equal(formatFrequency(48_000), "48.0 kHz");
  assert.equal(formatFrequency(1_234_567), "1.23 MHz");
  assert.equal(formatFrequency(5.5), "5.50 Hz");
  assert.equal(formatFrequency(999.6), "1.00 kHz");
  assert.equal(formatFrequency(0), "0.00 Hz");
});

test("missing frequencies show a dash", () => {
  assert.equal(formatFrequency(null), "—");
  assert.equal(formatFrequency(undefined), "—");
  assert.equal(formatFrequency(Number.NaN), "—");
});
