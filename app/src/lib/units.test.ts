import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuantity, toFieldText, unitFactor } from "./units.ts";

const value = (text: string, q: Parameters<typeof parseQuantity>[1], unit = "") => {
  const p = parseQuantity(text, q, unit);
  assert.ok(p.ok, p.ok ? "" : p.error);
  return p.value;
};
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.abs(b), `${a} != ${b}`);

test("units as typed give SI values", () => {
  close(value("200 mW", "power"), 0.2);
  close(value("0.2 W", "power"), 0.2);
  close(value("100nm", "length"), 1e-7);
  close(value("1.5 um", "length"), 1.5e-6);
  close(value("1e-6 mbar", "pressure"), 1e-4);
  close(value("7.5e-7 Torr", "pressure"), 7.5e-7 * (101325 / 760));
  close(value("5 kHz", "frequency"), 5000);
  close(value("2.2 g/cm3", "density"), 2200);
  close(value("−50 e", "charge"), -50);
  close(value("1 π", "phase"), Math.PI);
  close(value("180°", "phase"), Math.PI);
});

test("without a unit the field's unit applies", () => {
  close(value("5", "frequency", "kHz"), 5000);
  close(value("350", "power", "mW"), 0.35);
  close(value("0.8", "number"), 0.8);
  const p = parseQuantity("5", "frequency", "kHz");
  assert.ok(p.ok && p.unit === "kHz");
});

test("the typed unit is reported, so the field can keep showing it", () => {
  const p = parseQuantity("0.2 W", "power", "mW");
  assert.ok(p.ok && p.unit === "W");
  const q = parseQuantity("3 khz", "frequency", "Hz");
  assert.ok(q.ok && q.unit === "kHz" && q.value === 3000);
});

test("mistakes are answered with a sentence", () => {
  assert.deepEqual(parseQuantity("", "power", "mW"), { ok: false, error: "Type a number." });
  assert.deepEqual(parseQuantity("abc", "power", "mW"), { ok: false, error: "Start with a number." });
  assert.deepEqual(parseQuantity("200 nm", "power", "mW"), { ok: false, error: "Unknown unit “nm”. Use W, mW or µW." });
  assert.deepEqual(parseQuantity("0.8 m", "number"), { ok: false, error: "This value has no unit." });
});

test("field text is short, exact and parses back", () => {
  assert.equal(toFieldText(0.2, "power", "mW"), "200");
  assert.equal(toFieldText(1e-7, "length", "nm"), "100");
  assert.equal(toFieldText(1.064e-6, "length", "nm"), "1064");
  assert.equal(toFieldText(1e-4, "pressure", "mbar"), "1e-6");
  assert.equal(toFieldText(5000, "frequency", "kHz"), "5");
  assert.equal(toFieldText(0, "voltage", "V"), "0");
  for (const [si, q, u] of [
    [0.2, "power", "mW"],
    [1e-4, "pressure", "mbar"],
    [1e-4, "pressure", "Torr"],
    [2200, "density", "g/cm³"],
  ] as const) {
    const back = value(toFieldText(si, q, u, 12), q, u);
    assert.ok(Math.abs(back - si) <= 1e-9 * si, `${si} ${u} -> ${back}`);
  }
});

test("unit factors", () => {
  assert.equal(unitFactor("pressure", "mbar"), 100);
  assert.equal(unitFactor("number", ""), 1);
  assert.throws(() => unitFactor("power", "nm"));
});
