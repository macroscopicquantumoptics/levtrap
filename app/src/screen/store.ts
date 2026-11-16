/**
 * The screen's state: the setup being edited, what is selected, and snapshot
 * undo/redo (one step per edit). The prototype's store; D2 adds autosave and
 * the versioned load.
 */
import type { Setup } from "../engine/types.ts";
import { partsOf, type PartId } from "./model.ts";
import { DEFAULT_PRESET, type Preset } from "./presets.ts";

const HISTORY_LIMIT = 100;

export interface ScreenState {
  setup: Setup;
  /** the preset this setup started from */
  preset: Preset;
  selected: PartId | null;
  past: Setup[];
  future: Setup[];
}

export type ScreenAction =
  /** Start from a preset; history is cleared. */
  | { type: "load"; preset: Preset }
  /** One edit, one undo step. `select` also changes the selection. */
  | { type: "edit"; setup: Setup; select?: PartId | null }
  | { type: "select"; id: PartId | null }
  | { type: "undo" }
  | { type: "redo" };

export function initialState(preset: Preset = DEFAULT_PRESET): ScreenState {
  return { setup: preset.setup, preset, selected: null, past: [], future: [] };
}

/** Keep the selection only while its part exists. */
function keepSelection(setup: Setup, id: PartId | null): PartId | null {
  return id && partsOf(setup).some((p) => p.id === id) ? id : null;
}

export function reduce(state: ScreenState, action: ScreenAction): ScreenState {
  switch (action.type) {
    case "load":
      return initialState(action.preset);
    case "edit": {
      const selected = action.select !== undefined ? action.select : state.selected;
      if (action.setup === state.setup) return { ...state, selected: keepSelection(state.setup, selected) };
      return {
        ...state,
        setup: action.setup,
        selected: keepSelection(action.setup, selected),
        past: [...state.past, state.setup].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
    case "select":
      return { ...state, selected: keepSelection(state.setup, action.id) };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        setup: previous,
        selected: keepSelection(previous, state.selected),
        past: state.past.slice(0, -1),
        future: [state.setup, ...state.future],
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        setup: next,
        selected: keepSelection(next, state.selected),
        past: [...state.past, state.setup],
        future: state.future.slice(1),
      };
    }
  }
}
