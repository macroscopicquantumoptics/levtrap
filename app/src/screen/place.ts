/**
 * Where an explanation opens (#109). It opened upwards from its number with a
 * fixed height cap, so a number low on the screen but with little room above
 * it (a number under More, with a plot tab open) started above the window.
 * Now it opens on the side with room for it, upwards first, and its height is
 * capped at the room on that side: it always stays in the window.
 */

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Placement {
  left: number;
  /** the popover's top (opening downwards) */
  top?: number;
  /** the popover's bottom, from the window's bottom edge (opening upwards) */
  bottom?: number;
  maxHeight: number;
  side: "up" | "down";
}

/** Gap between the number and its explanation, and between the explanation and the window's edge (px). */
export const GAP = 10;
export const EDGE = 8;

/**
 * Place a popover of the given width beside its anchor in a window of the
 * given size. `natural` is the popover's height with no cap. It opens
 * upwards when it fits there (at most `cap` tall), else downwards when it
 * fits there, else on the side with more room, its height capped at that
 * room. It starts at the anchor's left edge, or ends at its right edge when
 * it would run past the window, and never runs past either edge.
 */
export function placePopover(anchor: Rect, width: number, natural: number, view: { width: number; height: number }, cap = Math.min(0.7 * view.height, 560)): Placement {
  const want = Math.min(natural, cap);
  const above = anchor.top - GAP - EDGE;
  const below = view.height - anchor.bottom - GAP - EDGE;
  const side: "up" | "down" = above >= want || (below < want && above >= below) ? "up" : "down";
  const maxHeight = Math.max(0, Math.min(cap, side === "up" ? above : below));
  const start = anchor.left + width + EDGE > view.width ? anchor.right - width : anchor.left;
  const left = Math.max(EDGE, Math.min(start, view.width - width - EDGE));
  return side === "up" ? { left, bottom: view.height - anchor.top + GAP, maxHeight, side } : { left, top: anchor.bottom + GAP, maxHeight, side };
}
