import assert from "node:assert/strict";
import { test } from "node:test";
import { markerRows, placeLineLabels, textWidth, type Pt } from "./labels.ts";

const area = { left: 62, top: 16, right: 600, bottom: 260 };

/** A restoring force on screen: a line through the middle, steeper for a stiffer axis. */
const force = (slope: number): Pt[] => Array.from({ length: 101 }, (_, i) => [62 + i * 5.38, 138 + slope * (i - 50)] as Pt);

/** The smallest distance (px) from a placed label's box to any point of the lines, sampled finely. */
function clearance(label: { text: string; x: number; y: number }, lines: Pt[][]): number {
  const w = textWidth(label.text) / 2;
  const [x0, x1, y0, y1] = [label.x - w, label.x + w, label.y - 11, label.y + 3];
  let d = Infinity;
  for (const pts of lines)
    for (let i = 1; i < pts.length; i++)
      for (let t = 0; t <= 1; t += 0.1) {
        const [x, y] = [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
        d = Math.min(d, Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)));
      }
  return d;
}

test("the Forces tab's three curves: each label off every curve, none over another (#81)", () => {
  const lines = [force(1.6), force(1.2), force(0.3)];
  const placed = placeLineLabels(
    lines.map((points, i) => ({ text: `along ${"xyz"[i]}`, points })),
    area,
  );
  assert.equal(placed.length, 3);
  for (const l of placed) assert.ok(clearance(l, lines) >= 2, `${l.text} at ${l.x},${l.y}: ${clearance(l, lines)} px`);
  for (const l of placed) assert.ok(l.y - 11 >= area.top && l.y + 3 <= area.bottom);
});

test("lines drawn on top of each other share one label", () => {
  const a = force(1.2);
  const placed = placeLineLabels(
    [
      { text: "along x", points: a },
      { text: "along y", points: a.map(([x, y]) => [x, y + 0.5] as Pt) },
      { text: "along z", points: force(0.3) },
    ],
    area,
  );
  assert.deepEqual(placed.map((l) => l.text).sort(), ["along x, along y", "along z"]);
});

test("two close peaks: their marker labels go in different rows, never overlapping (#81)", () => {
  const out = markerRows(
    [
      { x: 200, text: "x: 120 kHz, T_eff 300 K" },
      { x: 215, text: "y: 125 kHz, T_eff 300 K" },
      { x: 400, text: "z: 40 kHz, T_eff 300 K" },
    ],
    62,
    600,
  );
  assert.deepEqual(
    out.map((m) => m.row),
    [0, 1, 0],
  );
});

test("a marker near the right edge puts its label on the left of its line", () => {
  const [m] = markerRows([{ x: 590, text: "z: 40 kHz, T_eff 300 K" }], 62, 600);
  assert.equal(m.anchor, "end");
  assert.equal(m.x, 586);
});
