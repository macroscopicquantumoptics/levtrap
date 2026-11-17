/**
 * Autosave: the setup being edited is kept in localStorage, so a reload or a
 * new visit opens where one left off. Versioned, and checked on the way back
 * in by the same rules as the engine (engine/validate.ts): a saved setup that
 * no longer validates is not opened, and the screen says why.
 */
import type { Setup } from "../engine/types.ts";
import { SetupError, validateSetup } from "../engine/validate.ts";
import { presetById, type Preset } from "./presets.ts";

export const AUTOSAVE_KEY = "levtrap.setup";
const FORMAT = 1;

interface Saved {
  format: number;
  /** the setup as edited (not normalised, so a preset still reads as itself) */
  setup: Setup;
  /** the preset it started from */
  preset: string;
}

/** Minimal Storage, so tests can pass a fake. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Restored = { kind: "none" } | { kind: "restored"; setup: Setup; preset: Preset } | { kind: "refused"; reason: string };

export function saveSetup(store: Store, setup: Setup, preset: Preset): void {
  const saved: Saved = { format: FORMAT, setup, preset: preset.id };
  try {
    store.setItem(AUTOSAVE_KEY, JSON.stringify(saved));
  } catch {
    // storage full or blocked: autosave is a convenience
  }
}

export function restoreSetup(store: Store, fallback: Preset): Restored {
  let text: string | null;
  try {
    text = store.getItem(AUTOSAVE_KEY);
  } catch {
    return { kind: "none" };
  }
  if (text === null) return { kind: "none" };
  try {
    const saved = JSON.parse(text) as Partial<Saved>;
    if (saved.format !== FORMAT || !saved.setup) return { kind: "refused", reason: "it was saved in a format this version does not read" };
    validateSetup(saved.setup);
    return { kind: "restored", setup: saved.setup, preset: presetById(saved.preset) ?? fallback };
  } catch (e) {
    const reason = e instanceof SetupError ? (e.path ? `${e.path} ${e.detail}` : e.detail) : "it could not be read";
    return { kind: "refused", reason };
  }
}

export function forgetSetup(store: Store): void {
  try {
    store.removeItem(AUTOSAVE_KEY);
  } catch {
    // nothing to do
  }
}
