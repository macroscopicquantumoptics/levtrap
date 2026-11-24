/**
 * validateSetup must accept and refuse exactly what levtrap.setup.parse does,
 * with the same key path and message, and normalise to the same setup.
 * Needs python3 with levtrap importable (as in CI).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DEFAULT_SETUP } from "./setup.ts";
import { SetupError, validateSetup } from "./validate.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = JSON.parse(readFileSync(`${repo}tests/fixtures/setup_v1.json`, "utf8"));

type Case = [string, unknown];
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON fixture edited freely
const edit = (f: (s: Record<string, any>) => void) => {
  const s = structuredClone(fixture);
  f(s);
  return s;
};
const beam = fixture.trap.fields[0];
const paul = { kind: "paul", geometry: "linear", rf_voltage: 300, rf_frequency: 5e3, r0: 1e-3, z0: 2e-3 };

const CASES: Case[] = [
  ["fixture", fixture],
  ["default", DEFAULT_SETUP],
  ["defaults filled", { particle: { radius: 1e-7, n: 1.45, density: 2200 }, trap: { fields: [{ kind: "beam", wavelength: 1e-6, power: 0.1, focus: { NA: 0.5 } }] } }],
  ["two coherent beams", edit((s) => s.trap.fields.push({ ...beam, id: "b2", coherent_with: "beam1", direction: [0, 0, -1] }))],
  ["hybrid", edit((s) => { s.particle.charge = 30; s.trap.fields.push(paul, { kind: "gravity" }); })],
  ["ring trap", edit((s) => { s.particle.charge = -5; s.trap.fields = [{ ...paul, geometry: "ring", geometry_factors: { radial: 0.8 } }]; })],
  ["jones", edit((s) => (s.trap.fields[0].polarisation = [[1, 0], [0, 1]]))],
  ["unknown keys kept", edit((s) => { s.particle.shape = "rod"; s.trap.fields[0].note = "x"; })],
  ["not an object", [1, 2]],
  ["bad json", "{nope"],
  ["version too new", edit((s) => (s.version = 2))],
  ["version not int", edit((s) => (s.version = 1.5))],
  ["no particle", edit((s) => delete s.particle)],
  ["radius negative", edit((s) => (s.particle.radius = -1))],
  ["radius string", edit((s) => (s.particle.radius = "1e-7"))],
  ["radius bool", edit((s) => (s.particle.radius = true))],
  ["unknown material", edit((s) => (s.particle.material = "gold"))],
  ["custom without n", edit((s) => { s.particle.material = null; s.particle.density = 2000; })],
  ["k negative", edit((s) => (s.particle.k = -0.1))],
  ["pressure negative", edit((s) => (s.environment.pressure = -1))],
  ["gas", edit((s) => (s.environment.gas = "Ar"))],
  ["medium below 1", edit((s) => (s.environment.medium_index = 0.9))],
  ["no fields", edit((s) => (s.trap.fields = []))],
  ["unknown kind", edit((s) => (s.trap.fields[0].kind = "laser"))],
  ["two focus keys", edit((s) => (s.trap.fields[0].focus = { NA: 0.5, waist: 1e-6 }))],
  ["angle above 90", edit((s) => (s.trap.fields[0].focus = { angle_deg: 120 }))],
  ["NA above medium", edit((s) => (s.trap.fields[0].focus = { NA: 1.2 }))],
  ["objective filled", edit((s) => (s.trap.fields[0].focus = { NA: 0.9, filling: 0.7 }))],
  ["filling without NA", edit((s) => (s.trap.fields[0].focus = { waist: 1e-6, filling: 1 }))],
  ["filling zero", edit((s) => (s.trap.fields[0].focus = { NA: 0.9, filling: 0 }))],
  ["filling too large", edit((s) => (s.trap.fields[0].focus = { NA: 0.9, filling: 11 }))],
  ["sine mapping", edit((s) => (s.trap.fields[0].focus = { NA: 0.8, mapping: "sine" }))],
  ["unknown mapping", edit((s) => (s.trap.fields[0].focus = { NA: 0.8, mapping: "cosine" }))],
  ["filled objective by OTT's mapping", edit((s) => (s.trap.fields[0].focus = { NA: 0.9, filling: 0.7, mapping: "ott" }))],
  ["sine waist below the limit", edit((s) => (s.trap.fields[0].focus = { waist: 3e-7, mapping: "sine" }))],
  ["OTT waist below that limit", edit((s) => (s.trap.fields[0].focus = { waist: 3e-7 }))],
  ["mode indices", edit((s) => (s.trap.fields[0].mode = { type: "hg", indices: [1, -1] }))],
  ["mode not ints", edit((s) => (s.trap.fields[0].mode = { type: "lg", indices: [0.5, 1] }))],
  ["polarisation", edit((s) => (s.trap.fields[0].polarisation = "z"))],
  ["zero direction", edit((s) => (s.trap.fields[0].direction = [0, 0, 0]))],
  ["short position", edit((s) => (s.trap.fields[0].position = [0, 0]))],
  ["coherent with nobody", edit((s) => (s.trap.fields[0].coherent_with = "nobody"))],
  ["coherent other wavelength", edit((s) => s.trap.fields.push({ ...beam, id: "b2", coherent_with: "beam1", wavelength: 1.55e-6 }))],
  ["id twice", edit((s) => s.trap.fields.push({ ...beam }))],
  ["paul neutral", edit((s) => s.trap.fields.push(paul))],
  ["paul no r0", edit((s) => { s.particle.charge = 3; s.trap.fields.push({ ...paul, r0: undefined }); })],
  ["paul geometry factor", edit((s) => { s.particle.charge = 3; s.trap.fields.push({ ...paul, geometry_factors: { axial: 0 } }); })],
  ["gravity short", edit((s) => s.trap.fields.push({ kind: "gravity", g: [0, -9.81] }))],
  ["asphere", edit((s) => (s.trap.fields[0].focus = { kind: "asphere", beam_diameter: 2.5e-3, tilt_deg: [0.1, -0.2], decentre: [1e-4, 0] }))],
  ["asphere defaults", edit((s) => (s.trap.fields[0].focus = { kind: "asphere", beam_diameter: 2e-3 }))],
  ["asphere with NA", edit((s) => (s.trap.fields[0].focus = { kind: "asphere", beam_diameter: 2e-3, NA: 0.5 }))],
  ["asphere no diameter", edit((s) => (s.trap.fields[0].focus = { kind: "asphere" }))],
  ["asphere unknown lens", edit((s) => (s.trap.fields[0].focus = { kind: "asphere", lens: "AC254", beam_diameter: 2e-3 }))],
  ["asphere tilt too far", edit((s) => (s.trap.fields[0].focus = { kind: "asphere", beam_diameter: 2e-3, tilt_deg: [0, -25] }))],
  ["asphere tilt short", edit((s) => (s.trap.fields[0].focus = { kind: "asphere", beam_diameter: 2e-3, tilt_deg: [1] }))],
  ["asphere decentre", edit((s) => (s.trap.fields[0].focus = { kind: "asphere", beam_diameter: 2e-3, decentre: [0, 0.01] }))],
  ["mirror", edit((s) => (s.trap.fields[0].focus = { kind: "parabolic_mirror", focal_length: 3e-3, rim_radius: 9e-3, hole_radius: 5e-4, beam_diameter: 1e-2 }))],
  ["mirror defaults", edit((s) => (s.trap.fields[0].focus = { kind: "parabolic_mirror", focal_length: 3e-3, rim_radius: 9e-3, beam_diameter: 1e-2 }))],
  ["mirror with waist", edit((s) => (s.trap.fields[0].focus = { kind: "parabolic_mirror", focal_length: 3e-3, rim_radius: 9e-3, beam_diameter: 1e-2, waist: 1e-6 }))],
  ["mirror hole past rim", edit((s) => (s.trap.fields[0].focus = { kind: "parabolic_mirror", focal_length: 3e-3, rim_radius: 9e-3, hole_radius: 9e-3, beam_diameter: 1e-2 }))],
  ["mirror no rim", edit((s) => (s.trap.fields[0].focus = { kind: "parabolic_mirror", focal_length: 3e-3, beam_diameter: 1e-2 }))],
  ["mirror too long", edit((s) => (s.trap.fields[0].focus = { kind: "parabolic_mirror", focal_length: 0.5, rim_radius: 9e-3, beam_diameter: 1e-2 }))],
  ["focus kind", edit((s) => (s.trap.fields[0].focus = { kind: "mirror", NA: 0.5 }))],
];

const CODE = `
import json, sys
sys.path.insert(0, 'src')
from levtrap.setup import parse, SetupError
out = []
for case in json.load(sys.stdin):
    try:
        out.append(dict(ok=True, setup=parse(case)))
    except SetupError as e:
        out.append(dict(ok=False, path=e.path, message=e.message))
print(json.dumps(out))
`;

function inTs(input: unknown) {
  try {
    return { ok: true, setup: validateSetup(input) };
  } catch (e) {
    assert.ok(e instanceof SetupError, String(e));
    return { ok: false, path: e.path, message: e.detail };
  }
}

test("validateSetup agrees with levtrap.setup.parse", () => {
  const py = JSON.parse(
    execFileSync(process.env.PYTHON ?? "python3", ["-c", CODE], { cwd: repo, input: JSON.stringify(CASES.map((c) => c[1])), encoding: "utf8" }),
  );
  CASES.forEach(([name, input], i) => {
    const ts = inTs(input);
    const want = py[i];
    if (name === "bad json") {
      // the JSON parsers word their messages differently; the path and the start agree
      assert.equal(ts.ok, false, name);
      assert.equal(want.ok, false, name);
      assert.equal(ts.path, want.path, name);
      assert.match(ts.message!, /^not valid JSON/, name);
      return;
    }
    // undefined values (a deleted key in JS) are absent in Python's copy
    assert.deepEqual(JSON.parse(JSON.stringify(ts)), want, name);
  });
});

test("the shared fixture is valid and normalises to itself", () => {
  const once = validateSetup(fixture);
  assert.deepEqual(validateSetup(once), once);
});
