import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETUP } from "../../engine/setup.ts";
import type { BeamField, PaulField, Setup, Vec3 } from "../../engine/types.ts";
import { newPaulTrap } from "../model.ts";
import { PRESETS } from "../presets.ts";
import { beamRadius, coneHalfAngle, dot, norm } from "./geometry.ts";
import { beamGeometry, beamProfile, electrodeExtent, electrodes, fitScene, lensDistance, ROD_RATIO, toWorld, viewDirection, WORLD } from "./space.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const deg = (rad: number) => (rad * 180) / Math.PI;
const beam = DEFAULT_SETUP.trap.fields[0] as BeamField;
const room = { width: 1100, height: 560 };
const preset = (id: string) => PRESETS.find((p) => p.id === id)!.setup;

test("the scene is drawn in micrometres", () => {
  assert.equal(WORLD, 1e6);
  assert.deepEqual(toWorld([1e-6, -2e-3, 0]), [1, -2000, 0]);
});

test("the drawn cone has the NA's half-angle and the engine's waist", () => {
  const g = beamGeometry(beam, 1);
  near(deg(g.theta), 53.13010235415598); // NA 0.8
  near(g.w0, 2.540113e-7, 1e-6);
  assert.deepEqual(g.direction, [0, 0, 1]);
  // in water the same NA is a narrower cone
  near(Math.sin(beamGeometry(beam, 1.33).theta), 0.8 / 1.33);
  // far from the focus the profile is the cone, at the waist it is the waist
  const far = 1e-3;
  near(beamRadius(far, g.w0, g.theta) / far, Math.tan(g.theta), 1e-6);
  near(beamRadius(0, g.w0, g.theta), g.w0);
});

test("the profile is sampled densely at the waist and spans the range asked", () => {
  const g = beamGeometry(beam, 1);
  const p = beamProfile(g.w0, g.theta, -20e-6, 26e-6, 96);
  assert.equal(p.length, 97);
  near(p[0][0], -20e-6);
  near(p[96][0], 26e-6);
  for (let i = 1; i < p.length; i += 1) assert.ok(p[i][0] > p[i - 1][0]);
  // the smallest radius drawn is within 1 % of the waist
  near(Math.min(...p.map(([, r]) => r)), g.w0, 1e-2);
  // steps near the focus are much smaller than at the ends
  const steps = p.slice(1).map(([z], i) => z - p[i][0]);
  assert.ok(Math.min(...steps) < Math.max(...steps) / 10);
});

test("the lens sits upstream inside the view, where the cone is 40 % of it", () => {
  const g = beamGeometry(beam, 1);
  const half = 4e-6;
  const L = lensDistance(g.w0, g.theta, half);
  near(beamRadius(L, g.w0, g.theta), 0.4 * half, 1e-9);
  // a slow cone would put the lens far away: it is kept in the view
  const slow = lensDistance(1e-6, coneHalfAngle({ waist: 1e-6 }, 1.064e-6), half);
  near(slow, 0.9 * half);
  // a waist wider than that: the lens is drawn close, not past the focus
  near(lensDistance(5e-6, coneHalfAngle({ waist: 5e-6 }, 1.064e-6), half), 0.2 * half);
});

