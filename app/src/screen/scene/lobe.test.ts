import assert from "node:assert/strict";
import { test } from "node:test";
import { lobe } from "./lobe.ts";

/** a grid as levtrap.pattern.sphere_grid lays it out: θ slowest and ascending, φ uniform */
function grid(ntheta: number, nphi: number, f: (th: number, ph: number) => number) {
  const theta: number[] = [];
  const phi: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < ntheta; i += 1) {
    for (let j = 0; j < nphi; j += 1) {
      const th = (Math.PI * (i + 0.5)) / ntheta;
      const ph = (2 * Math.PI * j) / nphi;
      theta.push(th);
      phi.push(ph);
      values.push(f(th, ph));
    }
  }
  return { theta, phi, values };
}

test("a dipole along x radiates a doughnut about x: nothing along x, most across it", () => {
  // |n̂ × x̂|² = 1 − sin²θ cos²φ
  const g = grid(36, 72, (th, ph) => 1 - (Math.sin(th) * Math.cos(ph)) ** 2);
  const L = lobe(g.theta, g.phi, g.values)!;
  assert.equal(L.ntheta, 36);
  assert.equal(L.nphi, 72);
  assert.equal(L.positions.length, (36 + 2) * 73 * 3);
  assert.equal(L.index.length, (36 + 1) * 72 * 6);
  let alongX = 0;
  let maxR = 0;
  for (let k = 0; k < L.level.length; k += 1) {
    const [x, y, z] = [L.positions[3 * k], L.positions[3 * k + 1], L.positions[3 * k + 2]];
    const r = Math.hypot(x, y, z);
    assert.ok(Math.abs(r - L.level[k]) < 1e-6);
    maxR = Math.max(maxR, r);
    alongX = Math.max(alongX, Math.abs(x));
  }
  assert.ok(Math.abs(maxR - 1) < 1e-6);
  // the surface hugs the yz plane: its extent along x is small
  assert.ok(alongX < 0.45, `extent along x ${alongX}`);
  assert.ok(Math.abs(L.peakDirection[0]) < 0.1);
});

test("the peak is the forward direction for forward scattering, and the poles close the surface", () => {
  const g = grid(20, 40, (th) => Math.exp(-((th / 0.4) ** 2)));
  const L = lobe(g.theta, g.phi, g.values)!;
  assert.ok(L.peakDirection[2] > 0.99);
  // the first row (θ = 0) is one point, repeated
  for (let j = 0; j < 41; j += 1) {
    assert.ok(Math.abs(L.positions[3 * j]) < 1e-6 && Math.abs(L.positions[3 * j + 1]) < 1e-6);
  }
});

test("no pattern without light", () => {
  assert.equal(lobe([], [], []), null);
  const g = grid(4, 8, () => 0);
  assert.equal(lobe(g.theta, g.phi, g.values), null);
});
