/**
 * The radiation pattern as a closed surface about the particle (#colleague
 * request: "see the radiation pattern live"): in each direction n̂ the surface
 * is at r(n̂) = I(n̂) / I_max, I the scattered power per solid angle. Pure:
 * lobe.test.ts.
 *
 * The engine's grid (levtrap.pattern.sphere_grid) is flat, θ varying slowest
 * and ascending, φ uniform from 0; θ is from +z (the beam axis), φ from +x.
 * Gauss–Legendre nodes in cos θ miss the poles, so a pole row is added with
 * the mean of the nearest row (the intensity there does not depend on φ).
 */
import type { Vec3 } from "../../engine/types.ts";

export interface Lobe {
  /** x, y, z per vertex, in units of the largest radius */
  positions: Float32Array;
  /** I / I_max per vertex */
  level: Float32Array;
  /** three vertex indices per triangle */
  index: Uint32Array;
  /** the grid's size */
  ntheta: number;
  nphi: number;
  /** I_max [W/sr] and the direction it is in */
  peak: number;
  peakDirection: Vec3;
}

export function lobe(theta: number[], phi: number[], values: number[]): Lobe | null {
  const n = values.length;
  if (!n || theta.length !== n || phi.length !== n) return null;
  let nphi = 1;
  while (nphi < n && theta[nphi] === theta[0]) nphi += 1;
  const ntheta = n / nphi;
  if (!Number.isInteger(ntheta)) return null;
  let peak = 0;
  let at = 0;
  values.forEach((v, i) => {
    if (v > peak) [peak, at] = [v, i];
  });
  if (!(peak > 0)) return null;

  // rows: the pole θ = 0, the grid's rows, the pole θ = π; each row nphi + 1 vertices (φ = 2π closes it)
  const rows: { th: number; r: number[] }[] = [];
  const row = (i: number) => values.slice(i * nphi, (i + 1) * nphi).map((v) => Math.max(0, v) / peak);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  rows.push({ th: 0, r: Array(nphi).fill(mean(row(0))) });
  for (let i = 0; i < ntheta; i += 1) rows.push({ th: theta[i * nphi], r: row(i) });
  rows.push({ th: Math.PI, r: Array(nphi).fill(mean(row(ntheta - 1))) });
  const phis = Array.from({ length: nphi + 1 }, (_, j) => (j < nphi ? phi[j] : phi[0] + 2 * Math.PI));

  const cols = nphi + 1;
  const positions = new Float32Array(rows.length * cols * 3);
  const level = new Float32Array(rows.length * cols);
  rows.forEach(({ th, r }, i) => {
    for (let j = 0; j < cols; j += 1) {
      const rr = r[j % nphi];
      const k = i * cols + j;
      positions[3 * k] = rr * Math.sin(th) * Math.cos(phis[j]);
      positions[3 * k + 1] = rr * Math.sin(th) * Math.sin(phis[j]);
      positions[3 * k + 2] = rr * Math.cos(th);
      level[k] = rr;
    }
  });
  const tris: number[] = [];
  for (let i = 0; i + 1 < rows.length; i += 1) {
    for (let j = 0; j < nphi; j += 1) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      tris.push(a, c, b, b, c, d);
    }
  }
  const th = theta[at];
  const ph = phi[at];
  return {
    positions,
    level,
    index: new Uint32Array(tris),
    ntheta,
    nphi,
    peak,
    peakDirection: [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)],
  };
}
