import assert from "node:assert/strict";
import { test } from "node:test";
import { LABEL_GAP, LABEL_HEIGHT, labelHalfWidth, staggerLabels, type LabelBox } from "./labels.ts";

const clear = (a: LabelBox, b: LabelBox) => Math.abs(a.x - b.x) >= a.half + b.half + LABEL_GAP || Math.abs(a.y - b.y) >= LABEL_HEIGHT + LABEL_GAP;

test("labels apart from each other keep their spots", () => {
  const boxes = [
    { x: 100, y: 100, half: 50 },
    { x: 400, y: 100, half: 50 },
    { x: 100, y: 300, half: 50 },
  ];
  assert.deepEqual(staggerLabels(boxes, 0, 800), boxes.map(({ x, y }) => ({ x, y })));
});

test("two beams on the same axis: the second label moves clear of the first, by a label's height (#81)", () => {
  const half = labelHalfWidth("Beam 2 1064 nm · 200 mW");
  const out = staggerLabels(
    [
      { x: 300, y: 200, half },
      { x: 300, y: 200, half },
    ],
    0,
    800,
  );
  assert.deepEqual(out[0], { x: 300, y: 200 });
  assert.equal(out[1].x, 300);
  assert.equal(out[1].y, 200 + LABEL_HEIGHT + LABEL_GAP);
});

test("four labels on one spot all end up readable, none covering another", () => {
  const boxes = Array.from({ length: 4 }, () => ({ x: 300, y: 400, half: 80 }));
  const out = staggerLabels(boxes, 0, 800).map((p, i) => ({ ...p, half: boxes[i].half }));
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) assert.ok(clear(out[i], out[j]), `${i} and ${j}`);
  // they stay near their spot: within two steps
  for (const p of out) assert.ok(Math.abs(p.y - 400) <= 2 * (LABEL_HEIGHT + LABEL_GAP));
});

test("at the bottom of the room a label moves up instead", () => {
  const out = staggerLabels(
    [
      { x: 300, y: 780, half: 60 },
      { x: 310, y: 780, half: 60 },
    ],
    14,
    786,
  );
  assert.equal(out[1].y, 780 - (LABEL_HEIGHT + LABEL_GAP));
});
