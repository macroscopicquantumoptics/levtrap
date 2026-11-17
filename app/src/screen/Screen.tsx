"use client";

import { useEffect, useReducer, useState } from "react";
import type { Engine } from "../engine/client.ts";
import type { Setup } from "../engine/types.ts";
import { AddField } from "./AddField.tsx";
import { Dock, type TabId } from "./Dock.tsx";
import { useAnswer, useIsClient, useMedia } from "./hooks.ts";
import { Inspector } from "./Inspector.tsx";
import { partsOf, type PartId } from "./model.ts";
import { PartsRow } from "./PartsRow.tsx";
import { PresetPicker } from "./PresetPicker.tsx";
import { DEFAULT_PRESET, presetById, presetForSetup } from "./presets.ts";
import { Scene } from "./Scene.tsx";
import { initialState, reduce } from "./store.ts";
import { TopBar, type ShowOptions } from "./TopBar.tsx";
import styles from "./Screen.module.css";

export interface ScreenProps {
  /** The engine for this page; null for a preview without one. */
  engine: (() => Engine) | null;
}

const WELCOMED_KEY = "levtrap.welcomed";
const NARROW = "(max-width: 720px)";

/**
 * The one screen: the trap drawn, the thing you select and its inputs, and
 * the answer always at the bottom. Query parameters, for links and tests:
 *   ?preset=<id>   start from that preset, without the picker
 *   ?recorded=0    ask the engine even for a preset's own values
 */
export function Screen({ engine }: ScreenProps) {
  const isClient = useIsClient();
  // the screen measures itself and reads the address: it renders in the browser only
  if (!isClient) return <div className={styles.screen} />;
  return <ScreenBody engine={engine} />;
}

function readParams() {
  const q = new URLSearchParams(window.location.search);
  let welcomed = false;
  try {
    welcomed = window.localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    // storage blocked: the picker shows on every visit
  }
  const preset = presetById(q.get("preset"));
  return { preset, recorded: q.get("recorded") !== "0", firstVisit: !preset && !welcomed };
}

function ScreenBody({ engine }: ScreenProps) {
  const [params] = useState(readParams);
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(params.preset ?? DEFAULT_PRESET));
  const { setup, selected } = state;
  const { answer, pending, status } = useAnswer(setup, engine, params.recorded);
  const narrow = useMedia(NARROW);
  const [show, setShow] = useState<ShowOptions>({ labels: true, grid: true, axes: false, forces: false, trueSize: false });
  const [tab, setTab] = useState<TabId | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState(params.firstVisit);

  const parts = partsOf(setup);
  const part = parts.find((p) => p.id === selected);
  const select = (id: PartId | null) => dispatch({ type: "select", id });
  const edit = (next: Setup, pick?: PartId | null) => dispatch({ type: "edit", setup: next, select: pick });
  const named = presetForSetup(setup);
  const name = named ? named.name : `${state.preset.name} · edited`;

  const closePicker = () => {
    setPicker(false);
    try {
      window.localStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      // storage blocked
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Escape") {
        if (typing) (e.target as HTMLElement).blur();
        else dispatch({ type: "select", id: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inspectorOpen = Boolean(part);
  const inset = narrow ? { top: 54, right: 8, bottom: 8, left: 8 } : { top: 60, right: inspectorOpen ? 344 : 14, bottom: 14, left: 14 };

  return (
    <div className={styles.screen} data-selected={inspectorOpen || undefined} data-testid="screen">
      <div className={styles.stage}>
        <Scene setup={setup} result={answer.result} selected={selected} onSelect={select} inset={inset} labels={show.labels && !narrow} grid={show.grid} overlays={show} />
        <TopBar
          name={name}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
          show={show}
          onShow={setShow}
          onPresets={() => setPicker(true)}
          status={status}
        />
        {!narrow && (
          <div className={styles.corner}>
            <AddField setup={setup} onEdit={edit} />
            <PartsRow parts={show.labels ? parts.filter((p) => p.kind === "environment") : parts} selected={selected} onSelect={select} />
          </div>
        )}
      </div>

      {part && (
        <div className={styles.inspector}>
          <Inspector key={part.id} setup={setup} part={part} result={answer.result} notice={answer.notice} onEdit={edit} onClose={() => select(null)} />
        </div>
      )}

      <div className={styles.dock}>
        <Dock
          setup={setup}
          answer={answer}
          pending={pending}
          status={status}
          tab={tab}
          onTab={setTab}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          onSelect={select}
        />
      </div>

      {narrow && !part && (
        <div className={styles.sheet}>
          <AddField setup={setup} onEdit={edit} />
          <PartsRow parts={parts} selected={selected} onSelect={select} />
        </div>
      )}

      <PresetPicker
        open={picker}
        current={state.preset}
        onPick={(preset) => {
          dispatch({ type: "load", preset });
          closePicker();
        }}
        onClose={closePicker}
      />
    </div>
  );
}
