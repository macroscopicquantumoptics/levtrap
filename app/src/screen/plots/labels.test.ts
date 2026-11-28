import assert from "node:assert/strict";
import { test } from "node:test";
import { markerRows, placeLineLabels, textWidth, topBoxes, topLabels, type Pt } from "./labels.ts";

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

/** The span (px) of a top label: a band's centred at x, a marker's beside its line. */
const spanOf = (x: number, text: string, anchor: "start" | "end" | "middle") => {
  const w = textWidth(text, 11);
  return anchor === "middle" ? [x - w / 2, x + w / 2] : anchor === "start" ? [x, x + w] : [x - w, x];
};

test("#109: a band's label and a marker's never share a row where they would touch, at any width", () => {
  // Heating on the WS2 dark trap: shaded from the left edge to the threshold, "now" marker inside the band
  for (let width = 400; width <= 1280; width += 20) {
    const [left, right] = [62, width - 22];
    const at = (f: number) => left + f * (right - left);
    const out = topLabels(
      [{ from: at(-0.1), to: at(0.84), text: "the particle spirals out" }],
      [
        { x: at(0.25), text: "now: 1e-6 mbar" },
        { x: at(0.84), text: "spirals out below 65.4 mbar" },
      ],
      left,
      right,
    );
    const labels = [
      { row: out.bands[0]!.row, span: spanOf(out.bands[0]!.x, "the particle spirals out", "middle") },
      { row: out.markers[0].row, span: spanOf(out.markers[0].x, "now: 1e-6 mbar", out.markers[0].anchor) },
      { row: out.markers[1].row, span: spanOf(out.markers[1].x, "spirals out below 65.4 mbar", out.markers[1].anchor) },
    ];
    for (const [i, a] of labels.entries())
      for (const b of labels.slice(i + 1)) assert.ok(a.row !== b.row || a.span[1] < b.span[0] || b.span[1] < a.span[0], `width ${width}: ${JSON.stringify(labels)}`);
    // the band's label stays inside the plot
    assert.ok(labels[0].span[0] >= left && labels[0].span[1] <= right, `width ${width}`);
  }
});

test("a band's label takes the top row first; with room, a marker's shares it", () => {
  const out = topLabels([{ from: 62, to: 300, text: "the particle spirals out" }], [{ x: 450, text: "now: 1e-6 mbar" }], 62, 900);
  assert.deepEqual([out.bands[0]?.row, out.markers[0].row], [0, 0]);
  assert.equal(out.bands[0]?.x, 181);
});

test("a band zoomed out of view gets no label and takes no row", () => {
  // Heating zoomed to the right of p*: the band lies wholly left of the plot
  const left = 62;
  const right = 1258;
  const out = topLabels(
    [
      { from: -37717, to: -2637, text: "the particle spirals out" },
      { from: 1400, to: 2000, text: "no stable trap" },
    ],
    [{ x: 300, text: "now: 1e-6 mbar" }],
    left,
    right,
  );
  assert.deepEqual(out.bands, [null, null]);
  // the marker keeps the top row
  assert.equal(out.markers[0].row, 0);
  // a band that only touches the edge is out of view too
  assert.deepEqual(topLabels([{ from: 0, to: left, text: "x" }], [], left, right).bands, [null]);
});

test("#109: a direct label keeps clear of the top rows' labels", () => {
  // a line along the top of the plot, its best spots under a marker's label
  const line: Pt[] = Array.from({ length: 50 }, (_, i) => [62 + i * 11, 40]);
  const other: Pt[] = Array.from({ length: 50 }, (_, i) => [62 + i * 11, 240]);
  const lines = [
    { text: "along y", points: line },
    { text: "along z", points: other },
  ];
  const free = placeLineLabels(lines, area).find((l) => l.text === "along y")!;
  // a marker's label right where the free label went
  const top = topLabels([], [{ x: free.x - 30, text: "y: 285 kHz, T_eff 576 K" }], area.left, area.right);
  const avoid = topBoxes(top, area.top);
  const placed = placeLineLabels(lines, area, avoid).find((l) => l.text === "along y");
  if (placed) {
    const w = textWidth(placed.text) / 2 + 2;
    const b = { x0: placed.x - w, x1: placed.x + w, y0: placed.y - 11, y1: placed.y + 3 };
    for (const a of avoid) assert.ok(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0, `${JSON.stringify(placed)} on ${JSON.stringify(a)}`);
  }
  // the top boxes sit in the rows the labels are drawn in
  assert.deepEqual(avoid.map((a) => [a.y0, a.y1]), [[area.top, area.top + 14]]);
});
