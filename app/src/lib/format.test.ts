import { test } from "node:test";
import assert from "node:assert/strict";
import { si, siParts } from "./format.ts";

test("SI prefixes with three significant figures", () => {
  assert.equal(si(227499.37, "Hz"), "227 kHz");
  assert.equal(si(96842.6, "Hz"), "96.8 kHz");
  assert.equal(si(1.064e-6, "m"), "1.06 µm");
  assert.equal(si(0.2, "W"), "200 mW");
  assert.equal(si(1, "W"), "1 W");
  assert.equal(si(2.95e-5, "N/m"), "29.5 µN/m");
});

test("rounding up crosses into the next prefix", () => {
  assert.equal(si(999.97e3, "Hz"), "1 MHz");
  assert.equal(si(999.4, "Hz"), "999 Hz");
});

test("negative, zero and missing values", () => {
  assert.equal(si(-3.4e-9, "N"), "−3.4 nN");
  assert.equal(si(0, "Hz"), "0 Hz");
  assert.deepEqual(siParts(null, "Hz"), { value: "—", unit: "Hz" });
  assert.deepEqual(siParts(Number.NaN, "Hz"), { value: "—", unit: "Hz" });
});

test("significant figures are configurable", () => {
  assert.equal(si(227499.37, "Hz", 4), "227.5 kHz");
  assert.equal(si(115268.76, "K", 2), "120 kK");
});
