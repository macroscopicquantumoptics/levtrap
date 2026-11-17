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

/** The setup file's text: the setup as it is, indented. */
export function setupFileText(setup: Setup): string {
  return `${JSON.stringify(setup, null, 2)}\n`;
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
  return `#${LINK_KEY}=${LZString.compressToEncodedURIComponent(JSON.stringify(setup))}`;
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
