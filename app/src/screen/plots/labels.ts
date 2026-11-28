/**
 * Where a plot's text goes so it does not sit on the data (#81).
 *
 * Direct labels: each line's label went at its last point, which put it on
 * the curves where they meet (the Forces tab: three restoring forces all
 * end near the right edge). Instead each label tries spots along its own
 * line, above and below it, and takes the one farthest from every line and
 * from the labels already placed. Lines drawn on top of each other (x and
 * y in a symmetric trap) share one label.
 *
 * Marker labels: the vertical markers' labels sat in one row at the top, so
 * two close peaks (the Spectrum tab) wrote over each other. They now take
 * the first row in which they fit. A shaded band's label takes a row the
 * same way, first (#109), so it never sits on a marker's.
 *
 * All in screen px; text widths are estimated from the character count
 * (no measuring: the plot lays out in one pass).
 */

export type Pt = [number, number];

export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A label to place on its line: the text and the line's points on screen (only those in view). */
export interface LineLabel {
  text: string;
  points: Pt[];
}

/** A placed label: text-anchor middle at x, baseline at y. */
export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
}

/** Estimated text width at the plots' 12 px semibold. */
export const textWidth = (text: string, px = 12) => text.length * px * 0.62;

const LABEL_H = 12;
/** Lines closer than this everywhere (px) are drawn on top of each other. */
const SAME_LINE = 1.5;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const boxOf = (l: PlacedLabel): Box => {
  const w = textWidth(l.text) / 2 + 2;
  return { x0: l.x - w, x1: l.x + w, y0: l.y - LABEL_H + 1, y1: l.y + 3 };
};

const distance = (b: Box, [x, y]: Pt) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

const apart = (a: Box, b: Box) => a.x1 + 3 < b.x0 || b.x1 + 3 < a.x0 || a.y1 + 2 < b.y0 || b.y1 + 2 < a.y0;

/** The y of a line at screen x, by linear interpolation; null outside it. */
function yAt(points: Pt[], x: number): number | null {
  for (let i = 1; i < points.length; i++) {
    const [[xa, ya], [xb, yb]] = [points[i - 1], points[i]];
    if ((xa <= x && x <= xb) || (xb <= x && x <= xa)) return xb === xa ? ya : ya + ((yb - ya) * (x - xa)) / (xb - xa);
  }
  return null;
}

/** A line's points with more in between, no two more than 3 px apart: the clearance is from the line, not just its vertices. */
function densify(points: Pt[]): Pt[] {
  const out: Pt[] = points.slice(0, 1);
  for (let i = 1; i < points.length; i++) {
    const [[xa, ya], [xb, yb]] = [points[i - 1], points[i]];
    const n = Math.min(200, Math.ceil(Math.hypot(xb - xa, yb - ya) / 3));
    for (let j = 1; j <= n; j++) out.push([xa + ((xb - xa) * j) / n, ya + ((yb - ya) * j) / n]);
  }
  return out;
}

/** Whether two lines are drawn on top of each other. */
function sameLine(a: Pt[], b: Pt[]): boolean {
  if (!a.length || !b.length) return false;
  return a.every(([x, y]) => {
    const yb = yAt(b, x);
    return yb === null || Math.abs(yb - y) <= SAME_LINE;
  });
}

/**
 * Direct labels placed off the lines. Lines drawn on top of each other
 * share a label ("along x, along y"). Each label tries spots along its line
 * (from the right, where the eye ends), above and below it, and keeps the
 * one with the most clearance from every line, never overlapping a label
 * already placed; with no free spot the label is left out (the legend still
 * names the line).
 */
