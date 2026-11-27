"use client";

/**
 * Design (the inverse of a sweep): type the trap you want (its frequencies,
 * its depth), tick the inputs levtrap may change, and Find searches for the
 * values that give it, one engine solve per trial (design.ts). In a trap of
 * light only a power scale is set in one step, not searched (#102). Apply
 * puts the values found into the setup: one undo step.
 */
import { useEffect, useRef, useState } from "react";
import type { Engine } from "../../engine/client.ts";
import { isAbortError } from "../../engine/client.ts";
import type { Result, Setup } from "../../engine/types.ts";
import { formatNumber, formatSI } from "../../lib/format.ts";
import { toFieldText } from "../../lib/units.ts";
import { canonical } from "../model.ts";
import { NumberField } from "../ui/fields.tsx";
import ui from "../ui/ui.module.css";
import { defaultKnobs, designKnobs, designMethod, findDesign, PENALTY, POWER_RANGE, readTarget, SCALE_STEPS, TARGETS, typicalMiss, type DesignMethod, type Found, type TargetId } from "./design.ts";
import { Note } from "./tabs.tsx";
import styles from "./tabs.module.css";

/** solves a search may take */
const BUDGET = 40;

interface Search {
  key: string;
  /** solves so far */
  done: number;
  running: boolean;
  best: Found | null;
  /** how it searches: a power scale alone is set in one step (#102) */
  method: DesignMethod;
  error?: string;
}

