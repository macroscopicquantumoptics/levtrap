/**
 * Which drawer tabs cannot compute for a setup, and why (#81). A tab that
 * cannot is greyed out, with the reason as its tooltip, rather than opening
 * onto one sentence. Only what the setup alone decides is here; what
 * depends on the result (no stable trap) the tab itself says.
 *
 * The radiation pattern's rule mirrors the engine's (`levtrap.solve`, the
 * "pattern" block): every optical field has a pattern (#76), counter-propagating
 * and crossed beams, coherent or not, except a beam focused by an asphere or a
 * parabolic mirror. When the engine computes those too, this rule follows it.
 */
import type { BeamField, Setup } from "../../engine/types.ts";
import type { TabId } from "../Dock.tsx";

/** Why the radiation pattern cannot be computed for this setup, or null when it can. */
export function radiationUnavailable(setup: Setup): string | null {
  const beams = setup.trap.fields.filter((f): f is BeamField => f.kind === "beam");
  if (!beams.length) return "There is no light in this trap, so nothing is scattered.";
  if (beams.some((b) => b.focus.kind === "asphere" || b.focus.kind === "parabolic_mirror")) {
    return "The radiation pattern is not computed yet for a beam focused by an asphere or a parabolic mirror.";
  }
  return null;
}

/** The tabs that cannot compute for this setup, each with the reason in a sentence. */
export function unavailableTabs(setup: Setup): Partial<Record<TabId, string>> {
  const out: Partial<Record<TabId, string>> = {};
  const light = setup.trap.fields.some((f) => f.kind === "beam");
  const radiation = radiationUnavailable(setup);
  if (radiation) out.radiation = radiation;
  if (!light) {
    out.heating = "Heating rates are computed for traps with a beam. This trap has no light.";
    out.spectrum = "The spectrum needs the heating rates, which are computed for traps with a beam. This trap has no light.";
  }
  if (!setup.trap.fields.some((f) => f.kind === "beam" && f.focus.kind === "asphere")) {
    out.wavefront = "The wavefront error is traced for a real lens: choose Lens → Type → Asphere 354330-C.";
  }
  return out;
}