export function placeLineLabels(lines: LineLabel[], area: Area): PlacedLabel[] {
  // merge lines drawn on top of each other
  const groups: LineLabel[] = [];
  for (const l of lines) {
    if (!l.points.length) continue;
    const g = groups.find((o) => sameLine(o.points, l.points));
    if (g) g.text += `, ${l.text}`;
    else groups.push({ text: l.text, points: l.points });
  }
  const every = lines.flatMap((l) => densify(l.points));
  const placed: PlacedLabel[] = [];
  for (const g of groups) {
    let best: { label: PlacedLabel; score: number } | null = null;
    const n = g.points.length;
    const half = textWidth(g.text) / 2 + 2;
    for (let k = 0; k < 9; k++) {
      // spots along the line, from 92 % of the way to 20 %
      const [x, y] = g.points[Math.min(n - 1, Math.round((0.92 - 0.09 * k) * (n - 1)))];
      for (const dy of [-8, 16, -20, 28]) {
        const label = { text: g.text, x: Math.min(Math.max(x, area.left + half), area.right - half), y: y + dy };
        const b = boxOf(label);
        if (b.y0 < area.top || b.y1 > area.bottom) continue;
        if (!placed.every((p) => apart(boxOf(p), b))) continue;
        let clear = Infinity;
        for (const p of every) clear = Math.min(clear, distance(b, p));
        // clearance counts up to 10 px; beyond that, nearer its own line and further right is better
        const near = Math.abs(dy) / 100 + k / 50;
        const score = Math.min(clear, 10) - near;
        if (!best || score > best.score) best = { label, score };
      }
    }
    if (best) placed.push(best.label);
  }
  return placed;
}

/** A marker's label placed: start (or end) anchored beside its line, in a row. */
export interface PlacedMarker {
  x: number;
  row: number;
  anchor: "start" | "end";
}

/** A shaded band's label placed: centred at x, in a row. */
export interface PlacedBand {
  x: number;
  row: number;
}

/**
 * The top rows: the shaded bands' labels (11 px text, centred on the part
 * of the band in view) and then the markers' labels. Each label takes the
 * first row where it does not touch one already there, so a band's label
 * and a marker's never write over each other at any width (#109: on
 * Heating at 600 px, "the particle spirals out" sat on "now: 1e-6 mbar").
 * A marker's label that would run past the right edge is put on its line's
 * left. Labels are placed in the order given, bands first, so the first
 * keeps the top row.
 */
export function topLabels(
  bands: { from: number; to: number; text: string }[],
  markers: { x: number; text: string }[],
  left: number,
  right: number,
  rows = 4,
): { bands: PlacedBand[]; markers: PlacedMarker[] } {
  const taken: [number, number][][] = Array.from({ length: rows }, () => []);
  const take = (span: [number, number]) => {
    let row = taken.findIndex((r) => r.every(([a, b]) => span[1] + 6 < a || b + 6 < span[0]));
    if (row < 0) row = rows - 1;
    taken[row].push(span);
    return row;
  };
  const placedBands = bands.map(({ from, to, text }) => {
    const half = textWidth(text, 11) / 2;
    const [a, b] = [Math.max(left, Math.min(from, to)), Math.min(right, Math.max(from, to))];
    // centred on the band in view, but inside the plot
    const x = Math.min(Math.max((a + b) / 2, left + half + 2), right - half - 2);
    return { x, row: take([x - half, x + half]) };
  });
  const placedMarkers = markers.map(({ x, text }) => {
    const w = textWidth(text, 11);
    const anchor: "start" | "end" = x + 4 + w > right && x - 4 - w >= left ? "end" : "start";
    const span: [number, number] = anchor === "start" ? [x + 4, x + 4 + w] : [x - 4 - w, x - 4];
    return { x: anchor === "start" ? x + 4 : x - 4, row: take(span), anchor };
  });
  return { bands: placedBands, markers: placedMarkers };
}

/**
 * Rows for the markers' labels alone (no bands): see topLabels.
 */
export function markerRows(markers: { x: number; text: string }[], left: number, right: number, rows = 4): PlacedMarker[] {
  return topLabels([], markers, left, right, rows).markers;
}
