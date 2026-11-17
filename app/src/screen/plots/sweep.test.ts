import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeamField, PaulField } from "../../engine/types.ts";
import { PRESETS } from "../presets.ts";
import { RECORDED } from "../recorded.ts";
import { defaultRange, OUTPUTS, sweepParams, sweepValues, unstableRuns } from "./sweep.ts";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.setup;

test("a tweezer sweeps its beam, lens, particle and environment", () => {
  assert.deepEqual(
    sweepParams(preset("tweezer")).map((p) => p.id),
    ["beam0-power", "beam0-wavelength", "lens0-NA", "particle-radius", "environment-pressure", "environment-temperature"],
  );
  assert.deepEqual(
    sweepParams(preset("paul-linear")).map((p) => p.id),
    ["paul0-rf_voltage", "paul0-rf_frequency", "paul0-endcap_voltage", "paul0-dc_voltage", "particle-radius", "particle-charge", "environment-pressure", "environment-temperature"],
  );
});

test("a parameter reads and writes its setup without touching the original", () => {
  const s = preset("tweezer");
  const power = sweepParams(s).find((p) => p.id === "beam0-power")!;
  assert.equal(power.get(s), 0.2);
  const t = power.set(s, 0.1);
  assert.equal((t.trap.fields[0] as BeamField).power, 0.1);
  assert.equal((s.trap.fields[0] as BeamField).power, 0.2);
  const na = sweepParams(s).find((p) => p.id === "lens0-NA")!;
  assert.deepEqual((na.set(s, 0.6).trap.fields[0] as BeamField).focus, { kind: "lens", NA: 0.6 });
  const rf = sweepParams(preset("paul-linear")).find((p) => p.id === "paul0-rf_frequency")!;
  assert.equal((rf.set(preset("paul-linear"), 3e3).trap.fields[0] as PaulField).rf_frequency, 3e3);
});

test("values, evenly or in log, and the default ranges", () => {
  assert.deepEqual(sweepValues(0, 1, 5, false), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(
    sweepValues(1, 100, 3, true).map((v) => Math.round(v)),
    [1, 10, 100],
  );
  const s = preset("tweezer");
  const p = sweepParams(s);
  assert.deepEqual(defaultRange(p.find((x) => x.id === "beam0-power")!, s), [0.1, 0.4]);
  const [lo, hi] = defaultRange(p.find((x) => x.id === "environment-pressure")!, s);
  assert.ok(Math.abs(lo - 1e-5) < 1e-12 && Math.abs(hi - 1e-3) < 1e-12);
  const na = defaultRange(p.find((x) => x.id === "lens0-NA")!, s);
  assert.ok(Math.abs(na[0] - 0.3) < 1e-12 && Math.abs(na[1] - 0.95) < 1e-12);
});

test("the outputs read a result", () => {
  const r = RECORDED.tweezer!;
  const s = preset("tweezer");
  const read = (id: string) => OUTPUTS.find((o) => o.id === id)!.read(r, s);
  assert.deepEqual(
    read("frequencies").map((v) => v.name),
    ["x", "y", "z"],
  );
  assert.equal(read("depth")[0].value, r.depth.kT);
  assert.equal(read("position")[0].value, r.equilibrium![2]);
  assert.equal(read("scattered")[0].value, r.optical!.P_sca);
  // no trap: no frequencies
  assert.deepEqual(
    OUTPUTS[0].read({ ...r, stable: false }, s).map((v) => v.value),
    [null, null, null],
  );
});

test("unstable runs reach halfway to their stable neighbours", () => {
  assert.deepEqual(unstableRuns([0, 1, 2, 3, 4], [true, false, false, true, true]), [[0.5, 2.5]]);
  assert.deepEqual(unstableRuns([0, 1, 2], [false, true, false]), [
    [0, 0.5],
    [1.5, 2],
  ]);
  assert.deepEqual(unstableRuns([0, 1], [true, true]), []);
});

test("a real lens sweeps its beam diameter and tilts, not an NA", async () => {
  const { ASPHERE_SETUP } = await import("../asphere.fixture.ts");
  const params = sweepParams(ASPHERE_SETUP);
  const ids = params.map((p) => p.id);
  assert.ok(ids.includes("lens0-beam_diameter") && ids.includes("lens0-tilt_y"));
  assert.ok(!ids.includes("lens0-NA"));
  const tilt = params.find((p) => p.id === "lens0-tilt_y")!;
  assert.equal(tilt.get(ASPHERE_SETUP), 0.3);
  const t = tilt.set(ASPHERE_SETUP, 0.5);
  const focus = (t.trap.fields[0] as BeamField).focus;
  assert.equal(focus.kind, "asphere");
  assert.deepEqual(focus.kind === "asphere" && focus.tilt_deg, [0, 0.5]);
  assert.deepEqual(defaultRange(tilt, ASPHERE_SETUP), [-1, 1]);
});

test("a parabolic mirror sweeps its beam, size and hole", async () => {
  const { MIRROR_SETUP } = await import("../mirror.fixture.ts");
  const params = sweepParams(MIRROR_SETUP);
  const ids = params.map((p) => p.id);
  assert.deepEqual(
    ids.filter((id) => id.startsWith("lens0")),
    ["lens0-beam_diameter", "lens0-focal_length", "lens0-rim_radius", "lens0-hole_radius"],
  );
  const hole = params.find((p) => p.id === "lens0-hole_radius")!;
  assert.equal(hole.get(MIRROR_SETUP), 5e-4);
  const t = hole.set(MIRROR_SETUP, 1e-3);
  const focus = (t.trap.fields[0] as BeamField).focus;
  assert.equal(focus.kind === "parabolic_mirror" && focus.hole_radius, 1e-3);
  assert.deepEqual(defaultRange(hole, MIRROR_SETUP), [0, 4.5e-3]);
});
