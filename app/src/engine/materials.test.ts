import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getMaterial, MATERIAL_NAMES } from "./materials.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const WAVELENGTHS = [532e-9, 1.064e-6, 1.55e-6, 1.5515e-6, 2e-6, 5e-6];

test("getMaterial agrees with levtrap.materials.get_material", () => {
  const code = `
import json, math, sys
sys.path.insert(0, 'src')
from levtrap.materials import MATERIALS, get_material
wls = json.loads(sys.argv[1])
out = {n: [get_material(n, w) for w in wls] for n in MATERIALS}
print(json.dumps(out, default=str).replace('NaN', 'null'))
`;
  const py = JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["-c", code, JSON.stringify(WAVELENGTHS)], { cwd: repo, encoding: "utf8" }));
  assert.deepEqual(MATERIAL_NAMES, Object.keys(py));
  for (const name of MATERIAL_NAMES) {
    WAVELENGTHS.forEach((wl, i) => {
      const ts = getMaterial(name, wl);
      const want = py[name][i];
      assert.equal(ts.valid, want.valid, `${name} at ${wl}`);
      assert.equal(ts.density, want.density);
      assert.equal(ts.source, want.source);
      if (want.valid) {
        assert.ok(Math.abs(ts.n - want.n) < 1e-12, `${name} n at ${wl}: ${ts.n} vs ${want.n}`);
        assert.ok(Math.abs(ts.k - want.k) <= 1e-12 * Math.abs(want.k) + 1e-30, `${name} k at ${wl}`);
      }
    });
  }
});
