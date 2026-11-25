/**
 * Where the scene's labels go when two would cover each other (#81). Beams
 * on the same axis (two coherent beams of a dark trap, or the two pairs of
 * a four-beam trap) put their labels, and their lenses' labels, on the same
 * spot: Beam 2's label covered Beam 1's. Each label is a pill centred on its
 * spot; a label that overlaps one already placed moves down (or, at the
 * bottom of the room, up) by a label's height until it is clear, so every
 * label stays readable and near what it names.
 */

/** A label's spot (its centre, px) and half its width. */
export interface LabelBox {
  x: number;
  y: number;
  half: number;
}

/** A label pill's height and the gap kept between two, px (Scene.module.css .label: 12.5 px × 1.35 + 2 × 3 px padding + border). */
export const LABEL_HEIGHT = 24;
export const LABEL_GAP = 4;

/** Half a label's width for its text, as the scene estimates it (no measuring: the labels are laid out in one pass). */
export const labelHalfWidth = (text: string) => Math.min(150, 12 + 3.4 * text.length);

const overlaps = (a: LabelBox, b: LabelBox) => Math.abs(a.x - b.x) < a.half + b.half + LABEL_GAP && Math.abs(a.y - b.y) < LABEL_HEIGHT + LABEL_GAP;

/**
 * The labels' centres, in order, staggered so that none covers another.
 * The first label keeps its spot; each later one moves by whole steps of a
 * label's height, down first, then up, alternating outwards, to the nearest
 * free place within [top, bottom] (centres). With no free place it keeps
 * its spot.
 */
export function staggerLabels(boxes: LabelBox[], top: number, bottom: number): { x: number; y: number }[] {
  const placed: LabelBox[] = [];
  const step = LABEL_HEIGHT + LABEL_GAP;
  for (const b of boxes) {
    let at: LabelBox = b;
    if (placed.some((p) => overlaps(p, b))) {
      for (let k = 1; k <= 12; k++) {
        const tries = [b.y + k * step, b.y - k * step].filter((y) => y >= top && y <= bottom);
        const free = tries.map((y) => ({ ...b, y })).find((c) => !placed.some((p) => overlaps(p, c)));
        if (free) {
          at = free;
          break;
        }
      }
    }
    placed.push(at);
  }
  return placed.map(({ x, y }) => ({ x, y }));
}
