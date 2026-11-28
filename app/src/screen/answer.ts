/**
 * What the results strip shows for a setup: a result and where it came from,
 * or a sentence saying why there is none. Every number comes from the
 * engine; nothing is made up for a setup it cannot compute.
 */
import { EngineError } from "../engine/client.ts";
import type { BeamField, Result, Setup, TrapMode, Want } from "../engine/types.ts";
import { formatNumber, formatSI } from "../lib/format.ts";
import { directionOf, partForPath, partsOf, positionOf, pressureText, type PartId } from "./model.ts";
import { presetForSetup } from "./presets.ts";
import { RECORDED } from "./recorded.ts";
import { describeWarning, SPIRAL_CAUSE } from "./warnings.ts";

/** "preset": the engine's result recorded for a preset; "engine": computed just now. */
export type Origin = "engine" | "preset";

export type Notice =
  /** the engine cannot compute this setup yet; `ticket` is the issue that adds it */
  | { kind: "pending"; text: string; ticket?: number }
  /** the setup is invalid; `part` is the thing to fix */
  | { kind: "invalid"; text: string; part: PartId | null }
  | { kind: "failed"; text: string };

export interface Answer {
  result: Result | null;
  origin: Origin | null;
  notice: Notice | null;
}

export const NO_ANSWER: Answer = { result: null, origin: null, notice: null };

const ISSUES = "https://github.com/macroscopicquantumoptics/levtrap/issues/";
export const issueUrl = (n: number) => `${ISSUES}${n}`;

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** Why the engine refuses a setup today, and the ticket that changes it. */
export function pending(setup: Setup, engineMessage?: string): Notice {
  const fields = setup.trap.fields;
  const beams = fields.filter((f): f is BeamField => f.kind === "beam");
  const pauls = fields.filter((f) => f.kind === "paul");
  if (pauls.length > 1) return { kind: "pending", text: "Not computed yet: more than one Paul trap." };
  if (!beams.length && !pauls.length) return { kind: "pending", text: "Nothing holds the particle: add a beam or a Paul trap." };
  return { kind: "pending", text: sentence(`Not computed yet: ${(engineMessage ?? "this setup").replace(/^[\w.[\]]+: /, "")}`) };
}

/**
 * The answer that needs no engine: the recorded result of a preset, or the
 * "not computed yet" sentence of a preset the engine refuses. null: ask the
 * engine. `recorded: false` always asks the engine (the tests of the engine
 * path use it).
 */
export function instantAnswer(setup: Setup, recorded = true, want: readonly Want[] = []): Answer | null {
  const preset = presetForSetup(setup);
  if (!preset) return null;
  if (preset.pending) return { result: null, origin: null, notice: pending(setup) };
  const result = recorded ? RECORDED[preset.id] : undefined;
  return result && hasBlocks(result, want) ? { result, origin: "preset", notice: null } : null;
}

/** Whether a result carries the blocks asked for (a recorded one has the curves, not the pattern). */
export function hasBlocks(result: Result, want: readonly Want[]): boolean {
  return want.every((w) =>
    w === "curves"
      ? Boolean(result.curves)
      : w === "dipole"
        ? Boolean(result.curves && Object.values(result.curves).every((c) => c.dipole))
        : w === "field"
          ? result.field !== undefined
          : w === "lens"
            ? (result.lenses ?? []).every((l) => l.rays && l.wavefront)
            : Boolean(result.pattern),
  );
}

/** The answer for a solve that was refused or failed. */
export function answerFromError(err: unknown, setup: Setup): Answer {
  if (err instanceof EngineError) {
    if (err.kind === "unsupported") return { result: null, origin: null, notice: pending(setup, err.message) };
    if (err.kind === "setup") {
      const part = partForPath(err.path);
      const name = partsOf(setup).find((p) => p.id === part)?.name;
      const message = err.path ? err.message.slice(err.path.length + 2) : err.message;
      // "must be at least 0" needs its key in front; a full sentence does not
      const key = /^(must|is) /.test(message) ? `${err.path?.split(".").pop()?.replace(/_/g, " ")} ` : "";
      const text = name ? `${name}: ${key}${message}` : err.message;
      return { result: null, origin: null, notice: { kind: "invalid", text: sentence(text), part } };
    }
  }
  const text = err instanceof Error ? err.message : String(err);
  return { result: null, origin: null, notice: { kind: "failed", text: sentence(`The engine failed: ${text}`) } };
}

/**
 * A mode's frequency as the strip shows it. For a Paul trap the engine keeps
 * the pseudopotential value on an axis outside the stability region; that is
 * not a trap frequency, so it reads as none.
 */
