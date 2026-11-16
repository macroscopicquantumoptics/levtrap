import type { Setup } from "./types.ts";

/**
 * The setup the app opens with: a silica nanosphere in a 1064 nm tweezer.
 * Same as `levtrap.setup.DEFAULT_SETUP` (a unit test checks they agree).
 */
export const DEFAULT_SETUP: Setup = {
  version: 1,
  particle: { radius: 1e-7, material: "SiO2" },
  environment: { pressure: 1e-4, temperature: 300.0, gas: "N2", medium_index: 1.0 },
  trap: {
    fields: [
      {
        kind: "beam",
        id: "beam1",
        wavelength: 1.064e-6,
        power: 0.2,
        focus: { kind: "lens", NA: 0.8 },
        mode: { type: "lg", indices: [0, 0] },
        polarisation: "x",
      },
    ],
  },
};
