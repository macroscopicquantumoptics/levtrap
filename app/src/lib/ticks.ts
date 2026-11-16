/** Axis ticks and SI prefixes for plots. */

/** Round tick values (steps of 1, 2 or 5 × 10ⁿ) covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const [lo, hi] = min < max ? [min, max] : [max, min];
  const raw = (hi - lo) / Math.max(1, count);
  const decade = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * decade).find((s) => s >= raw) ?? 10 * decade;
  // a range end that misses a round value by rounding noise still gets its tick
  const first = Math.ceil(lo / step - 1e-6);
  const last = Math.floor(hi / step + 1e-6);
  const ticks: number[] = [];
  for (let i = first; i <= last; i += 1) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

const PREFIXES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
  [1e-15, "f"],
  [1e-18, "a"],
  [1e-21, "z"],
];

/** The SI prefix that suits values up to `maxAbs`: 3e-6 -> { factor: 1e-6, prefix: "µ" }. */
export function siPrefix(maxAbs: number): { factor: number; prefix: string } {
  const abs = Math.abs(maxAbs);
  if (!Number.isFinite(abs) || abs === 0) return { factor: 1, prefix: "" };
  const [factor, prefix] = PREFIXES.find(([s]) => abs >= s) ?? PREFIXES[PREFIXES.length - 1];
  return { factor, prefix };
}

/** Linear interpolation of y at x in points sorted by x; null outside their range. */
export function interpolate(points: readonly (readonly [number, number])[], x: number): number | null {
  if (!points.length || x < points[0][0] || x > points[points.length - 1][0]) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = points[lo];
  const [x1, y1] = points[hi];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}
