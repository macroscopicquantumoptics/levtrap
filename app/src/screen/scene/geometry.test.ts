import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETUP } from "../../engine/setup.ts";
import type { BeamField } from "../../engine/types.ts";
import { PRESETS } from "../presets.ts";
import {
  beamRadius,
  beamShape,
  coneHalfAngle,
  cylinder,
  discPoints,
  fitView,
  perpendicular,
  project,
  projectVector,
  RECEDE,
  scaleBar,
  TO_VIEWER,
  waistRadius,
  dot,
  norm,
  type Box,
  type View,
} from "./geometry.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const deg = (rad: number) => (rad * 180) / Math.PI;
const view: View = { scale: 100, cx: 500, cy: 300 };
const box: Box = { width: 1280, height: 600, inset: { top: 56, right: 12, bottom: 56, left: 12 } };
const beam = DEFAULT_SETUP.trap.fields[0] as BeamField;

test("the cone half-angle follows the engine's definitions", () => {
  near(deg(coneHalfAngle({ NA: 0.8 }, 1.064e-6)), 53.13010235415598);
  near(deg(coneHalfAngle({ NA: 0.8 }, 1.064e-6, 1.33)), deg(Math.asin(0.8 / 1.33)));
  near(deg(coneHalfAngle({ angle_deg: 50 }, 1.064e-6)), 50);
  // a waist W gives the divergence sin θ = λ / (π n W) (#64: a Gaussian's angular spectrum goes with k sin θ)
  near(Math.sin(coneHalfAngle({ waist: 1.59e-6 }, 1.55e-6)), 1.55e-6 / (Math.PI * 1.59e-6));
});

test("waist and cone angle are two descriptions of one focus", () => {
  const w0 = waistRadius({ NA: 0.8 }, 1.064e-6);
  near(w0, 1.064e-6 / (Math.PI * 0.8));
  near(coneHalfAngle({ waist: w0 }, 1.064e-6), Math.asin(0.8));
  assert.equal(waistRadius({ waist: 2e-6 }, 1.064e-6), 2e-6);
});

test("the drawn beam is the waist at the focus and the cone far from it", () => {
  const theta = Math.asin(0.8);
  assert.equal(beamRadius(0, 3e-7, theta), 3e-7);
  near(beamRadius(1e-3, 3e-7, theta) / 1e-3, Math.tan(theta), 1e-6);
  assert.equal(beamRadius(-2e-6, 3e-7, theta), beamRadius(2e-6, 3e-7, theta));
});

test("z runs right, y up, and x recedes up and to the right at half length", () => {
  assert.deepEqual(project(view, [0, 0, 0]), [500, 300]);
  assert.deepEqual(project(view, [0, 0, 1]), [600, 300]);
  assert.deepEqual(project(view, [0, 1, 0]), [500, 200]);
  const [u, v] = projectVector(100, [1, 0, 0]);
  near(u, 100 * RECEDE);
  near(v, -100 * RECEDE);
  near(Math.hypot(u, v), 50);
  // the line of sight projects to a point
  const [su, sv] = projectVector(100, TO_VIEWER);
  near(su, 0, 1e-12);
  near(sv, 0, 1e-12);
});

test("perpendicular gives an orthonormal pair", () => {
  for (const d of [[0, 0, 1], [1, 0, 0], [0, -9.81, 0], [1, 2, 3]] as const) {
    const [e1, e2] = perpendicular([...d]);
    near(norm(e1), 1);
    near(norm(e2), 1);
    near(dot(e1, e2), 0, 1e-12);
    near(dot(e1, [...d]), 0, 1e-12);
    near(dot(e2, [...d]), 0, 1e-12);
  }
});

