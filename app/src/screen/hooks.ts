"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isAbortError, type Engine, type EngineStatus } from "../engine/client.ts";
import type { Setup, Want, Vec3 } from "../engine/types.ts";
import { answerFromError, instantAnswer, NO_ANSWER, type Answer } from "./answer.ts";
import { canonical } from "./model.ts";

/** Typing pause before a changed setup is sent to the engine. */
const DEBOUNCE_MS = 150;
const SERVER_STATUS: EngineStatus = { state: "loading", stage: "Starting", fraction: 0 };
const NO_ENGINE: Answer = {
  result: null,
  origin: null,
  notice: { kind: "pending", text: "This preview has no engine: only the presets show numbers." },
};
const noop = () => {};
const subscribeNever = () => noop;

export interface Solving {
  /** What to show now. While a new answer is computed this is still the previous one. */
  answer: Answer;
  /** The shown answer belongs to an earlier setup: dim it. */
  pending: boolean;
  /** Engine load state; null when the page has no engine. */
  status: EngineStatus | null;
}

/**
 * The answer for a setup: at once for a preset, from the engine otherwise.
 * The engine starts loading on mount, so it is ready by the first edit.
 * `want` asks for extra blocks (a plot's data); with `enabled` false nothing
 * is asked and the answer stays empty. Requests for different `want`s (or a
 * different `channel`) run side by side; a newer one supersedes only its own kind.
 */
export function useAnswer(
  setup: Setup,
  engine: (() => Engine) | null,
  recorded = true,
  want: readonly Want[] = [],
  enabled = true,
  channel?: string,
  /** m, lab: follow the equilibrium from here (continuation); a recorded preset answer is not used then */
  start?: Vec3 | null,
): Solving {
  const wanted = want.join(",");
  const from = start ? start.join(",") : "";
  const key = useMemo(() => `${wanted}|${from}|${canonical(setup)}`, [setup, wanted, from]);
  const instant = useMemo(() => (from ? null : instantAnswer(setup, recorded, wanted ? (wanted.split(",") as Want[]) : [])), [setup, recorded, wanted, from]);
  const [settled, setSettled] = useState<{ key: string; answer: Answer } | null>(null);
  const [last, setLast] = useState<Answer>(NO_ANSWER);

  const subscribe = useCallback((listener: () => void) => (engine ? engine().subscribe(listener) : noop), [engine]);
  const status = useSyncExternalStore(
    subscribe,
    () => (engine ? engine().status : null),
    () => (engine ? SERVER_STATUS : null),
  );

  useEffect(() => {
    if (instant || !engine || !enabled) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      engine()
        // requests for different blocks (or channels) must not supersede each other: the headline numbers,
        // a plot's data and a comparison each have their own key
        .solve(setup, wanted ? (wanted.split(",") as Want[]) : [], {
          signal: ctrl.signal,
          key: channel ?? `solve:${wanted}`,
          start: from ? (from.split(",").map(Number) as Vec3) : null,
        })
        .then(
          (result) => setSettled({ key, answer: { result, origin: "engine", notice: null } }),
          (err: unknown) => {
            if (!isAbortError(err)) setSettled({ key, answer: answerFromError(err, setup) });
          },
        );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, setup, instant, engine, enabled, wanted, channel, from]);

  const current = !enabled ? NO_ANSWER : (instant ?? (engine ? (settled?.key === key ? settled.answer : null) : NO_ENGINE));
  // remember the latest answer, to keep showing it (dimmed) while the next one is computed
  if (current && current !== last) setLast(current);
  return { answer: current ?? last, pending: !current, status };
}

/** A CSS media query, false on the server. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True in the browser, false while prerendering: for content that needs `window`. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** The size of an element, in CSS px. [0, 0] until it is measured. */
export function useSize(): [(node: HTMLElement | null) => void, { width: number; height: number }] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, size];
}

/** Close on Escape or on a press outside `node`. */
export function useDismiss(node: HTMLElement | null, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPress = (e: PointerEvent) => {
      if (node && e.target instanceof Node && !node.contains(e.target)) close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPress, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress, true);
    };
  }, [node, open, close]);
}
