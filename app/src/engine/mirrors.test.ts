import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mirrorAngles, mirrorHalfAngle, mirrorReflected, mirrorSag } from "./mirrors.ts";
import type { MirrorFocus } from "./types.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const M: MirrorFocus = { kind: "parabolic_mirror", focal_length: 3e-3, rim_radius: 9e-3, hole_radius: 5e-4, beam_diameter: 1e-2 };

test("the angles and the reflected power are levtrap.mirror's", () => {
  const py = JSON.parse(
    execFileSync(
      process.env.PYTHON ?? "python3",
      ["-c", "import json, sys; sys.path.insert(0, 'src'); from levtrap.mirror import mirror_angles; import math; print(json.dumps(dict(a=mirror_angles(3e-3, 9e-3, 5e-4), r=math.exp(-2*0.5**2/25)-math.exp(-2*81/25))))"],
      { cwd: repo, encoding: "utf8" },
    ),
  );
  mirrorAngles(M).forEach((a, i) => assert.ok(Math.abs(a - py.a[i]) < 1e-12));
  assert.ok(Math.abs(mirrorReflected(M) - py.r) < 1e-12);
});

test("the rim at twice the focal length is level with the focus; the cone stays drawable", () => {
  const level = { ...M, rim_radius: 6e-3 };
  assert.ok(Math.abs(mirrorAngles(level)[1] - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(mirrorSag(level, 6e-3)) < 1e-15);
  assert.ok(Math.abs(mirrorSag(M, 0) + 3e-3) < 1e-15);
  // a 10 mm beam on f = 3 mm: its edge is at 79.6°, under the cap; a wider one is capped at 80°
  assert.ok(Math.abs((mirrorHalfAngle(M) * 180) / Math.PI - 79.61) < 0.01);
  assert.equal((mirrorHalfAngle({ ...M, beam_diameter: 0.05 }) * 180) / Math.PI, 80);
  // a narrow beam: its own cone
  assert.ok(Math.abs(mirrorHalfAngle({ ...M, beam_diameter: 1e-3 }) - 2 * Math.atan(0.5 / 6)) < 1e-12);
});
