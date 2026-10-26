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
if (fail.length) { console.error("FAILED:", fail); process.exit(1); }
console.log("OK: Pyodide reproduces the OTT benchmark");
