"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { Engine } from "../engine/client.ts";
import type { Pattern, Setup } from "../engine/types.ts";
import { AddField } from "./AddField.tsx";
import { Dock, type TabId } from "./Dock.tsx";
import { useAnswer, useIsClient, useMedia } from "./hooks.ts";
import { Inspector } from "./Inspector.tsx";
import { canonical, partsOf, type PartId } from "./model.ts";
import { PartsRow } from "./PartsRow.tsx";
import { PresetPicker } from "./PresetPicker.tsx";
import { DEFAULT_PRESET, presetById, presetForSetup } from "./presets.ts";
import { Scene } from "./Scene.tsx";
import { restoreSetup, saveSetup, type Restored } from "./autosave.ts";
import { fileActions, type Notice } from "./files/actions.ts";
import { ShareLink } from "./files/ShareLink.tsx";
import { PythonDialog } from "./files/PythonDialog.tsx";
import { pythonSnippet } from "./files/python.ts";
import { withPattern } from "./files/results.ts";
import { readLinkFragment } from "./files/setupText.ts";
import { initialState, reduce, type ScreenState } from "./store.ts";
import { TopBar, type ShowOptions } from "./TopBar.tsx";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
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
 * Without ?preset the last setup is reopened from autosave (autosave.ts).
 */
export function Screen({ engine }: ScreenProps) {
  const isClient = useIsClient();
  // the screen measures itself and reads the address: it renders in the browser only
  if (!isClient) return <div className={styles.screen} />;
  return <ScreenBody engine={engine} />;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked
  }
}

function readParams() {
  const q = new URLSearchParams(window.location.search);
  const store = storage();
  let welcomed = false;
  try {
    welcomed = store?.getItem(WELCOMED_KEY) === "1";
  } catch {
    // storage blocked: the picker shows on every visit
  }
  const preset = presetById(q.get("preset"));
  // a shared setup wins over a link to a preset, which wins over what was being edited
  const link = readLinkFragment(window.location.hash);
  let restored: Restored | { kind: "link-refused"; reason: string };
  if (link?.ok) restored = { kind: "restored", setup: link.setup, preset: presetForSetup(link.setup) ?? DEFAULT_PRESET };
  else if (link) restored = { kind: "link-refused", reason: link.reason };
  else restored = preset || !store ? { kind: "none" } : restoreSetup(store, DEFAULT_PRESET);
  return {
    preset,
    restored,
    fromLink: link !== null,
    recorded: q.get("recorded") !== "0",
    firstVisit: !preset && !welcomed && restored.kind === "none" && !link,
  };
}

function firstNotice(params: ReturnType<typeof readParams>): Notice | null {
  const r = params.restored;
  if (r.kind === "refused") return { tone: "bad", testId: "autosave-refused", text: `Your last setup could not be opened: ${r.reason}. Started from the ${DEFAULT_PRESET.name.toLowerCase()}.` };
  if (r.kind === "link-refused") return { tone: "bad", testId: "link-refused", text: `The shared link could not be opened: ${r.reason}. Started from the ${DEFAULT_PRESET.name.toLowerCase()}.` };
  return null;
}

function startState(params: ReturnType<typeof readParams>): ScreenState {
  if (params.restored.kind === "restored") return { ...initialState(params.restored.preset), setup: params.restored.setup };
  return initialState(params.preset ?? DEFAULT_PRESET);
}

