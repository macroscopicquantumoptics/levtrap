/**
 * Presets: named setups to start from, one per trap type. A preset the
 * engine computes carries its recorded Result (recorded.ts), so numbers are
 * on screen before the engine has loaded. A preset the engine cannot compute
 * yet (`pending`) is drawn and editable, and the strip says what is missing.
 *
 * Each preset stands for a trap type (a `slot` of docs/validation/
 * references.json, C3). When a paper's setup for that type has been checked
 * against the paper ("verified"), the preset is that setup and cites it;
 * until then it keeps example values, says so, and names the paper it is
 * waiting for. No entry is verified yet.
 */
import { DEFAULT_SETUP } from "../engine/setup.ts";
import type { Setup } from "../engine/types.ts";
import { addField, canonical, newBeam, newGravity, newPaulTrap } from "./model.ts";
import type { Reference, Slot } from "./referenceTypes.ts";
import { REFERENCES } from "./references.ts";

export type PresetId = "tweezer" | "counter" | "paul-linear" | "paul-ring" | "ws2-bottle";

export interface Preset {
  id: PresetId;
  name: string;
  /** one line: what is trapped, and how */
  blurb: string;
  /** where the values come from */
  source: string;
  /** the trap type, as references.json names it */
  slot: Slot;
  /** shown as an illustration only: not validated against any paper */
  illustrative?: boolean;
  /** the paper the values are from (verified), or the papers they will come from (wanted) */
  references: Reference[];
  /** the issue that makes the engine compute this trap type, while it cannot */
  pending?: number;
  setup: Setup;
}

const EXAMPLE = "Example values, not from a paper yet";

type Base = Omit<Preset, "references">;

/** The same sphere with 30 elementary charges, for the Paul traps. */
const charged: Setup = {
  ...DEFAULT_SETUP,
  particle: { ...DEFAULT_SETUP.particle, charge: 30 },
  trap: { fields: [] },
};

const BASE: Base[] = [
  {
    id: "tweezer",
    slot: "single_beam_tweezer",
    name: "Optical tweezer",
    blurb: "A silica nanosphere held at the focus of one 1064 nm beam.",
    source: EXAMPLE,
    setup: DEFAULT_SETUP,
  },
  {
    id: "counter",
    slot: "counter_propagating_or_standing_wave",
    name: "Counter-propagating beams",
    blurb: "Two opposing beams share one focus, so their scattering forces cancel.",
    source: EXAMPLE,
    setup: addField(DEFAULT_SETUP, newBeam(DEFAULT_SETUP, "counter")),
  },
  {
    id: "paul-linear",
    slot: "linear_paul",
    name: "Linear Paul trap",
    blurb: "A charged nanosphere between four RF rods and two end caps.",
    source: EXAMPLE,
    setup: addField(addField(charged, newPaulTrap("linear")), newGravity()),
  },
  {
    id: "paul-ring",
    slot: "ring_paul",
    name: "Ring Paul trap",
    blurb: "A charged nanosphere at the centre of an RF ring electrode.",
    source: EXAMPLE,
    setup: addField(addField(charged, newPaulTrap("ring")), newGravity()),
  },
  {
    // #52: as the old site had it, after arXiv:2607.09896 (examples/paper_2607_09896.py, docs/paper)
    id: "ws2-bottle",
    slot: "dark_trap",
    name: "WS₂ bottle beam (dark trap)",
    blurb: "A 300 nm WS₂ sphere held above a dark focus: two coherent circularly polarised LG beams, opposite in phase.",
    source:
      "Illustrative, not validated: after Illetschek et al., arXiv:2607.09896. The paper does not give the power split; the one that darkens the focus is used",
    illustrative: true,
    setup: {
      version: 1,
      particle: { radius: 3e-7, material: "WS2" },
      environment: DEFAULT_SETUP.environment,
      trap: {
        fields: [
          { kind: "beam", id: "b1", wavelength: 1.55e-6, power: 0.2966, focus: { kind: "lens", waist: 1.59e-6 }, mode: { type: "lg", indices: [0, 0] }, polarisation: "circular+" },
          {
            kind: "beam",
            id: "b2",
            coherent_with: "b1",
            wavelength: 1.55e-6,
            power: 0.5034,
            focus: { kind: "lens", waist: 8.66e-7 },
            mode: { type: "lg", indices: [1, 0] },
            polarisation: "circular+",
            phase: Math.PI,
          },
        ],
      },
    },
  },
];

/**
 * The presets from the literature: a verified setup the schema can hold
 * replaces the example values of its trap type and is cited; otherwise the
 * example stays, with the papers still to check.
 */
export function buildPresets(references: readonly Reference[]): Preset[] {
  return BASE.map((base) => {
    const forSlot = references.filter((r) => r.slot === base.slot);
    // a paper levtrap disagrees with (C4) is named, not used: the example stays until the disagreement is resolved
    const paper = forSlot.find((r) => r.status === "verified" && r.setup && !r.schema_gaps?.length && !r.disagrees);
    if (paper) {
      return { ...base, setup: paper.setup!, source: `${paper.authors.split(",")[0]} et al., ${paper.journal}`, references: [paper] };
    }
    return { ...base, references: forSlot.filter((r) => r.status === "wanted" || r.disagrees) };
  });
}

export const PRESETS: Preset[] = buildPresets(REFERENCES);

export const DEFAULT_PRESET = PRESETS[0];

export function presetById(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

const BY_SETUP = new Map(PRESETS.map((p) => [canonical(p.setup), p]));

/** The preset whose setup is exactly this one, if any. */
export function presetForSetup(setup: Setup): Preset | undefined {
  return BY_SETUP.get(canonical(setup));
}
