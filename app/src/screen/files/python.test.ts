/**
 * "Copy as Python" runs: the snippet of each preset, run by Python with
 * levtrap installed (as in CI), prints the numbers the app shows.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatNumber } from "../../lib/format.ts";
import { PRESETS } from "../presets.ts";
import { RECORDED } from "../recorded.ts";
import { pythonSnippet } from "./python.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const python = process.env.PYTHON ?? "python3";

test("the Python snippet of every preset reproduces the app's numbers", { timeout: 300_000 }, () => {
  for (const preset of PRESETS) {
    const result = RECORDED[preset.id];
    if (!result) continue;
    const run = spawnSync(python, ["-"], { input: pythonSnippet(preset.setup, preset.name), encoding: "utf8", cwd: repo, env: { ...process.env, PYTHONPATH: `${repo}src` } });
    assert.equal(run.status, 0, `${preset.id}: ${run.stderr}`);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines[0], `stable: ${result.stable ? "True" : "False"}`, preset.id);
    for (const m of result.modes) {
      const line = lines.find((l) => l.startsWith(`f_${m.name} =`))!;
      const printed = Number(line.split("=")[1].replace("Hz", ""));
      // six significant figures, as printed
      assert.ok(Math.abs(printed - m.frequency!) <= 5e-6 * m.frequency!, `${preset.id} f_${m.name}: ${printed} vs ${m.frequency}`);
    }
    const depth = Number(lines.find((l) => l.startsWith("depth ="))!.split("=")[1].replace("k_BT", ""));
    assert.ok(Math.abs(depth - result.depth.kT) <= 5e-6 * result.depth.kT, `${preset.id} depth: ${depth} vs ${formatNumber(result.depth.kT, 6)}`);
  }
});
