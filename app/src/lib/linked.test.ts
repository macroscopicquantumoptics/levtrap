import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { angleFromWaist, modeOrder, naFromWaist, paraxialBeamWaist, radiusFromMass, sphereMass, waistFromNA } from "./linked.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const close = (a: number, b: number, rel = 1e-12) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} != ${b}`);

test("radius, diameter and mass are one sphere", () => {
  const m = sphereMass(1e-7, 2200);
  close(m, 9.215338450530059e-18, 1e-12); // the engine's mass of the default particle
  close(radiusFromMass(m, 2200), 1e-7);
  close(radiusFromMass(sphereMass(3.3e-7, 7500), 7500), 3.3e-7);
});

test("the paraxial waist factor is the engine's", () => {
  const py = JSON.parse(
    execFileSync(
      process.env.PYTHON ?? "python3",
      ["-c", "import json,sys; sys.path.insert(0,'src'); from levtrap.special import paraxial_beam_waist as w; print(json.dumps([w(o) for o in range(8)]))"],
      { cwd: repo, encoding: "utf8" },
    ),
  );
  py.forEach((w: number, order: number) => close(paraxialBeamWaist(order), w, 1e-12));
});

test("NA and waist are one focus, by the engine's relation", () => {
  // the engine's angle for a waist (levtrap.api._beam_angle), here for the default beam
  const py = JSON.parse(
    execFileSync(
      process.env.PYTHON ?? "python3",
      [
        "-c",
        "import json,sys; sys.path.insert(0,'src'); from levtrap.api import _beam_angle as a; print(json.dumps([a({'waist': 1e-6}, 1.064e-6, 1.0, 0), a({'waist': 1.59e-6}, 1.55e-6, 1.33, 2), a({'NA': 0.8}, 1.064e-6, 1.0, 0)]))",
      ],
      { cwd: repo, encoding: "utf8" },
    ),
  );
  close(angleFromWaist(1e-6, 1.064e-6, 1.0, 0), py[0]);
  close(angleFromWaist(1.59e-6, 1.55e-6, 1.33, 2), py[1]);
  close(Math.asin(0.8), py[2]);
  // round trips
  close(naFromWaist(waistFromNA(0.8, 1.064e-6, 1.0), 1.064e-6, 1.0), 0.8);
  close(naFromWaist(waistFromNA(0.6, 1.55e-6, 1.33, 3), 1.55e-6, 1.33, 3), 0.6);
  close(waistFromNA(0.8, 1.064e-6, 1.0), 1.064e-6 / (Math.PI * 0.8), 1e-9); // 423.4 nm: λ / (π NA) (#64)
});

test("mode order", () => {
  assert.equal(modeOrder("lg", [0, 0]), 0);
  assert.equal(modeOrder("lg", [1, -2]), 4);
  assert.equal(modeOrder("hg", [1, 2]), 3);
});
