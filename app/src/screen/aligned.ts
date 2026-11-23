/**
 * Compare with the aligned lens (#51): the same setup with a real lens's tilt
 * and decentre set to zero, and what the misalignment did to the trap. Pure;
 * aligned.test.ts.
 */
import type { BeamField, Result, Setup, Vec3 } from "../engine/types.ts";
import { withField } from "./model.ts";

/** Whether the real lens of beam `index` is tilted or decentred. */
export function misaligned(setup: Setup, index: number): boolean {
  const f = setup.trap.fields[index];
  if (f?.kind !== "beam" || f.focus.kind !== "asphere") return false;
  return [...(f.focus.tilt_deg ?? [0, 0]), ...(f.focus.decentre ?? [0, 0])].some((v) => v !== 0);
}

/** The setup with the real lens of beam `index` aligned: no tilt, no decentre. */
export function alignedSetup(setup: Setup, index: number): Setup {
  const f = setup.trap.fields[index] as BeamField;
  if (f.focus.kind !== "asphere") return setup;
  return withField<BeamField>(setup, index, { focus: { ...f.focus, tilt_deg: [0, 0], decentre: [0, 0] } });
}

export interface Comparison {
  /** m, lab: the particle's equilibrium as set, less its equilibrium with the lens aligned */
  shift: Vec3;
  /** per mode of the setup as set, matched to the aligned mode along the nearest axis */
  modes: { name: string; frequency: number | null; aligned: number | null; change: number | null }[];
}

/** What the misalignment does: the particle's shift, and each trap frequency against the aligned lens's. Null without two stable traps. */
export function compare(asSet: Result, aligned: Result): Comparison | null {
  if (!asSet.stable || !aligned.stable || !asSet.equilibrium || !aligned.equilibrium) return null;
  const shift = asSet.equilibrium.map((v, i) => v - aligned.equilibrium![i]) as Vec3;
  const dot = (a: Vec3, b: Vec3) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  const modes = asSet.modes.map((m) => {
    // the aligned lens's mode nearest in direction (a tilt turns the axes a little)
    const match = aligned.modes.reduce((best, a) => (dot(a.axis, m.axis) > dot(best.axis, m.axis) ? a : best), aligned.modes[0]);
    const f = m.frequency;
    const f0 = match?.frequency ?? null;
    return { name: m.name, frequency: f, aligned: f0, change: f != null && f0 ? f / f0 - 1 : null };
  });
  return { shift, modes };
}
