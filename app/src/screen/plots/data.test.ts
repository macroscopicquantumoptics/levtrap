import assert from "node:assert/strict";
import { test } from "node:test";
import { gasDamping, gasHeating, KB, logSpace, meanFreePath } from "../../lib/gas.ts";
import { PRESETS } from "../presets.ts";
import type { Pattern } from "../../engine/types.ts";
import { RECORDED } from "../recorded.ts";
import { atTrapNA, axisCuts, collectedAgainstNA, harmonic, heatingCurves, informationAgainstNA, LENS_DIRECTIONS, polarCut, potential, trapLensNote } from "./data.ts";

const near = (a: number, b: number, rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} != ${b}`);
const tweezer = PRESETS.find((p) => p.id === "tweezer")!;
const r = RECORDED.tweezer!;

test("the cuts run along the eigen-axes, from the equilibrium", () => {
  const cuts = axisCuts(r);
  assert.deepEqual(
    cuts.map((c) => c.name),
    ["x", "y", "z"],
  );
  const z = cuts[2];
  assert.deepEqual(z.axis, [0, 0, 1]);
  // the middle sample is the equilibrium
  near(Math.abs(z.s[30]) + 1, 1, 1e-9);
  assert.equal(z.stiffness, r.modes[2].stiffness);
});

test("the potential integrates the force from the equilibrium, and is harmonic near it", () => {
  for (const c of axisCuts(r)) {
    const U = potential(c.s, c.force, 300);
    const H = harmonic(c.s, c.stiffness!, 300);
    const mid = c.s.findIndex((x) => Math.abs(x) < 1e-12);
    assert.ok(Math.abs(U[mid]) < 1e-9, `${c.name}: zero at the equilibrium`);
    // one sample out (50 nm), the trap is still harmonic to a few percent
    for (const i of [mid - 1, mid + 1]) near(U[i], H[i], 0.05);
    // the depth along the axis is the highest barrier on the lower side, as the engine reports it
    const mode = r.modes.find((m) => m.name === c.name)!;
    const barrier = Math.min(Math.max(...U.slice(0, mid + 1)), Math.max(...U.slice(mid)));
    near(barrier, mode.depth! / (KB * 300), 1e-4);
  }
});

test("a linear force gives a parabola exactly", () => {
  const s = [-2, -1, 0, 1, 2];
  const U = potential(
    s,
    s.map((x) => -3 * KB * x),
    1,
  );
  [6, 1.5, 0, 1.5, 6].forEach((u, i) => assert.ok(Math.abs(U[i] - u) < 1e-12, `${U[i]} != ${u}`));
});

test("the gas damping port agrees with the engine", () => {
  const g = r.rates!.gas;
  const R = tweezer.setup.particle.radius;
  near(meanFreePath(g.pressure, g.viscosity, g.molecular_mass, g.temperature), g.mean_free_path, 1e-5);
  near(gasDamping(g.pressure, R, r.particle.mass, g.viscosity, g.molecular_mass, g.temperature), r.rates!.gas_damping, 1e-5);
  // and the gas heating of each mode
  for (const m of r.rates!.modes) {
    const f = r.modes.find((x) => x.name === m.name)!.frequency!;
    near(gasHeating(r.rates!.gas_damping, g.temperature, 2 * Math.PI * f), m.gas_heating!, 1e-5);
  }
});

test("heating against pressure: gas grows with pressure, recoil does not, and they cross where the engine says", () => {
  const h = heatingCurves(r, tweezer.setup)!;
  assert.equal(h.pressure.length, 121);
  near(h.pressure[0], 1e-7);
  near(h.pressure[120], 1e5);
  for (const m of h.modes) {
    for (let i = 1; i < h.pressure.length; i += 1) assert.ok(m.gas[i] > m.gas[i - 1]);
    // at the crossover pressure the gas heating equals the recoil heating
    const p = m.crossover!;
    const R = tweezer.setup.particle.radius;
    const g = r.rates!.gas;
    const f = r.modes.find((x) => x.name === m.name)!.frequency!;
    const gas = gasHeating(gasDamping(p, R, r.particle.mass, g.viscosity, g.molecular_mass, g.temperature), g.temperature, 2 * Math.PI * f);
    near(gas, m.recoil, 1e-3);
  }
  assert.equal(heatingCurves(RECORDED["paul-linear"]!, PRESETS.find((p) => p.id === "paul-linear")!.setup), null);
});

test("the heating plot marks where the WS₂ dark trap spirals out; the tweezer has no curl (#101)", () => {
  assert.equal(heatingCurves(r, tweezer.setup)!.spiralsBelow, null);
  const ws2 = PRESETS.find((p) => p.id === "ws2-bottle")!;
  const result = RECORDED["ws2-bottle"]!;
  const h = heatingCurves(result, ws2.setup)!;
  const p = result.dynamics!.pressure_threshold!;
  assert.equal(h.spiralsBelow, p);
  assert.ok(p > h.now && p < h.pressure[h.pressure.length - 1], "the threshold is on the plot, above the setup's pressure");
  // at the threshold the gas damps at the rate the curl needs (the engine's root, recomputed with the port)
  const g = result.rates!.gas;
  near(gasDamping(p, ws2.setup.particle.radius, result.particle.mass, g.viscosity, g.molecular_mass, g.temperature), result.dynamics!.damping_needed, 1e-4);
});

test("log spacing", () => {
  assert.deepEqual(
    logSpace(1, 1000, 4).map((x) => Math.round(x)),
    [1, 10, 100, 1000],
  );
});

test("a polar cut takes both halves of a plane through the axis", () => {
  // a grid of 3 polar angles and 4 azimuths
  const theta: number[] = [];
  const phi: number[] = [];
  const value: number[] = [];
  for (const t of [0.5, 1.5, 2.5])
    for (const p of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      theta.push(t);
      phi.push(p);
      value.push(t * 10 + p);
    }
  const xz = polarCut(theta, phi, value, "xz");
  assert.deepEqual(xz.angle, [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]);
  assert.deepEqual(
    xz.value,
    [25 + Math.PI, 15 + Math.PI, 5 + Math.PI, 5, 15, 25],
  );
  const yz = polarCut(theta, phi, value, "yz");
  assert.deepEqual(yz.value.slice(3), [5 + Math.PI / 2, 15 + Math.PI / 2, 25 + Math.PI / 2]);
});

/** A pattern block cut down to what the NA curves read (#75): three NAs, four directions. */
const cones = (scale: number) => ({ x: [0.1, 0.2, 0.3].map((v) => v * scale), y: [0.05, 0.1, 0.15].map((v) => v * scale), z: [0.2, 0.3, 0.4].map((v) => v * scale) });
const pattern = {
  NA: [0.4, 0.8, 1],
  collection: { forward: [0.1, 0.3, 0.5], backward: [0.05, 0.2, 0.4], side_x: [0.02, 0.1, 0.2], side_y: [0.03, 0.12, 0.25] },
  information_efficiency: { forward: cones(1), backward: cones(2), side_x: cones(0.5), side_y: cones(0.25) },
  trap_NA: 0.8,
  at_trap_NA: {
    forward: { collection: 0.3, information: { x: 0.2, y: 0.1, z: 0.3 } },
    backward: { collection: 0.2, information: { x: 0.4, y: 0.2, z: 0.6 } },
  },
} as unknown as Pattern;

test("each direction's NA curves are the engine's own lists (#75)", () => {
  for (const d of ["forward", "backward", "side_x", "side_y"] as const) {
    assert.deepEqual(collectedAgainstNA(pattern, d), pattern.collection[d]);
    for (const ax of ["x", "y", "z"] as const) assert.deepEqual(informationAgainstNA(pattern, d, ax), pattern.information_efficiency[d][ax]);
  }
  assert.deepEqual(
    LENS_DIRECTIONS.map((d) => d.value),
    ["backward", "forward", "both", "side_x", "side_y"],
  );
});

test("forward + backward adds the two cones, which never overlap for NA <= n (#75)", () => {
  collectedAgainstNA(pattern, "both")!.forEach((v, i) => near(v, pattern.collection.forward[i] + pattern.collection.backward[i]));
  informationAgainstNA(pattern, "both", "z")!.forEach((v, i) => near(v, 3 * pattern.information_efficiency.forward.z[i]));
  // a result without one of the two has no sum to draw
  const half = { ...pattern, collection: { forward: [0.1, 0.3, 0.5] }, information_efficiency: { forward: cones(1) } } as unknown as Pattern;
  assert.equal(collectedAgainstNA(half, "both"), null);
  assert.equal(informationAgainstNA(half, "both", "x"), null);
  assert.equal(collectedAgainstNA(half, "side_x"), null);
});

test("at the trapping lens's NA: backward is the trapping lens, forward its twin, both their sum, sides none (#75)", () => {
  assert.equal(atTrapNA(pattern, "backward"), pattern.at_trap_NA!.backward);
  assert.equal(atTrapNA(pattern, "forward"), pattern.at_trap_NA!.forward);
  const both = atTrapNA(pattern, "both")!;
  near(both.collection, 0.5);
  near(both.information.x, 0.6);
  near(both.information.y, 0.3);
  near(both.information.z, 0.9);
  assert.equal(atTrapNA(pattern, "side_x"), null);
  assert.equal(atTrapNA(pattern, "side_y"), null);
  // no trapping lens (a Paul trap, or an NA above the medium's index): nothing to show
  assert.equal(atTrapNA({ ...pattern, trap_NA: null, at_trap_NA: null }, "backward"), null);
});

test("the trapping lens's NA says whose it is when several beams go its way (#97)", () => {
  const ws2 = PRESETS.find((p) => p.id === "ws2-bottle")!;
  const lens = { ...pattern, trap_NA: 0.71, trap_NA_fields: [0, 1], trap_NA_field: 1 } as Pattern;
  assert.equal(
    trapLensNote(lens, ws2.setup),
    "Beam 2's: Beam 1 and Beam 2 go the same way through one lens, which needs the larger of their NAs",
  );
  // the other beams go other ways: the first beam's own lens
  assert.equal(trapLensNote({ ...lens, trap_NA_fields: [0], trap_NA_field: 0 }, ws2.setup), "Beam 1's; no other beam goes its way");
  // one beam, or a recording from before #97: nothing to add
  assert.equal(trapLensNote({ ...lens, trap_NA_fields: [0], trap_NA_field: 0 }, tweezer.setup), null);
  assert.equal(trapLensNote(pattern, ws2.setup), null);
});
