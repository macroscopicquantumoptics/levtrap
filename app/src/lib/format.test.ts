import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFrequency, formatNumber, formatSI, siParts } from "./format.ts";

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

test("SI prefixes go down to small quantities", () => {
  assert.equal(formatSI(1.8829e-5, "N/m"), "18.8 µN/m");
  assert.equal(formatSI(2.1551e-7, "m"), "216 nm");
  assert.equal(formatSI(9.2153e-18, "kg"), "9.22 akg");
  assert.equal(formatSI(2.96e-4, "W"), "296 µW");
  assert.deepEqual(siParts(96_842.8, "Hz"), { value: "96.8", unit: "kHz" });
});

test("results keep trailing zeros, labels trim them", () => {
  assert.equal(formatSI(0.2, "W"), "200 mW");
  assert.equal(formatSI(1e-6, "m"), "1.00 µm");
  assert.equal(formatSI(1e-6, "m", 3, true), "1 µm");
  assert.equal(formatSI(5e3, "Hz", 3, true), "5 kHz");
  assert.equal(formatSI(1.064e-6, "m", 4, true), "1.064 µm");
});

test("negative values use a real minus sign", () => {
  assert.equal(formatSI(-3.4e-9, "N"), "−3.40 nN");
  assert.equal(formatNumber(-0.25), "−0.250");
});

test("bare numbers", () => {
  assert.equal(formatNumber(386.25), "386");
  assert.equal(formatNumber(0.5312), "0.531");
  assert.equal(formatNumber(115_876), "116000");
  assert.equal(formatNumber(1.2e-7), "1.20e−7");
  assert.equal(formatNumber(4.2e8, 2), "4.2e8");
  assert.equal(formatNumber(72, 3, true), "72");
  assert.equal(formatNumber(null), "—");
});

test("missing values show a dash", () => {
  assert.deepEqual(siParts(null, "Hz"), { value: "—", unit: "Hz" });
  assert.equal(formatSI(Number.NaN, "Hz"), "—");
});