test("the view fits the focus of a tweezer and the electrodes of a Paul trap", () => {
  const optical = fitView(DEFAULT_SETUP, box);
  assert.equal(optical.mode, "focus");
  near(optical.cx, 640);
  near(optical.cy, 300);
  const w0px = waistRadius(beam.focus, beam.wavelength) * optical.scale;
  assert.ok(w0px > 25 && w0px <= 56.0001, `waist drawn ${w0px} px`);
  assert.ok(DEFAULT_SETUP.particle.radius * optical.scale >= 8, "the particle is visible to scale");

  const paulSetup = PRESETS.find((p) => p.id === "paul-linear")!.setup;
  const paul = fitView(paulSetup, box);
  assert.equal(paul.mode, "electrodes");
  const [right] = project(paul, [0, 0, 2e-3 + 1e-3]);
  const [, top] = project(paul, [0, 1.6e-3, 0]);
  assert.ok(right < box.width - box.inset.right, "the rods fit in the width");
  assert.ok(top > box.inset.top, "the rods fit in the height");
});

test("a low-NA beam still fits: the view is limited by its Rayleigh range", () => {
  const setup = { ...DEFAULT_SETUP, trap: { fields: [{ ...beam, focus: { NA: 0.1 } }] } };
  const v = fitView(setup, box);
  const w0 = waistRadius({ NA: 0.1 }, beam.wavelength);
  const rayleighPx = (w0 / Math.tan(Math.asin(0.1))) * v.scale;
  assert.ok(rayleighPx <= 0.22 * (box.width - 24) + 1e-6);
});

test("the lens symbol sits on the cone and inside the view", () => {
  const v = fitView(DEFAULT_SETUP, box);
  const shape = beamShape(beam, 1, v, box);
  near(shape.theta, Math.asin(0.8));
  near(shape.lensRadius, 1.1 * beamRadius(shape.lensDistance, shape.w0, shape.theta));
  const h = box.height - box.inset.top - box.inset.bottom;
  assert.ok(shape.lensRadius * v.scale <= 0.5 * h, "the lens fits the height");
  assert.ok(shape.lensDistance * v.scale > shape.w0 * v.scale, "the lens is clear of the waist");
});

test("the scale bar is a round length near the asked size", () => {
  assert.deepEqual(scaleBar(220e6, 110), { metres: 5e-7, px: 110, label: "500 nm" });
  assert.equal(scaleBar(100e6, 110).label, "1 µm");
  assert.equal(scaleBar(1.5e5, 110).label, "1 mm");
  assert.equal(scaleBar(30e6, 110).label, "5 µm");
  for (const s of [3e4, 7e5, 2.2e8, 9e8]) {
    const bar = scaleBar(s, 110);
    assert.ok(bar.px > 55 && bar.px < 220, `${bar.px} px at scale ${s}`);
    assert.ok([1, 2, 5].includes(Math.round(bar.metres / 10 ** Math.floor(Math.log10(bar.metres) + 1e-9))));
  }
});

test("a disc perpendicular to z keeps its height and narrows with the receding x", () => {
  const points = discPoints(view, [0, 0, 0], [0, 0, 1], 1, 360);
  const xs = points.map((p) => p[0] - 500);
  const ys = points.map((p) => p[1] - 300);
  near(Math.max(...xs), 100 * RECEDE, 1e-3);
  near(Math.max(...ys), 100 * Math.hypot(1, RECEDE), 1e-3);
});

test("a rod along z shows its +z end and is as long as drawn", () => {
  const { body, face } = cylinder(view, [0, 0, -2], [0, 0, 2], 0.5);
  const faceX = face.reduce((s, p) => s + p[0], 0) / face.length;
  near(faceX, 500 + 200, 1e-6); // the face is the end at z = +2: the viewer stands to the right
  const xs = [...body, ...face].map((p) => p[0]);
  near(Math.max(...xs) - Math.min(...xs), 400 + 2 * 50 * RECEDE, 1e-3);
  const ys = body.map((p) => p[1]);
  near(Math.max(...ys) - Math.min(...ys), 2 * 50 * Math.hypot(1, RECEDE), 1e-3);
  // swapping the ends draws the same rod
  const again = cylinder(view, [0, 0, 2], [0, 0, -2], 0.5);
  near(again.face.reduce((s, p) => s + p[0], 0) / again.face.length, faceX, 1e-6);
});
