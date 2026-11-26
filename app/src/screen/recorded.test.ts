/**
 * The recorded preset results must be what the engine computes today.
 * Needs `python3` with numpy and scipy importable (as in CI). When this
 * fails after an engine change: `npm run record`, look at the diff, commit.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Result, SolveResponse } from "../engine/types.ts";
import { PRESETS } from "./presets.ts";
import { RECORDED } from "./recorded.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const CODE = "import sys\nsys.path.insert(0, 'src')\nfrom levtrap.solve import solve_json\nprint(solve_json(sys.stdin.read(), '[\"curves\"]'))";

function solve(setup: unknown): SolveResponse {
  const text = execFileSync(process.env.PYTHON ?? "python3", ["-c", CODE], { cwd: repo, input: JSON.stringify(setup), encoding: "utf8" });
  return JSON.parse(text) as SolveResponse;
}

const REL = 1e-5;
function close(a: number | null, b: number | null, what: string) {
  if (a === null || b === null) return assert.equal(a, b, what);
  assert.ok(Math.abs(a - b) <= REL * Math.max(Math.abs(a), Math.abs(b)), `${what}: recorded ${a}, engine ${b}`);
}
/**
 * Compare vectors against their own size, so a component that is zero up to rounding passes.
 * `floor` is a size below which the vector counts as zero: a particle at a symmetric trap's
 * centre (the counter-propagating bottle beams) has an equilibrium of rounding noise only,
 * ~1e-22 m, that differs from machine to machine; it is compared against the particle's radius.
 */
function closeAll(a: number[], b: number[], what: string, floor = 0) {
  assert.equal(a.length, b.length, what);
  const scale = Math.max(floor, ...a.map(Math.abs), ...b.map(Math.abs));
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= REL * scale, `${what}[${i}]: recorded ${v}, engine ${b[i]}`));
}

/** `radius`: the particle's, the length an equilibrium of rounding noise is compared against. */
function same(rec: Result, now: Result, radius: number) {
  assert.equal(rec.stable, now.stable);
  assert.equal(rec.engine, now.engine, "recorded with another levtrap version");
  closeAll(rec.equilibrium ?? [], now.equilibrium ?? [], "equilibrium", radius);
  assert.equal(rec.modes.length, now.modes.length);
  rec.modes.forEach((m, i) => {
    assert.equal(m.name, now.modes[i].name);
    closeAll(m.axis, now.modes[i].axis, `modes[${i}].axis`);
    close(m.frequency, now.modes[i].frequency, `modes[${i}].frequency`);
    close(m.stiffness, now.modes[i].stiffness, `modes[${i}].stiffness`);
    close(m.depth, now.modes[i].depth, `modes[${i}].depth`);
  });
  close(rec.depth.kT, now.depth.kT, "depth.kT");
  close(rec.particle.mass, now.particle.mass, "particle.mass");
  close(rec.optical?.P_sca ?? null, now.optical?.P_sca ?? null, "optical.P_sca");
  for (const axis of ["x", "y", "z"] as const) {
    close(rec.paul?.q[axis] ?? null, now.paul?.q[axis] ?? null, `paul.q.${axis}`);
    close(rec.paul?.a[axis] ?? null, now.paul?.a[axis] ?? null, `paul.a.${axis}`);
  }
  close(rec.rates?.gas_damping ?? null, now.rates?.gas_damping ?? null, "rates.gas_damping");
  rec.rates?.modes.forEach((m, i) => close(m.reheating, now.rates?.modes[i].reheating ?? null, `rates.modes[${i}].reheating`));
  for (const axis of ["x", "y", "z"] as const) {
    assert.ok(rec.curves && now.curves, "curves recorded");
    closeAll(rec.curves[axis].position, now.curves[axis].position, `curves.${axis}.position`);
    closeAll(rec.curves[axis].force, now.curves[axis].force, `curves.${axis}.force`);
  }
}

for (const preset of PRESETS) {
  test(`recorded result of "${preset.name}" is the engine's`, () => {
    const response = solve(preset.setup);
    const rec = RECORDED[preset.id];
    if (!response.ok) {
      // not computed yet: when the engine starts computing it, drop `pending` and record it
      assert.equal(response.kind, "unsupported", response.error);
      assert.ok(preset.pending, "a preset the engine refuses must name its ticket in `pending`");
      assert.equal(rec, undefined);
      return;
    }
    assert.equal(preset.pending, undefined, "the engine computes this preset now: remove `pending` and run `npm run record`");
    assert.ok(rec, "run `npm run record`");
    same(rec, response.result, preset.setup.particle.radius);
  });
}