export function shownFrequency(result: Result, mode: TrapMode): number | null {
  const secular = result.paul?.secular;
  const exact = (secular?.with_light ?? secular?.exact) as Record<string, number | null> | undefined;
  if (exact && mode.name in exact && exact[mode.name] === null) return null;
  return mode.frequency;
}

export interface Verdict {
  tone: "ok" | "bad" | "none";
  /** the headline sentence */
  text: string;
  /** for no trap: the usual cause and what to change */
  hint?: string;
  /** further sentences: the engine's other warnings, each with its advice */
  more: string[];
}

/**
 * The first sentence of a text, and the rest ("" when there is none). A
 * sentence ends at ".", "!" or "?" followed by a space and a capital, so
 * "0.32" and "1e-6 mbar" do not end one. On a phone the verdict shows the
 * first sentence and folds the rest away (#109).
 */
export function firstSentence(text: string): [string, string] {
  const m = /^(.+?[.!?])\s+(?=[A-Z])/su.exec(text);
  return m ? [m[1], text.slice(m[0].length)] : [text, ""];
}

const listAxes = (axes: string[]) => (axes.length > 1 ? `${axes.slice(0, -1).join(", ")} and ${axes[axes.length - 1]}` : axes[0]);

/**
 * The stability verdict as sentences. A trap the force holds (`stable`)
 * whose motion the curl still grows at this pressure (`dynamics.unstable`,
 * #101) is not called stable: it says so, and where the gas would hold it.
 */
export function verdict(answer: Answer, setup: Setup): Verdict {
  const { result, notice } = answer;
  if (!result) return { tone: "none", text: notice?.text ?? "No result yet.", more: [] };
  const described = result.warnings.map(describeWarning);
  const fatal = described.find((w) => w.fatal);
  const warnings = described.filter((w) => w !== fatal).map((w) => (w.hint ? `${w.text} ${w.hint}` : w.text));
  if (!result.stable) {
    return { tone: "bad", text: fatal?.text ?? "No stable trap.", hint: fatal?.hint, more: warnings };
  }
  const details: string[] = [];
  if (result.paul) {
    const q = Object.entries(result.paul.q).map(([axis, v]) => [axis, Math.abs(v)] as const);
    const largest = Math.max(...q.map(([, v]) => v));
    const axes = q.filter(([, v]) => v > 0.999 * largest).map(([axis]) => axis);
    if (largest > 0) details.push(`Mathieu q = ${formatNumber(largest, 2)} on ${listAxes(axes)}.`);
  }
  const eq = result.equilibrium;
  const beam = setup.trap.fields.find((f): f is BeamField => f.kind === "beam");
  if (eq && beam) {
    const d = directionOf(beam);
    const p = positionOf(beam);
    const along = eq.reduce((sum, c, i) => sum + (c - p[i]) * d[i], 0) / (Math.hypot(...d) || 1);
    details.push(
      Math.abs(along) >= 5e-10
        ? `The particle rests ${formatSI(Math.abs(along), "m")} ${along > 0 ? "downstream of" : "upstream of"} the focus.`
        : "The particle rests at the focus.",
    );
  } else if (eq) {
    const offset = Math.hypot(...eq);
    if (offset >= 5e-10) {
      const where = eq[1] < -0.9 * offset ? "below" : eq[1] > 0.9 * offset ? "above" : "from";
      details.push(`The particle rests ${formatSI(offset, "m")} ${where} the trap centre.`);
    }
  }
  const dyn = result.dynamics;
  if (dyn?.unstable) {
    // #101: the symmetric part holds the particle, but the curl grows its motion faster than the gas damps it
    const others = described.filter((w) => w.code !== "spirals-out").map((w) => (w.hint ? `${w.text} ${w.hint}` : w.text));
    const growing = result.modes.filter((_, i) => dyn.growth_rate[i] > 0).map((m) => m.name);
    const rate = Math.max(...dyn.growth_rate);
    const p = dyn.pressure_threshold;
    return {
      tone: "bad",
      text: `Stable without the curl, but at this pressure the particle spirals out: its motion along ${listAxes(growing.length ? growing : result.modes.map((m) => m.name))} grows by a factor e every ${formatSI(1 / rate, "s")}.`,
      hint: `${p != null ? `The gas damps it enough above ${pressureText(p)}.` : "No gas pressure damps it enough."} ${SPIRAL_CAUSE}`,
      more: [...details, ...others],
    };
  }
  return { tone: "ok", text: ["Stable trap.", ...details].join(" "), more: warnings };
}
