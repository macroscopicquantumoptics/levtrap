// Load the levtrap wheel in Pyodide (Node runner), reproduce the OTT
// testExamples.m axial-equilibrium benchmark, and time solve() on two of
// the app's setups, the field map and the asphere.
//   node scripts/pyodide_check.mjs dist/levtrap-*.whl
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadPyodide } from "pyodide";

const wheelPath = process.argv[2];
const t0 = performance.now();
const py = await loadPyodide();
await py.loadPackage(["numpy", "scipy", "micropip"]);
const name = basename(wheelPath);
py.FS.writeFile(`/tmp/${name}`, readFileSync(wheelPath));
await py.pyimport("micropip").install(`emfs:/tmp/${name}`, { deps: false });
console.log(`Pyodide ${py.version} + numpy/scipy + levtrap loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const api = py.pyimport("levtrap.api");
const b = JSON.parse(api.benchmark());
console.log("benchmark", b);
const fail = [];
if (Math.abs(b.z - b.expected.z) > 1e-9) fail.push(`z ${b.z} vs ${b.expected.z}`);
if (Math.abs(b.x - b.expected.x) > 1e-9) fail.push(`x ${b.x} vs ${b.expected.x}`);
if (Math.abs(b.kz / b.expected.kz - 1) > 0.01) fail.push(`kz ${b.kz} vs ${b.expected.kz}`);
if (Math.abs(b.kx / b.expected.kx - 1) > 0.01) fail.push(`kx ${b.kx} vs ${b.expected.kx}`);

// the app's presets go through solve(), as the app's worker calls it
const solveJson = py.pyimport("levtrap.solve").solve_json;
const setups = {
  tweezer: { version: 1, particle: { radius: 100e-9, material: "SiO2" }, environment: { pressure: 1e-4 },
             trap: { fields: [{ kind: "beam", id: "beam1", wavelength: 1.064e-6, power: 0.2, focus: { kind: "lens", NA: 0.8 } }] } },
  hybrid: { version: 1, particle: { radius: 100e-9, material: "SiO2", charge: 300 },
            trap: { fields: [{ kind: "beam", id: "beam1", wavelength: 1.064e-6, power: 0.2, focus: { kind: "lens", NA: 0.8 } },
                             { kind: "paul", geometry: "linear", rf_voltage: 300, rf_frequency: 5e3, r0: 1e-3, z0: 2e-3 },
                             { kind: "gravity" }] } },
};
for (const [key, setup] of Object.entries(setups)) {
  for (const pass of ["cold", "warm"]) {
    const t = performance.now();
    const out = JSON.parse(solveJson(JSON.stringify(setup), "[]"));
    const dt = (performance.now() - t) / 1000;
    if (!out.ok) { fail.push(`${key}: ${out.error}`); break; }
    console.log(`${key} (${pass} beam cache): ${dt.toFixed(2)} s`, `stable=${out.result.stable} equilibrium=${JSON.stringify(out.result.equilibrium)}`);
  }
}
{
  const t = performance.now();
  const req = { setup: setups.tweezer, options: { scan: { z_range: 2.5e-6, x_range: 1.2e-6 } } };
  const v = JSON.parse(api.field3d(JSON.stringify(req), "{}"));
  console.log(`field map volume (${v.dims.join("x")}): ${((performance.now() - t) / 1000).toFixed(2)} s`);
}
{
  const req = { wavelength: 1.55e-6, power: 0.5, particle: { radius: 100e-9, n: 1.444, k: 0, density: 2200 },
                lens: { diameter_mm: 2.5, tilt_y_deg: 0.5 } };
  const t = performance.now();
  const out = JSON.parse(api.lens_trap(JSON.stringify(req)));
  if (!out.ok) fail.push(`lens_trap: ${out.error}`);
  else console.log(`asphere (0.5 deg, cold): ${((performance.now() - t) / 1000).toFixed(2)} s, stable=${out.result.stable}`);
}
if (fail.length) { console.error("FAILED:", fail); process.exit(1); }
console.log("OK: Pyodide reproduces the OTT benchmark");
