import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { BeamField, Result } from "../engine/types.ts";
import { ASPHERE_RESULT, ASPHERE_SETUP } from "./asphere.fixture.ts";
import { alignedSetup, compare, misaligned } from "./aligned.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("the aligned setup has no tilt and no decentre, and nothing else changes", () => {
  assert.ok(misaligned(ASPHERE_SETUP, 0));
  const a = alignedSetup(ASPHERE_SETUP, 0);
  const f = a.trap.fields[0] as BeamField;
  assert.deepEqual(f.focus, { ...(ASPHERE_SETUP.trap.fields[0] as BeamField).focus, tilt_deg: [0, 0], decentre: [0, 0] });
  assert.equal(misaligned(a, 0), false);
  assert.deepEqual({ ...a, trap: null }, { ...ASPHERE_SETUP, trap: null });
});

test("the shift is the difference of the two solves' equilibria, and zero for the aligned lens itself", () => {
  // the engine's answer for the aligned lens
  // as the app asks for it: from the tilted lens's equilibrium, so both describe the same trap
  const code = `import json, sys; sys.path.insert(0, 'src'); from levtrap.solve import solve; d = json.load(sys.stdin); print(json.dumps(solve(d["setup"], start=d["start"])))`;
  const input = JSON.stringify({ setup: alignedSetup(ASPHERE_SETUP, 0), start: ASPHERE_RESULT.equilibrium });
  const aligned = JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["-c", code], { cwd: repo, input, encoding: "utf8" })) as Result;
  assert.equal(aligned.followed?.jumped, false, "the aligned lens holds the same trap");
  const c = compare(ASPHERE_RESULT, aligned)!;
  c.shift.forEach((v, i) => assert.equal(v, ASPHERE_RESULT.equilibrium![i] - aligned.equilibrium![i]));
  // a 0.3 degree tilt about y moves this weak, aberrated trap 1.5 um along the axis (the focus moves 0.28 um):
  // the same trap, followed continuously from the aligned lens; nothing along y
  assert.ok(Math.abs(c.shift[2] + 1.5e-6) < 0.05e-6 && Math.abs(c.shift[0]) < 0.1e-6 && Math.abs(c.shift[1]) < 1e-12, String(c.shift));
  // each frequency against the aligned one along the same axis
  assert.deepEqual(
    c.modes.map((m) => m.name),
    ["x", "y", "z"],
  );
  for (const m of c.modes) assert.ok(Math.abs(m.change! - (m.frequency! / m.aligned! - 1)) < 1e-15);
  // the aligned lens against itself: no shift, no change
  const self = compare(aligned, aligned)!;
  assert.deepEqual(self.shift, [0, 0, 0]);
  assert.ok(self.modes.every((m) => m.change === 0));
  // without a stable trap there is nothing to compare
  assert.equal(compare({ ...ASPHERE_RESULT, stable: false }, aligned), null);
});