test("linear Paul electrodes: rod surfaces r0 from the axis, RF on x, end caps at ±z0", () => {
  const paul = newPaulTrap("linear") as PaulField;
  const { r0, z0 } = paul;
  const all = electrodes(paul);
  const rods = all.filter((e) => e.shape === "rod");
  assert.equal(rods.length, 4);
  for (const r of rods) {
    if (r.shape !== "rod") continue;
    near(r.radius, ROD_RATIO * r0);
    const centre = Math.hypot(r.from[0], r.from[1]);
    near(centre - r.radius, r0); // the surface nearest the axis is r0 away
    assert.ok(r.to[2] - r.from[2] > 2 * z0); // the rods span the end caps
  }
  assert.deepEqual(
    rods.filter((r) => r.role === "rf").map((r) => (r.shape === "rod" ? Math.sign(r.from[0]) : 0)),
    [1, -1],
  );
  for (const r of rods.filter((r) => r.role === "ground")) assert.equal(r.shape === "rod" && r.from[0], 0);
  const caps = all.filter((e) => e.role === "endcap");
  assert.deepEqual(
    caps.map((c) => (c.shape === "ring" ? c.centre[2] : NaN)),
    [-z0, z0],
  );
  // the end caps are open on the axis: light along z passes, and they sit inside the rods
  for (const c of caps) if (c.shape === "ring") assert.ok(c.inner > 0 && c.outer < r0);
  // the box holding them: the rods' outer edges across, the rods' ends along z
  const ext = electrodeExtent(paul);
  near(ext[0], r0 + 2 * ROD_RATIO * r0);
  near(ext[2], z0 + 0.5 * r0);
});

test("ring Paul electrodes: an RF ring of inner radius r0, end caps at ±z0", () => {
  const paul = newPaulTrap("ring") as PaulField;
  const [ring, ...caps] = electrodes(paul);
  assert.equal(ring.shape, "ring");
  if (ring.shape === "ring") {
    near(ring.inner, paul.r0);
    assert.deepEqual(ring.centre, [0, 0, 0]);
    assert.deepEqual(ring.axis, [0, 0, 1]);
  }
  assert.deepEqual(
    caps.map((c) => (c.shape === "ring" ? c.centre[2] : NaN)),
    [-paul.z0, paul.z0],
  );
  // scaling r0 and z0 scales the whole drawing
  const big = electrodes({ ...paul, r0: 2 * paul.r0, z0: 2 * paul.z0 });
  if (big[0].shape === "ring") near(big[0].outer, 2 * (ring.shape === "ring" ? ring.outer : 0));
});

test("the fit shows a tweezer at the focus scale and a Paul trap at the electrode scale", () => {
  const tweezer = fitScene(preset("tweezer"), room);
  assert.equal(tweezer.mode, "focus");
  const w0 = beamGeometry(beam, 1).w0;
  assert.ok(w0 * tweezer.pxPerMetre >= 26 && w0 * tweezer.pxPerMetre <= 56);
  const paul = fitScene(preset("paul-linear"), room);
  assert.equal(paul.mode, "electrodes");
  // the electrodes fill about half the room, not more: across or up, whichever is tighter
  const ext = electrodeExtent(preset("paul-linear").trap.fields.find((f): f is PaulField => f.kind === "paul")!);
  const across = (ext[2] + 0.4 * ext[0]) * paul.pxPerMetre;
  const up = 1.1 * Math.max(ext[0], ext[1]) * paul.pxPerMetre;
  assert.ok(across <= 0.46 * room.width + 1e-9 && up <= 0.42 * room.height + 1e-9);
  assert.ok(Math.abs(across - 0.46 * room.width) < 1e-6 || Math.abs(up - 0.42 * room.height) < 1e-6);
  // three orders of magnitude between them
  assert.ok(tweezer.pxPerMetre / paul.pxPerMetre > 1e3);
  // a beam inside a Paul trap: the electrodes set the scale
  const hybrid: Setup = { ...preset("tweezer"), trap: { fields: [beam, newPaulTrap("linear")] } };
  assert.equal(fitScene(hybrid, room).mode, "electrodes");
});

test("the three views: oblique, down the beam, and from the side", () => {
  const s = preset("tweezer");
  const along = viewDirection("along", s);
  assert.deepEqual(along, [-0, -0, -1]); // from upstream of a beam along +z
  const side = viewDirection("side", s);
  assert.deepEqual(side, [-1, 0, 0]); // the beam runs left to right, y up
  const fit = viewDirection("fit", s);
  near(norm(fit), 1);
  assert.ok(fit[1] > 0.3); // from above
  assert.ok(dot(fit, [0, 0, 1]) < 0); // and a little upstream
  // a vertical beam: looked along from below without a degenerate camera
  const up: Setup = { ...s, trap: { fields: [{ ...beam, direction: [0, 1, 0] }] } };
  const v = viewDirection("along", up);
  near(norm(v), 1);
  assert.ok(v[1] < -0.999 && Math.abs(v[1]) < 1);
});

