/**
 * "Darken the focus" for a coherent pair of beams (#79): the power split the
 * engine reports per pair (Result.coherent, levtrap.optics.dark_split), and
 * the setup with it. Pure; darken.test.ts.
 */
import type { Result, Setup } from "../engine/types.ts";
import { coherentGroups, splitOf, withSplit } from "./plots/sweep.ts";

export interface DarkFocus {
  /** the pair, as indices into trap.fields */
  pair: [number, number];
  /** the fraction of the pair's power in its second beam that darkens the focus */
  split: number;
  /** |E|² left at the focus at that split, over the two beams' intensities added (0: a null) */
  residual: number;
  /** the fraction now */
  now: number;
}

/**
 * The dark split of the coherent pair a beam belongs to, or null: when the
 * beam is in no pair (alone, or in a group of three or more), when the result
 * does not have this pair (it is from another setup), or when one of the two
 * beams has no light at the focus (a doughnut mode), so that no split
 * between 0 and 1 darkens it.
 */
export function darkFocus(setup: Setup, result: Result | null, index: number): DarkFocus | null {
  const group = coherentGroups(setup).find((g) => g.includes(index));
  if (!group || group.length !== 2) return null;
  const entry = result?.coherent?.find((c) => c.fields[0] === group[0] && c.fields[1] === group[1]);
  if (!entry || entry.dark_split == null || entry.residual == null) return null;
  if (!(entry.dark_split > 0 && entry.dark_split < 1)) return null;
  const pair: [number, number] = [group[0], group[1]];
  return { pair, split: entry.dark_split, residual: entry.residual, now: splitOf(setup, pair) };
}

/** The setup with the pair's power split so that the focus is dark, at the same total power. */
export function darkened(setup: Setup, dark: DarkFocus): Setup {
  return withSplit(setup, dark.pair, dark.split);
}
