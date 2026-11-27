/** Which ends of a row scrolled sideways have more past them (#103). */
export interface Edges {
  start: boolean;
  end: boolean;
}

/** More to scroll on each side, from the row's scroll position and sizes (1 px of slack for rounding). */
export function edgesOf(scrollLeft: number, clientWidth: number, scrollWidth: number): Edges {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}