test("a real lens is placed as the engine traces it", async () => {
  const { beamRotation, lensToLab, tiltRotation } = await import("./space.ts");
  const lens = { bfl: 1.76e-3, thickness: 3.214e-3, tilt: [0, 0] as [number, number], decentre: [0, 0] as [number, number] };
  const beam = { direction: [0, 0, 1] as [number, number, number], position: [1e-6, 2e-6, 3e-6] as [number, number, number] };
  // aligned: the S2 vertex is the back focal length before the focus, the S1 vertex the thickness before that
  const s2 = lensToLab([0, 0, lens.thickness], beam, lens);
  near(s2[2], 3e-6 - 1.76e-3, 1e-12);
  near(s2[0], 1e-6, 1e-12);
  const s1 = lensToLab([0, 0, 0], beam, lens);
  near(s1[2], 3e-6 - 1.76e-3 - 3.214e-3, 1e-12);
  // tilted about its centre: the centre stays, the vertices move sideways
  const tilted = { ...lens, tilt: [0, 1] as [number, number] };
  const centre = lensToLab([0, 0, lens.thickness / 2], beam, tilted);
  near(centre[0], 1e-6, 1e-12);
  near(centre[2], 3e-6 - 1.76e-3 - lens.thickness / 2, 1e-12);
  const v = lensToLab([0, 0, lens.thickness], beam, tilted);
  near(v[0] - 1e-6, (lens.thickness / 2) * Math.sin(Math.PI / 180), 1e-9);
  // decentred: the whole lens moves across the beam
  const off = lensToLab([0, 0, 0], beam, { ...lens, decentre: [2e-4, 0] });
  near(off[0], 1e-6 + 2e-4, 1e-12);
  // a beam along −z: the lens sits on the other side, its x the lab's x
  const back = lensToLab([1e-3, 0, lens.thickness], { ...beam, direction: [0, 0, -1] }, lens);
  near(back[2], 3e-6 + 1.76e-3, 1e-12);
  near(back[0], 1e-6 + 1e-3, 1e-12);
  // rotations are rotations
  for (const R of [beamRotation([1, 2, 3]), tiltRotation(3, -5)]) {
    for (let i = 0; i < 3; i += 1) near(Math.hypot(...R[i]), 1, 1e-12);
  }
  const d = beamRotation([1, 2, 3]);
  const z = [d[0][2], d[1][2], d[2][2]];
  near(z[0] * Math.sqrt(14), 1, 1e-12);
});

test("a parabolic mirror stands about its focus, opening along the beam", async () => {
  const { beamToLab } = await import("./space.ts");
  const { mirrorSag } = await import("../../engine/mirrors.ts");
  const m = { kind: "parabolic_mirror" as const, focal_length: 3e-3, rim_radius: 9e-3, beam_diameter: 1e-2 };
  // a beam along +x focused at p: the vertex is f behind p along x, the rim's centre 3.75 mm ahead
  const at = { direction: [1, 0, 0] as Vec3, position: [1e-6, 0, 0] as Vec3 };
  const vertex = beamToLab([0, 0, mirrorSag(m, 0)], at);
  assert.ok(Math.abs(vertex[0] - (1e-6 - 3e-3)) < 1e-15 && Math.abs(vertex[1]) < 1e-15 && Math.abs(vertex[2]) < 1e-15);
  const rim = beamToLab([0, 9e-3, mirrorSag(m, 9e-3)], at);
  assert.ok(Math.abs(rim[0] - (1e-6 + 3.75e-3)) < 1e-12 && Math.abs(rim[1] - 9e-3) < 1e-15);
});
