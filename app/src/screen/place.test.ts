import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGE, GAP, placePopover } from "./place.ts";

const view = { width: 1280, height: 800 };
const at = (left: number, top: number) => ({ left, right: left + 120, top, bottom: top + 20 });

/** The popover's box on screen, for a placement and its content height. */
function box(p: ReturnType<typeof placePopover>, natural: number) {
  const h = Math.min(natural, p.maxHeight);
  const top = p.side === "up" ? view.height - p.bottom! - h : p.top!;
  return { top, bottom: top + h };
}

test("a number with room above opens upwards, as before", () => {
  const p = placePopover(at(40, 700), 348, 400, view);
  assert.equal(p.side, "up");
  assert.equal(p.bottom, view.height - 700 + GAP);
  assert.equal(p.maxHeight, 560);
});

test("#109: a 560 px explanation under a number 330 px from the top stays in the window", () => {
  // "Motion with the curl" under More with Heating open: it started at -232 px
  const p = placePopover(at(650, 330), 348, 560, view);
  const b = box(p, 560);
  assert.ok(b.top >= EDGE, `top ${b.top}`);
  assert.ok(b.bottom <= view.height - EDGE, `bottom ${b.bottom}`);
  // more room below (442 px) than above (312 px): it opens downwards, scrolling inside
  assert.equal(p.side, "down");
  assert.equal(p.maxHeight, view.height - 350 - GAP - EDGE);
});

test("a short explanation that fits above opens upwards even when there is more room below", () => {
  const p = placePopover(at(40, 330), 348, 280, view);
  assert.equal(p.side, "up");
  assert.ok(box(p, 280).top >= EDGE);
});

test("with more room above than below and neither enough, it opens upwards, capped at the room", () => {
  const p = placePopover(at(40, 380), 348, 560, { width: 1280, height: 600 });
  assert.equal(p.side, "up");
  assert.equal(p.maxHeight, 380 - GAP - EDGE);
});

test("every anchor in the window: the popover is inside it", () => {
  for (const height of [500, 700, 800, 1000])
    for (let top = 0; top < height - 20; top += 37)
      for (const natural of [120, 300, 560, 900]) {
        const v = { width: 1280, height };
        const p = placePopover(at(40, top), 348, natural, v);
        const h = Math.min(natural, p.maxHeight);
        const t = p.side === "up" ? height - p.bottom! - h : p.top!;
        assert.ok(t >= EDGE - 1e-9 && t + h <= height - EDGE + 1e-9, `height ${height}, anchor ${top}, natural ${natural}: ${t}..${t + h}`);
      }
});

test("near the right edge it ends at the number's right edge; never past either edge", () => {
  assert.equal(placePopover(at(1100, 600), 348, 300, view).left, 1220 - 348);
  assert.equal(placePopover(at(0, 600), 348, 300, view).left, EDGE);
  assert.equal(placePopover({ left: 200, right: 260, top: 600, bottom: 620 }, 348, 300, { width: 400, height: 800 }).left, EDGE);
  assert.equal(placePopover({ left: 30, right: 90, top: 600, bottom: 620 }, 348, 300, { width: 400, height: 800 }).left, 30);
});
