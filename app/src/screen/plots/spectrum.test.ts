import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KB } from "../../lib/gas.ts";
import { RECORDED } from "../recorded.ts";
import { area, spectrum } from "./spectrum.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const r = RECORDED.tweezer!;
const near = (a: number, b: number, rel: number, what: string) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${what}: ${a} != ${b}`);

test("the spectrum is levtrap.spectrum's", () => {
  const ts = [spectrum(r)!, spectrum(r, [0, 500, 0])!];
  // the scalars from spectrum_block; the curves from psd on this grid (the grids may differ by a float duplicate)
  const code = `
import json, sys
sys.path.insert(0, 'src')
import numpy as np
from levtrap.spectrum import spectrum_block, psd
d = json.load(sys.stdin)
r = d["result"]
out = []
for fb, s in zip(([0, 0, 0], [0, 500.0, 0]), d["ts"]):
    b = spectrum_block(r, feedback=fb)
    for m in b["modes"]:
        m["psd"] = psd(np.array(s["frequency"]), 2 * np.pi * m["frequency"], m["gamma"], r["particle"]["mass"], m["temperature"]).tolist()
    out.append(b)
print(json.dumps(out))
`;
  const input = JSON.stringify({ result: r, ts: ts.map((s) => ({ frequency: s.frequency })) });
  const py = JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["-c", code], { cwd: repo, input, encoding: "utf8", maxBuffer: 1 << 26 }));
  ts.forEach((s, k) => {
    const want = py[k];
    assert.ok(Math.abs(s.frequency.length - want.frequency.length) <= 3, "about the same grid");
    s.modes.forEach((m, j) => {
      const w = want.modes[j];
      assert.equal(m.name, w.name);
      for (const key of ["gamma", "occupation", "temperature", "rms"] as const) near(m[key], w[key], 1e-10, `${m.name} ${key}`);
      m.psd.forEach((v, i) => near(v, w.psd[i], 1e-9, `${m.name} psd`));
    });
  });
});

test("each peak holds k_B T_eff / (m Ω²), with and without feedback", () => {
  for (const fb of [0, 1e3]) {
    const s = spectrum(r, fb)!;
    for (const m of s.modes) {
      const omega = 2 * Math.PI * m.frequency;
      near(area(s.frequency, m.psd), (KB * m.temperature) / (r.particle.mass * omega * omega), 0.01, m.name);
    }
  }
});

test("feedback cools and widens; no rates, no spectrum", () => {
  const hot = spectrum(r)!;
  const cold = spectrum(r, 1e3)!;
  const g = hot.gasDamping;
  hot.modes.forEach((m, i) => {
    near(cold.modes[i].temperature, (m.temperature * g) / (g + 1e3), 1e-9, "T");
    near(cold.modes[i].linewidth, (g + 1e3) / (2 * Math.PI), 1e-12, "width");
  });
  assert.equal(spectrum({ ...r, rates: null }), null);
  assert.equal(spectrum({ ...r, stable: false }), null);
});
