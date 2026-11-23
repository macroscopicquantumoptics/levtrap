import type { Setup } from "../engine/types.ts";

/** The trap types of docs/validation/references.json. */
export type Slot = "single_beam_tweezer" | "counter_propagating_or_standing_wave" | "linear_paul" | "ring_paul" | "hybrid_paul_optical" | "parabolic_mirror";

/** One literature setup (C3): checked against the paper ("verified", with its setup) or still to check ("wanted"). */
export interface Reference {
  id: string;
  slot: Slot;
  status: "verified" | "wanted";
  authors: string;
  title: string;
  journal: string;
  doi: string | null;
  setup?: Setup;
  schema_gaps?: string[];
  /** a verified entry levtrap disagrees with beyond its tolerance: the issue tracking it (C4) */
  disagrees?: number | null;
}

/** "Jain et al., Phys. Rev. Lett. 116, 243601 (2016)" */
export function shortCitation(r: Reference): string {
  const authors = r.authors.split(/,\s*/);
  const first = authors[0].split(" ").pop();
  return `${first}${authors.length > 2 ? " et al." : authors.length === 2 ? ` and ${authors[1].split(" ").pop()}` : ""}, ${r.journal}`;
}
