/**
 * The Wavefront tab's model (#49): the rms of the map, the range it is
 * drawn over, and its pixels on a diverging scale. Pure; wavefront.test.ts.
 */
import type { Wavefront } from "../../engine/types.ts";

/** sqrt(Σ weight W² / Σ weight) over the nodes rays pass: the lens's rms_waves. */
export function weightedRms(wf: Wavefront): number {
  let num = 0;
  let den = 0;
  wf.W.forEach((row, j) =>
    row.forEach((w, i) => {
      if (w == null) return;
      num += wf.weight[j][i] * w * w;
      den += wf.weight[j][i];
    }),
  );
  return den > 0 ? Math.sqrt(num / den) : 0;
}

/**
 * The nodes to draw: where a ray passes and the beam is not negligible
 * (input intensity above 1 % of the axis's), so the map is the illuminated
 * pupil and not the dark edge of the trace grid.
 */
export const shown = (wf: Wavefront, j: number, i: number) => wf.W[j][i] != null && wf.weight[j][i] > 0.01;

/** The symmetric range ±max|W| over the shown nodes [waves]. */
export function waveRange(wf: Wavefront): number {
  let m = 0;
  wf.W.forEach((row, j) => row.forEach((w, i) => (shown(wf, j, i) ? (m = Math.max(m, Math.abs(w!))) : null)));
  return m || 1;
}

/** A diverging colour for t in [−1, 1]: blue, white, red (RGB 0–255). */
export function diverging(t: number): [number, number, number] {
  const c = Math.max(-1, Math.min(1, t));
  const blue: [number, number, number] = [42, 120, 214];
  const red: [number, number, number] = [198, 47, 46];
  const white: [number, number, number] = [247, 247, 247];
  const [a, b] = c < 0 ? [white, blue] : [white, red];
  const s = Math.abs(c);
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * s)) as [number, number, number];
}

/** RGBA pixels, row 0 = the first y (flip when drawing with y up); transparent where nothing is shown. */
export function wavefrontPixels(wf: Wavefront, range = waveRange(wf)): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const height = wf.y.length;
  const width = wf.x.length;
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      if (!shown(wf, j, i)) continue;
      const [r, g, b] = diverging(wf.W[j][i]! / range);
      const k = 4 * (j * width + i);
      data[k] = r;
      data[k + 1] = g;
      data[k + 2] = b;
      data[k + 3] = 255;
    }
  }
  return { data, width, height };
}