function ScreenBody({ engine }: ScreenProps) {
  const [params] = useState(readParams);
  const [state, dispatch] = useReducer(reduce, params, startState);
  const { setup, selected } = state;
  const { answer, pending, status } = useAnswer(setup, engine, params.recorded);
  const narrow = useMedia(NARROW);
  const [show, setShow] = useState<ShowOptions>({ labels: true, grid: true, axes: false, forces: false, toScale: false, motion: false, pattern: false, slice: false, rays: false });
  // the radiation pattern about the particle: asked of the engine only while shown (its own channel: the Radiation tab asks too)
  const radiated = useAnswer(setup, engine, params.recorded, ["pattern"], show.pattern, "scene:pattern");
  const movable = Boolean(answer.result?.stable && answer.result.equilibrium && answer.result.modes.some((m) => (m.stiffness ?? 0) > 0));
  // the intensity slice asks the engine for the field, only while it is shown
  const sliced = useAnswer(setup, engine, params.recorded, ["field"], show.slice);
  // traced rays: asked of the engine only while shown, and only for a setup with a real lens
  const realLens = setup.trap.fields.some((f) => f.kind === "beam" && f.focus.kind === "asphere");
  const traced = useAnswer(setup, engine, params.recorded, ["lens"], show.rays && realLens);
  const [tab, setTab] = useState<TabId | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState(params.firstVisit);
  const [notice, setNotice] = useState<Notice | null>(() => firstNotice(params));
  const [python, setPython] = useState(false);
  // the last pattern the Radiation tab computed, with the setup it belongs to: the results export carries it (#75)
  const [radiation, setRadiation] = useState<{ key: string; pattern: Pattern } | null>(null);
  const keepPattern = useCallback((of: Setup, pattern: Pattern) => {
    const key = canonical(of);
    setRadiation((prev) => (prev && prev.key === key && prev.pattern === pattern ? prev : { key, pattern }));
  }, []);
  const setupKey = useMemo(() => canonical(setup), [setup]);
  // the pattern of this very setup, from the scene's surface or the Radiation tab, if either has computed it
  const computedPattern = (show.pattern && !radiated.pending ? radiated.answer.result?.pattern : null) ?? (radiation?.key === setupKey ? radiation.pattern : null);

  // a shared setup is in the address only to arrive: from now on autosave keeps it, and a reload does not undo edits
  useEffect(() => {
    if (params.fromLink) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [params.fromLink]);

  // a confirmation goes away by itself; a problem stays until dismissed
  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // every change is kept, so a reload opens where one left off
  useEffect(() => {
    const store = storage();
    if (store) saveSetup(store, setup, state.preset);
  }, [setup, state.preset]);

  const parts = partsOf(setup);
  const part = parts.find((p) => p.id === selected);
  const select = (id: PartId | null) => dispatch({ type: "select", id });
  const edit = (next: Setup, pick?: PartId | null) => dispatch({ type: "edit", setup: next, select: pick });
  const named = presetForSetup(setup);
  const name = named ? named.name : `${state.preset.name} · edited`;

  const files = fileActions({
    setup,
    name,
    result: withPattern(answer.result, computedPattern),
    open: (next) => edit(next, null),
    say: setNotice,
    showPython: () => setPython(true),
  });

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
        <Scene
          setup={setup}
          result={answer.result}
          selected={selected}
          onSelect={select}
          inset={inset}
          labels={show.labels && !narrow}
          grid={show.grid}
          overlays={show}
          field={show.slice ? { block: sliced.answer.result?.field ?? null, pending: sliced.pending, notice: sliced.answer.notice?.text ?? null } : null}
          rays={show.rays ? { lenses: realLens ? (traced.answer.result?.lenses ?? null) : null, realLens, pending: traced.pending } : null}
          pattern={show.pattern ? { pattern: radiated.answer.result?.pattern ?? null, pending: radiated.pending, notice: radiated.answer.notice?.text ?? null } : null}
          onScale={(toScale) => setShow((s) => ({ ...s, toScale }))}
        />
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
          files={files}
        />
        {!narrow && (
          <div className={styles.corner}>
            <PlayButton playing={show.motion} movable={movable} onPlay={(motion) => setShow((s) => ({ ...s, motion }))} />
            <AddField setup={setup} onEdit={edit} />
            <PartsRow parts={show.labels ? parts.filter((p) => p.kind === "environment") : parts} selected={selected} onSelect={select} />
          </div>
        )}
      </div>

      {notice && !notice.link && (
        <div className={styles.notice} data-tone={notice.tone} role="status" data-testid={notice.testId}>
          <p>{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <PythonDialog open={python} code={pythonSnippet(setup, name)} onClose={() => setPython(false)} />

      {part && (
        <div className={styles.inspector}>
          <Inspector
            key={part.id}
            setup={setup}
            part={part}
            result={answer.result}
            notice={answer.notice}
            onEdit={edit}
            onClose={() => select(null)}
            engine={engine}
            recorded={params.recorded}
            show={show}
            onShow={setShow}
            movable={movable}
            onTab={setTab}
          />
        </div>
      )}

      <div className={styles.dock}>
        {notice?.link && <ShareLink link={notice.link} onClose={() => setNotice(null)} />}
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
          engine={engine}
          recorded={params.recorded}
          onEdit={(next) => edit(next)}
          onPattern={keepPattern}
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

/** Play the particle's motion in the trap, with its trail (the lower left corner). */
function PlayButton({ playing, movable, onPlay }: { playing: boolean; movable: boolean; onPlay(playing: boolean): void }) {
  const label = playing ? "Pause the motion" : movable ? "Play the particle's motion in the trap" : "No motion to play: there is no stable trap";
  return (
    <div className={`${ui.island} ${styles.play}`}>
      <button
        type="button"
        className={ui.iconButton}
        aria-label={label}
        title={label}
        aria-pressed={playing}
        disabled={!movable && !playing}
        data-testid="play-motion"
        onClick={() => onPlay(!playing)}
      >
        <Icon name={playing ? "pause" : "play"} />
      </button>
    </div>
  );
}
