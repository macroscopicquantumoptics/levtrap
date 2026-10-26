// M6 acceptance check: load the levtrap wheel in Pyodide (Node runner),
// reproduce the OTT testExamples.m axial-equilibrium benchmark and time a
// full single calculation.
//   node scripts/pyodide_check.mjs web/wheels/levtrap-*.whl
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

const presets = JSON.parse(api.presets());
for (const [key, p] of Object.entries(presets)) {
  for (const pass of ["cold", "warm"]) {
    const t = performance.now();
    const out = JSON.parse(api.compute(JSON.stringify(p.request)));
    const dt = (performance.now() - t) / 1000;
    if (!out.ok) { fail.push(`${key}: ${out.error}`); break; }
    console.log(`${key} (${pass} beam cache): ${dt.toFixed(2)} s`, JSON.stringify(out.result.timing),
                `stable=${out.result.stable} z_eq=${out.result.z_eq}`);
  }
}
{
  const t = performance.now();
  const v = JSON.parse(api.field3d(JSON.stringify(presets.silica_1064.request), "{}"));
  console.log(`3D view volume (${v.dims.join("x")}): ${((performance.now() - t) / 1000).toFixed(2)} s`);
}
{
  const req = { wavelength: 1.55e-6, power: 0.5, particle: { radius: 100e-9, n: 1.444, k: 0, density: 2200 },
                lens: { diameter_mm: 2.5, tilt_y_deg: 0.5 } };
  const t = performance.now();
  const out = JSON.parse(api.lens_trap(JSON.stringify(req)));
  if (!out.ok) fail.push(`lens_trap: ${out.error}`);
  else console.log(`lens tilt page (0.5 deg, cold): ${((performance.now() - t) / 1000).toFixed(2)} s, stable=${out.result.stable}`);
}
if (fail.length) { console.error("FAILED:", fail); process.exit(1); }
console.log("OK: Pyodide reproduces the OTT benchmark");
