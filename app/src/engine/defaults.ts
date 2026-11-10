import type { Setup } from "./types.ts";

/** The setup the app opens with: a 100 nm radius silica sphere in a 200 mW,
 * 1064 nm tweezer focused at NA 0.8. Identical to tests/fixtures/setup_v1.json
 * (checked by defaults.test.ts). */
export const DEFAULT_SETUP: Setup = {
  version: 1,
  particle: { radius: 1e-7, material: "SiO2", charge: 0 },
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
        direction: [0, 0, 1],
        position: [0, 0, 0],
        phase: 0.0,
        coherent_with: null,
      },
    ],
  },
};
