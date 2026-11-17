import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETUP } from "../engine/setup.ts";
import { AUTOSAVE_KEY, forgetSetup, restoreSetup, saveSetup, type Store } from "./autosave.ts";
import { withParticle } from "./model.ts";
import { PRESETS } from "./presets.ts";

function memory(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const tweezer = PRESETS[0];
const paul = PRESETS.find((p) => p.id === "paul-linear")!;

test("a saved setup comes back as it was, with its preset", () => {
  const store = memory();
  const edited = withParticle(paul.setup, { radius: 2e-7 });
  saveSetup(store, edited, paul);
  const r = restoreSetup(store, tweezer);
  assert.equal(r.kind, "restored");
  assert.ok(r.kind === "restored");
  assert.deepEqual(r.setup, edited);
  assert.equal(r.preset.id, "paul-linear");
});

test("nothing saved: nothing restored", () => {
  assert.deepEqual(restoreSetup(memory(), tweezer), { kind: "none" });
});

test("a saved setup that no longer validates is refused, with the reason", () => {
  const store = memory();
  saveSetup(store, withParticle(DEFAULT_SETUP, { radius: -1 }), tweezer);
  assert.deepEqual(restoreSetup(store, tweezer), { kind: "refused", reason: "particle.radius must be greater than 0" });
  store.setItem(AUTOSAVE_KEY, "{not json");
  assert.equal(restoreSetup(store, tweezer).kind, "refused");
  store.setItem(AUTOSAVE_KEY, JSON.stringify({ format: 99, setup: DEFAULT_SETUP, preset: "tweezer" }));
  assert.deepEqual(restoreSetup(store, tweezer), { kind: "refused", reason: "it was saved in a format this version does not read" });
});

test("a blocked storage is not an error", () => {
  const blocked: Store = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  saveSetup(blocked, DEFAULT_SETUP, tweezer);
  forgetSetup(blocked);
  assert.deepEqual(restoreSetup(blocked, tweezer), { kind: "none" });
});

test("an unknown preset id falls back", () => {
  const store = memory();
  store.setItem(AUTOSAVE_KEY, JSON.stringify({ format: 1, setup: DEFAULT_SETUP, preset: "gone" }));
  const r = restoreSetup(store, tweezer);
  assert.ok(r.kind === "restored" && r.preset.id === "tweezer");
});
