import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { FieldBlock } from "../../engine/types.ts";
import { facingPlane, sliceCorners, sliceImage } from "./slice.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

test("the plane that faces the camera", () => {
  assert.equal(facingPlane([0, 0, -1]), "xy"); // looking along a beam on z
  assert.equal(facingPlane([0.2, -1, 0.3]), "xz"); // from the side, along y
  assert.equal(facingPlane([-0.9, 0.3, 0.4]), "yz");
});

test("the image and its corners follow the engine's planes", () => {
  // a small field from the engine itself: the default tweezer
  const code = `
import json, sys
sys.path.insert(0, 'src')
import levtrap.solve as S
S.FIELD_POINTS = 9
from levtrap.setup import DEFAULT_SETUP
f = S.solve(DEFAULT_SETUP, want=["field"])["field"]
print(json.dumps(f))`;
  const field = JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["-c", code], { cwd: repo, encoding: "utf8" })) as FieldBlock;
  const P = field.planes.xz;
  assert.equal(P.u.length, 9);
  const img = sliceImage(field, "xz", [200, 40, 40]);
  assert.equal(img.data.length, 9 * 9 * 4);
  // the brightest pixel is the most opaque, at the engine's brightest node
  let best = 0;
  P.I.forEach((row, j) => row.forEach((v, i) => (v > P.I[Math.floor(best / 9)][best % 9] ? (best = j * 9 + i) : null)));
  const alphas = Array.from({ length: 81 }, (_, k) => img.data[4 * k + 3]);
  assert.equal(alphas.indexOf(Math.max(...alphas)), best);
  assert.ok(Math.max(...alphas) <= Math.round(255 * 0.9));
  assert.deepEqual(Array.from(img.data.slice(0, 3)), [200, 40, 40]);
  // corners: x and z at the grid's ends, y at the centre's
  const c = sliceCorners(field, "xz");
  assert.deepEqual(c[0], [P.u[0], field.centre[1], P.v[0]]);
  assert.deepEqual(c[2], [P.u[8], field.centre[1], P.v[8]]);
  const xy = sliceCorners(field, "xy");
  assert.equal(xy[1][2], field.centre[2]);
});
