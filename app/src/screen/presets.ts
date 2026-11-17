/**
 * Presets: named setups to start from, one per trap type. A preset the
 * engine computes carries its recorded Result (recorded.ts), so numbers are
 * on screen before the engine has loaded. A preset the engine cannot compute
 * yet (`pending`) is drawn and editable, and the strip says what is missing.
 *
 * None is tied to a paper yet: docs/validation/references.md has no verified
 * entry (C3). D6 replaces these with the tested literature setups.
 */
import { DEFAULT_SETUP } from "../engine/setup.ts";
import type { Setup } from "../engine/types.ts";
import { addField, canonical, newBeam, newGravity, newPaulTrap } from "./model.ts";

export type PresetId = "tweezer" | "counter" | "paul-linear" | "paul-ring";

export interface Preset {
  id: PresetId;
  name: string;
  /** one line: what is trapped, and how */
  blurb: string;
  /** where the values come from */
  source: string;
  /** the issue that makes the engine compute this trap type, while it cannot */
  pending?: number;
  setup: Setup;
}

const EXAMPLE = "Example values, not from a paper yet";

/** The same sphere with 30 elementary charges, for the Paul traps. */
const charged: Setup = {
  ...DEFAULT_SETUP,
  particle: { ...DEFAULT_SETUP.particle, charge: 30 },
  trap: { fields: [] },
};

export const PRESETS: Preset[] = [
  {
    id: "tweezer",
    name: "Optical tweezer",
    blurb: "A silica nanosphere held at the focus of one 1064 nm beam.",
    source: EXAMPLE,
    setup: DEFAULT_SETUP,
  },
  {
    id: "counter",
    name: "Counter-propagating beams",
    blurb: "Two opposing beams share one focus, so their scattering forces cancel.",
    source: EXAMPLE,
    setup: addField(DEFAULT_SETUP, newBeam(DEFAULT_SETUP, "counter")),
  },
  {
    id: "paul-linear",
    name: "Linear Paul trap",
    blurb: "A charged nanosphere between four RF rods and two end caps.",
    source: EXAMPLE,
    setup: addField(addField(charged, newPaulTrap("linear")), newGravity()),
  },
  {
    id: "paul-ring",
    name: "Ring Paul trap",
    blurb: "A charged nanosphere at the centre of an RF ring electrode.",
    source: EXAMPLE,
    setup: addField(addField(charged, newPaulTrap("ring")), newGravity()),
  },
];

export const DEFAULT_PRESET = PRESETS[0];

export function presetById(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

const BY_SETUP = new Map(PRESETS.map((p) => [canonical(p.setup), p]));

/** The preset whose setup is exactly this one, if any. */
export function presetForSetup(setup: Setup): Preset | undefined {
  return BY_SETUP.get(canonical(setup));
}
