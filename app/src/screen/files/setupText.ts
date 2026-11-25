/**
 * A setup as text, and back: the setup file (plain JSON, the engine's own
 * format: `levtrap.solve` reads it as it is) and the share link (the same
 * JSON, lz-compressed into the URL's fragment, so nothing reaches a server).
 * Both are checked on the way in by the engine's rules (engine/validate.ts).
 */
import LZString from "lz-string";
import type { Setup } from "../../engine/types.ts";
import { SetupError, validateSetup } from "../../engine/validate.ts";

export type Opened = { ok: true; setup: Setup } | { ok: false; reason: string };

/** Significant digits a number keeps when a setup is written out (#81). */
export const SIGNIFICANT_DIGITS = 12;

/**
 * A number as written in a setup file or link, without float noise (#81):
 * unit conversion leaves 129.8 mW as 0.12980000000000003 W. The number is
 * rounded to 12 significant digits when that moves it by no more than float
 * noise (a few units in the last place), so 0.1298 is written; a number that
 * really has more digits (π as a beam phase) is kept as it is, so saving and
 * opening, or sharing and loading, gives back the identical setup. Integers
 * (counts, indices, seeds) are kept exactly.
 */
export function roundNumber(x: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return x;
  const r = Number(x.toPrecision(SIGNIFICANT_DIGITS));
  return Math.abs(r - x) <= NOISE_ULPS * Number.EPSILON * Math.abs(x) ? r : x;
}

/** How far (in units of the last place, relative) a rounding may move a number and still count as removing noise. */
const NOISE_ULPS = 8;

function rounding(_key: string, value: unknown): unknown {
  return typeof value === "number" ? roundNumber(value) : value;
}

/** The setup file's text: the setup as it is (numbers rounded, #81), indented. */
export function setupFileText(setup: Setup): string {
  return `${JSON.stringify(setup, rounding, 2)}\n`;
}

/** A setup from text: JSON, and a valid setup. The setup is kept as written (not normalised). */
export function readSetupText(text: string): Opened {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "it is not JSON" };
  }
  try {
    validateSetup(raw);
  } catch (e) {
    if (e instanceof SetupError) return { ok: false, reason: e.path ? `${e.path} ${e.detail}` : e.detail };
    return { ok: false, reason: "it is not a setup" };
  }
  return { ok: true, setup: raw as Setup };
}

/** The fragment that carries a setup: `#setup=…`. */
export const LINK_KEY = "setup";

export function linkFragment(setup: Setup): string {
  return `#${LINK_KEY}=${LZString.compressToEncodedURIComponent(JSON.stringify(setup, rounding))}`;
}

/** A link to this page that opens with `setup`. */
export function shareUrl(setup: Setup, href: string): string {
  const url = new URL(href);
  url.hash = "";
  url.searchParams.delete("preset");
  return `${url.toString().replace(/#$/, "")}${linkFragment(setup)}`;
}

/** The setup in a URL fragment; null when the fragment carries none. */
export function readLinkFragment(hash: string): Opened | null {
  const m = new RegExp(`^#?${LINK_KEY}=(.+)$`).exec(hash);
  if (!m) return null;
  const text = LZString.decompressFromEncodedURIComponent(m[1]);
  if (!text) return { ok: false, reason: "the link is cut short or damaged" };
  return readSetupText(text);
}
