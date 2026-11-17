/**
 * The numbers of a Result as a file: CSV (one quantity per row, SI units,
 * the model behind it) or JSON (the setup and the engine's whole Result).
 */
import type { Result, Setup } from "../../engine/types.ts";
import { shownFrequency } from "../answer.ts";
import { csvText } from "./download.ts";

export interface Row {
  quantity: string;
  axis: string;
  value: number | string | null;
  unit: string;
  model: string;
}

const modelOf = (result: Result, quantity: string) => {
  const m = result.models.find((x) => x.quantity === quantity);
  return m ? `${m.model} (${m.validity})` : "";
};

/** Every number the screen shows, one per row. */
export function resultRows(result: Result): Row[] {
  const rows: Row[] = [];
  const modes = modelOf(result, "modes");
  const add = (quantity: string, axis: string, value: Row["value"], unit: string, model = modes) => rows.push({ quantity, axis, value, unit, model });
  add("stable", "", result.stable ? "true" : "false", "");
  for (const m of result.modes) add("trap frequency", m.name, shownFrequency(result, m), "Hz");
  for (const m of result.modes) add("stiffness", m.name, m.stiffness, "N/m");
  for (const m of result.modes) add("depth along axis", m.name, m.depth, "J");
  add("depth", "", result.depth.J, "J");
  add("depth", "", result.depth.K, "K");
  add("depth", "", result.depth.kT, "k_BT");
  (result.equilibrium ?? [null, null, null]).forEach((c, i) => add("equilibrium position", "xyz"[i], c, "m"));
  add("mass", "", result.particle.mass, "kg", "");
  if (result.optical) {
    const optical = modelOf(result, "optical");
    add("scattered power", "", result.optical.P_sca, "W", optical);
    add("absorbed power", "", result.optical.P_abs, "W", optical);
  }
  if (result.paul) {
    for (const axis of ["x", "y", "z"] as const) add("Mathieu a", axis, result.paul.a[axis], "");
    for (const axis of ["x", "y", "z"] as const) add("Mathieu q", axis, result.paul.q[axis], "");
    (result.paul.micromotion ?? [null, null, null]).forEach((a, i) => add("micromotion amplitude", "xyz"[i], a, "m"));
  }
  for (const lens of result.lenses ?? []) {
    const m = modelOf(result, "lens");
    lens.focus_shift.forEach((c, i) => add(`focus shift by lens ${lens.field + 1}`, "xyz"[i], c, "m", m));
    add(`clipping loss of lens ${lens.field + 1}`, "", lens.clipping_loss, "", m);
    add(`wavefront error behind lens ${lens.field + 1}`, "", lens.rms_waves, "waves rms", m);
    add(`trap axis tilt by lens ${lens.field + 1}`, "", lens.trap_axis_tilt_mrad, "mrad");
  }
  for (const mirror of result.mirrors ?? []) {
    const m = modelOf(result, "mirror");
    add(`reflected by mirror ${mirror.field + 1}`, "", mirror.reflected, "", m);
    add(`rim angle of mirror ${mirror.field + 1}`, "", mirror.rim_angle_deg, "deg", m);
    add(`hole angle of mirror ${mirror.field + 1}`, "", mirror.hole_angle_deg, "deg", m);
  }
  if (result.rates) {
    add("gas damping", "", result.rates.gas_damping, "1/s", modelOf(result, "gas_damping"));
    const recoil = modelOf(result, "recoil_heating");
    for (const m of result.rates.modes) add("reheating", m.name, m.reheating, "phonons/s", recoil);
    for (const m of result.rates.modes) add("recoil exceeds gas heating below", m.name, m.crossover_pressure, "Pa", recoil);
  }
  return rows;
}

export function resultsCsv(result: Result): string {
  return csvText(
    ["quantity", "axis", "value", "unit", "model"],
    resultRows(result).map((r) => [r.quantity, r.axis, r.value, r.unit, r.model]),
  );
}

/** The setup and its whole Result, as the engine returned it. */
export function resultsJson(setup: Setup, result: Result): string {
  return `${JSON.stringify({ format: "levtrap result", setup, result }, null, 2)}\n`;
}
