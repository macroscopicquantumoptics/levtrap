/**
 * Every number explains itself: what it is, the formula, the values that
 * went in, and the model behind it with its validity. Entries are data, so
 * a test can check each one (the pattern D4 extends with typeset formulas).
 */
import type { ModelInfo, PaulField, Result, Setup } from "../engine/types.ts";
import { formatMass, formatNumber, formatSI } from "../lib/format.ts";
import { shownFrequency } from "./answer.ts";
import { environmentOf } from "./model.ts";

export interface Explanation {
  /** "Trap frequency along x" */
  title: string;
  /** the value as shown, with its unit */
  value: string;
  /** the full SI value, for the clipboard */
  copy: string;
  formula: string;
  inputs: { symbol: string; value: string; note: string }[];
  model: { name: string; validity: string; notes: string[] } | null;
}

const MODELS: Record<string, string> = {
  mie: "Mie theory (T-matrix): exact for a homogeneous sphere of any size",
  mathieu: "Mathieu equation: exact secular frequency",
  pseudopotential: "Pseudopotential approximation of the RF field",
};

const VALIDITY: Record<string, string> = { ok: "Valid here", approximate: "Approximate here" };

function describeModel(info: ModelInfo | undefined): Explanation["model"] {
  if (!info) return null;
  return { name: MODELS[info.model] ?? info.model, validity: VALIDITY[info.validity] ?? info.validity, notes: info.notes };
}

/** One mode's frequency. */
export function explainFrequency(result: Result, setup: Setup, index: number): Explanation {
  const mode = result.modes[index];
  const frequency = shownFrequency(result, mode);
  const info = result.models.find((m) => m.quantity === "modes");
  const paul = setup.trap.fields.find((f): f is PaulField => f.kind === "paul");
  const base = {
    title: `Trap frequency along ${mode.name}`,
    value: formatSI(frequency, "Hz"),
    copy: frequency == null ? "" : `${frequency} Hz`,
    model: describeModel(info),
  };
  const axis = mode.name as "x" | "y" | "z";
  if (result.paul && paul && axis in result.paul.q) {
    const a = { symbol: `a`, value: formatNumber(result.paul.a[axis], 3), note: `Mathieu a along ${axis}: the static field` };
    const q = { symbol: `q`, value: formatNumber(result.paul.q[axis], 3), note: `Mathieu q along ${axis}: the RF field` };
    const rf = { symbol: "f_RF", value: formatSI(paul.rf_frequency, "Hz", 3, true), note: "RF frequency" };
    if (info?.model === "mathieu") {
      const beta = frequency == null ? null : (2 * frequency) / paul.rf_frequency;
      return {
        ...base,
        formula: "f = β · f_RF / 2",
        inputs: [{ symbol: "β", value: formatNumber(beta, 3), note: "characteristic exponent of the Mathieu equation for a and q" }, a, q, rf],
      };
    }
    return { ...base, formula: "f = (f_RF / 2) · √(a + q² / 2)", inputs: [a, q, rf] };
  }
  return {
    ...base,
    formula: "f = √(k / m) / 2π",
    inputs: [
      { symbol: "k", value: formatSI(mode.stiffness, "N/m"), note: "stiffness: how fast the restoring force grows away from the equilibrium" },
      { symbol: "m", value: formatMass(result.particle.mass), note: "mass of the sphere, from its radius and density" },
    ],
  };
}

/** The trap depth. */
export function explainDepth(result: Result, setup: Setup): Explanation {
  const temperature = environmentOf(setup).temperature;
  const info = result.models.find((m) => m.quantity === "modes");
  return {
    title: "Trap depth",
    value: `${formatNumber(result.depth.kT, 3)} k_BT`,
    copy: `${result.depth.J} J`,
    formula: "U = −∫ F ds, from the equilibrium to the nearest barrier",
    inputs: [
      { symbol: "U", value: formatSI(result.depth.J, "J"), note: "the smallest depth over the three axes" },
      { symbol: "U / k_B", value: formatSI(result.depth.K, "K"), note: "the same as a temperature" },
      { symbol: "T", value: `${formatNumber(temperature, 3, true)} K`, note: "temperature of the environment" },
      ...result.modes.map((m) => ({
        symbol: `U_${m.name}`,
        value: m.depth == null ? "—" : `${formatNumber(m.depth / (result.depth.J / result.depth.kT || Infinity), 3)} k_BT`,
        note: `depth along ${m.name}`,
      })),
    ],
    model: describeModel(info),
  };
}
