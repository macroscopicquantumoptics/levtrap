import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { asphereHalfAngle, LENSES, sag } from "./lenses.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("the drawn lens is the traced lens: the prescription and the sag agree with levtrap.lens", () => {
  const py = JSON.parse(
    execFileSync(
      process.env.PYTHON ?? "python3",
      [
        "-c",
        `
import json, sys
sys.path.insert(0, 'src')
from levtrap.lens import THORLABS_354330 as L
s = lambda S: dict(c=S.curv, k=S.conic, A=list(S.coeffs), sd=S.semi_diameter, sag=[float(S.sag(r * r)) for r in (0.5, 1.0, 1.5)])
print(json.dumps(dict(s1=s(L.s1), s2=s(L.s2), t=L.thickness, bfl=L.design_bfl)))
`,
      ],
      { cwd: repo, encoding: "utf8" },
    ),
  );
  const lens = LENSES["354330-C"];
  for (const key of ["s1", "s2"] as const) {
    const { sag: sags, ...prescription } = py[key];
    assert.deepEqual({ c: lens[key].c, k: lens[key].k, A: lens[key].A, sd: lens[key].sd }, prescription);
    [0.5, 1.0, 1.5].forEach((r, i) => assert.ok(Math.abs(sag(lens[key], r) - sags[i]) < 1e-12, `${key} sag at ${r} mm`));
  }
  // mm in the prescription, m here: equal to the last bit of a double
  assert.ok(Math.abs(lens.thickness - py.t * 1e-3) < 1e-18);
  assert.ok(Math.abs(lens.bfl - py.bfl * 1e-3) < 1e-18);
});

test("the cone of a beam on the lens: paraxial, capped at the lens's NA", () => {
  const lens = LENSES["354330-C"];
  assert.ok(Math.abs(Math.tan(asphereHalfAngle(lens, 2.5e-3)) - 1.25 / 3.1) < 1e-12);
  assert.ok(Math.abs(Math.sin(asphereHalfAngle(lens, 20e-3)) - 0.68) < 1e-12);
});
