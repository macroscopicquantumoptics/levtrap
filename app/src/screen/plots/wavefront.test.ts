import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { LensResult } from "../../engine/types.ts";
import { diverging, shown, waveRange, wavefrontPixels, weightedRms } from "./wavefront.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

/** The engine's lens block for the tweezer through the 354330-C, tilted 0.3° about y. */
function lens(): LensResult {
  const code = `
import copy, json, sys
sys.path.insert(0, 'src')
from levtrap.setup import DEFAULT_SETUP
from levtrap.solve import solve
s = copy.deepcopy(DEFAULT_SETUP)
s["trap"]["fields"][0]["focus"] = dict(kind="asphere", beam_diameter=5e-3, tilt_deg=[0, 0.3], decentre=[0, 0])
print(json.dumps(solve(s, want=["lens"])["lenses"][0]))`;
  return JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["-c", code], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 26 }));
}

test("the map's rms is the lens's rms_waves, and the pixels follow the map", () => {
  const l = lens();
  const wf = l.wavefront!;
  assert.ok(Math.abs(weightedRms(wf) - l.rms_waves) < 1e-9 * l.rms_waves, `${weightedRms(wf)} vs ${l.rms_waves}`);
  const range = waveRange(wf);
  assert.ok(range > l.rms_waves);
  const img = wavefrontPixels(wf, range);
  assert.equal(img.data.length, wf.x.length * wf.y.length * 4);
  // a node outside the beam is transparent; the centre is drawn
  assert.equal(img.data[3], 0);
  const c = Math.floor(wf.y.length / 2) * wf.x.length + Math.floor(wf.x.length / 2);
  assert.ok(shown(wf, Math.floor(wf.y.length / 2), Math.floor(wf.x.length / 2)));
  assert.equal(img.data[4 * c + 3], 255);
  // the rays: two fans, four points each
  assert.deepEqual([...new Set(l.rays!.map((r) => r.fan))].sort(), ["x", "y"]);
  assert.ok(l.rays!.every((r) => r.points.length === 4));
});

test("the diverging scale: blue below, white at zero, red above", () => {
  assert.deepEqual(diverging(0), [247, 247, 247]);
  assert.deepEqual(diverging(1), [198, 47, 46]);
  assert.deepEqual(diverging(-1), [42, 120, 214]);
  assert.deepEqual(diverging(5), diverging(1));
});
