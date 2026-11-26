/**
 * Which drawer tabs cannot compute for a setup, and why (#81). A tab that
 * cannot is greyed out, with the reason as its tooltip, rather than opening
 * onto one sentence. Only what the setup alone decides is here; what
 * depends on the result (no stable trap) the tab itself says.
 *
 * The radiation pattern's rules mirror the engine's (`levtrap.solve`, the
 * "pattern" block): no asphere or parabolic mirror, and one coherent group
 * of beams along +z through the origin. When the engine computes more
 * (#76), these rules follow it.
 */
import type { BeamField, Setup } from "../../engine/types.ts";
import type { TabId } from "../Dock.tsx";
import { directionOf, positionOf } from "../model.ts";

/** The number of coherent groups among the beams (`levtrap.optics.coherent_groups`): beams joined by `coherent_with` interfere. */
export function coherentGroupCount(beams: BeamField[]): number {
  const parent = beams.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const ids = new Map(beams.flatMap((b, i) => (b.id != null ? [[b.id, i] as const] : [])));
  beams.forEach((b, i) => {
    const other = b.coherent_with != null ? ids.get(b.coherent_with) : undefined;
    if (other !== undefined) {
      const [a, c] = [root(i), root(other)];
      parent[Math.max(a, c)] = Math.min(a, c);
    }
  });
  return new Set(beams.map((_, i) => root(i))).size;
}

/** Why the radiation pattern cannot be computed for this setup, or null when it can. */
export function radiationUnavailable(setup: Setup): string | null {
  const beams = setup.trap.fields.filter((f): f is BeamField => f.kind === "beam");
  if (!beams.length) return "There is no light in this trap, so nothing is scattered.";
  if (beams.some((b) => b.focus.kind === "asphere" || b.focus.kind === "parabolic_mirror")) {
    return "The radiation pattern is not computed yet for a beam focused by an asphere or a parabolic mirror.";
  }
  const alongZ = beams.every((b) => {
    const d = directionOf(b);
    return d[0] === 0 && d[1] === 0 && d[2] > 0 && positionOf(b).every((v) => v === 0);
  });
  if (coherentGroupCount(beams) > 1 || !alongZ) {
    return "The radiation pattern is computed only for beams along +z through one focus that interfere; counter-propagating or crossed beams are not covered yet.";
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