export function DesignTab({ setup, result, engine, onEdit }: { setup: Setup; result: Result | null; engine: (() => Engine) | null; onEdit?(setup: Setup): void }) {
  const knobs = designKnobs(setup);
  const [ticked, setTicked] = useState<string[]>(() => defaultKnobs(knobs));
  // the targets start at the trap's own numbers: change the ones you want different
  const [wanted, setWanted] = useState<Partial<Record<TargetId, number>>>({});
  const [use, setUse] = useState<Record<TargetId, boolean>>({ x: true, y: true, z: true, depth: false });
  const [search, setSearch] = useState<Search | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const setupKey = canonical(setup);

  // a search belongs to its setup: a new setup (an Apply too) stops it
  useEffect(() => () => ctrl.current?.abort(), [setupKey]);
  if (search && search.key !== setupKey && !search.running) setSearch(null);

  if (!engine) return <Note title="Design">This preview has no engine, so it cannot search.</Note>;

  const now = (id: TargetId) => readTarget(result, id);
  const target = (id: TargetId) => wanted[id] ?? now(id);
  const targets: Partial<Record<TargetId, number>> = {};
  for (const t of TARGETS) {
    const v = target(t.id);
    if (use[t.id] && v !== null && v > 0) targets[t.id] = v;
  }
  const chosen = knobs.filter((k) => ticked.includes(k.id));
  const nTargets = Object.keys(targets).length;
  const ready = nTargets > 0 && chosen.length > 0;

  const method = designMethod(chosen, setup, targets).method;

  const find = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setSearch({ key: setupKey, done: 0, running: true, best: null, method });
    try {
      await findDesign({
        setup,
        result,
        chosen,
        targets,
        budget: BUDGET,
        aborted: () => c.signal.aborted,
        solve: async (trial, start) => {
          try {
            return await engine().solve(trial, [], { signal: c.signal, start });
          } catch (err) {
            if (isAbortError(err)) throw err;
            return null;
          }
        },
        onSolve: (best, solves) => setSearch((s) => s && { ...s, done: solves, best }),
      });
    } catch (err) {
      if (!isAbortError(err)) setSearch((s) => s && { ...s, error: String(err) });
    }
    setSearch((s) => s && { ...s, running: false });
  };
  const cancel = () => {
    ctrl.current?.abort();
    setSearch((s) => s && { ...s, running: false });
  };

  const found = search?.best;
  // a power scale alone: one solve, more only if it misses
  const most = search?.method === "scale" ? SCALE_STEPS + 1 : BUDGET;
  const miss = found && found.score < PENALTY ? typicalMiss(found.score, nTargets) : null;

  return (
    <div className={styles.sweep} data-testid="design">
      <div className={styles.sweepControls}>
        <span className={styles.designGroup}>Want</span>
        {TARGETS.map((t) => {
          const v = target(t.id);
          return (
            <span key={t.id} className={styles.designTarget}>
              <input
                type="checkbox"
                aria-label={`Aim for ${t.label}`}
                checked={use[t.id]}
                onChange={(e) => setUse((u) => ({ ...u, [t.id]: e.target.checked }))}
                data-testid={`design-use-${t.id}`}
              />
              <NumberField
                key={`${t.id}-${v === null ? "none" : "some"}`}
                id={`design-${t.id}`}
                label={t.label}
                value={v ?? 0}
                quantity={t.quantity}
                unit={t.unit}
                disabled={!use[t.id]}
                check={(x) => (x > 0 ? null : "Must be greater than 0.")}
                onCommit={(x) => setWanted((w) => ({ ...w, [t.id]: x }))}
              />
            </span>
          );
        })}
      </div>
      <div className={styles.sweepControls}>
        <span className={styles.designGroup}>Vary</span>
        {knobs.map((k) => (
          <label key={k.id} className={styles.check}>
            <input
              type="checkbox"
              checked={ticked.includes(k.id)}
              onChange={(e) => setTicked((t) => (e.target.checked ? [...t, k.id] : t.filter((id) => id !== k.id)))}
              data-testid={`design-vary-${k.id}`}
            />
            {k.label}
          </label>
        ))}
        {search?.running ? (
          <button type="button" className={ui.button} onClick={cancel} data-testid="design-cancel">
            Cancel
          </button>
        ) : (
          <button type="button" className={`${ui.button} ${styles.primary}`} disabled={!ready} onClick={() => void find()} data-testid="design-find">
            Find
          </button>
        )}
        {search && (
          <span className={styles.progress} role="status" data-testid="design-progress">
            {search.running ? `Trial ${search.done} of at most ${most}` : `${search.done} ${search.done === 1 ? "trial" : "trials"}`}
            {search.method === "scale" && " · power scaled in one step"}
            {miss !== null && ` · best: within ${formatNumber(100 * miss, 2, true)} %`}
            <progress max={most} value={search.done} />
          </span>
        )}
        {found && onEdit && !search?.running && (
          <button type="button" className={`${ui.button} ${styles.primary}`} onClick={() => onEdit(found.setup)} data-testid="design-apply">
            Apply to the setup
          </button>
        )}
      </div>

      {!found ? (
        <Note title="Design">
          {search?.running
            ? "Searching: each trial is one solve of the trap."
            : search
              ? search.method === "scale"
                ? "There is no trap now, and with light only a power scale cannot make one: every force scales alike. Change another input."
                : "No trap was found in this search. Try other inputs to vary, or targets closer to the trap now."
              : "Type the trap you want and tick the inputs levtrap may change; Find searches for their values, about a second per trial in the browser. With fewer inputs than targets the best compromise is found: a tweezer's power scales every frequency, its NA the ratio along the beam to across it, and the polarisation fixes f_x : f_y. With light only, the power is not searched: f ∝ √P and depth ∝ P give it in one step."}
        </Note>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="design-table">
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">Now</th>
                <th scope="col">Wanted</th>
                <th scope="col">Found</th>
              </tr>
            </thead>
            <tbody>
              {TARGETS.filter((t) => targets[t.id] !== undefined).map((t) => {
                const show = (x: number | null) => (x === null ? "—" : t.quantity === "frequency" ? formatSI(x, "Hz", 3) : formatNumber(x, 3, true));
                return (
                  <tr key={t.id} data-target={t.id}>
                    <th scope="row">{t.label}</th>
                    <td>{show(now(t.id))}</td>
                    <td>{show(targets[t.id] ?? null)}</td>
                    <td data-value={readTarget(found.result, t.id) ?? ""}>{show(readTarget(found.result, t.id))}</td>
                  </tr>
                );
              })}
              {chosen.map((k) => (
                <tr key={k.id} data-knob={k.id}>
                  <th scope="row">{k.label}</th>
                  <td>{fieldText(k.get(setup), k.quantity, k.unit)}</td>
                  <td>—</td>
                  <td data-value={k.get(found.setup)}>{fieldText(k.get(found.setup), k.quantity, k.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {search?.method !== "search" && !search?.running && (
            <p className={styles.designNote} data-testid="design-scale-note">
              {search?.method === "scale" ? "The power was set in one step" : "The power was fitted for each trial, not searched"}: with light only, every force goes as the power, so each frequency goes as √P and
              the depth as P.
            </p>
          )}
          {found.predicted && !search?.running && (
            <p className={styles.error} data-testid="design-predicted">
              Predicted, not yet checked: the solve that checks the fitted power failed. The frequencies and depth follow from the power law; the other numbers are those of the trial before the power was fitted.
            </p>
          )}
          {found.clamped && (
            <p className={styles.error} data-testid="design-clamped">
              The power is at its {found.clamped === "high" ? `upper limit, ${formatSI(POWER_RANGE[1], "W", 3)} in all: the targets need more` : `lower limit, ${formatSI(POWER_RANGE[0], "W", 3)} in all: the targets need less`}.
            </p>
          )}
          {search?.error && <p className={styles.error}>{search.error}</p>}
        </div>
      )}
    </div>
  );
}

function fieldText(v: number, quantity: Parameters<typeof toFieldText>[1], unit: string): string {
  return `${toFieldText(v, quantity, unit, 3)}${unit ? ` ${unit}` : ""}`;
}
