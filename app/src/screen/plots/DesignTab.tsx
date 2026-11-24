"use client";

/**
 * Design (the inverse of a sweep): type the trap you want (its frequencies,
 * its depth), tick the inputs levtrap may change, and Find searches for the
 * values that give it, one engine solve per trial (design.ts). Apply puts the
 * values found into the setup: one undo step.
 */
import { useEffect, useRef, useState } from "react";
import type { Engine } from "../../engine/client.ts";
import { isAbortError } from "../../engine/client.ts";
import type { Result, Setup, Vec3 } from "../../engine/types.ts";
import { formatNumber, formatSI } from "../../lib/format.ts";
import { toFieldText } from "../../lib/units.ts";
import { canonical } from "../model.ts";
import { NumberField } from "../ui/fields.tsx";
import ui from "../ui/ui.module.css";
import { defaultKnobs, designKnobs, mismatch, nelderMead, PENALTY, readTarget, scaleFor, TARGETS, typicalMiss, type TargetId } from "./design.ts";
import { Note } from "./tabs.tsx";
import styles from "./tabs.module.css";

/** solves a search may take */
const BUDGET = 40;

interface Search {
  key: string;
  /** solves so far */
  done: number;
  running: boolean;
  best: { setup: Setup; result: Result; score: number } | null;
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

  const find = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const scales = chosen.map((k) => scaleFor(k, setup));
    const build = (u: number[]) => chosen.reduce((s, k, i) => k.set(s, scales[i].back(u[i])), setup);
    let start: Vec3 | null = result?.stable && result.equilibrium ? result.equilibrium : null;
    let best: Search["best"] = null;
    setSearch({ key: setupKey, done: 0, running: true, best: null });
    try {
      await nelderMead(
        async (u) => {
          const trial = build(u);
          let r: Result | null = null;
          try {
            // continuation: from the best trap so far, so the search follows one trap
            r = await engine().solve(trial, [], { signal: c.signal, start });
          } catch (err) {
            if (isAbortError(err)) throw err;
          }
          const score = mismatch(r, targets);
          if (r && score < (best?.score ?? Infinity)) {
            best = { setup: trial, result: r, score };
            if (r.stable && r.equilibrium) start = r.equilibrium;
          }
          setSearch((s) => s && { ...s, done: s.done + 1, best });
          return score;
        },
        chosen.map((k, i) => scales[i].forward(k.get(setup))),
        { budget: BUDGET, aborted: () => c.signal.aborted },
      );
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
            {search.running ? `Trial ${search.done} of at most ${BUDGET}` : `${search.done} trials`}
            {miss !== null && ` · best: within ${formatNumber(100 * miss, 2, true)} %`}
            <progress max={BUDGET} value={search.done} />
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
              ? "No trap was found in this search. Try other inputs to vary, or targets closer to the trap now."
              : "Type the trap you want and tick the inputs levtrap may change; Find searches for their values, about a second per trial in the browser. With fewer inputs than targets the best compromise is found: a tweezer's power scales every frequency, its NA the ratio along the beam to across it, and the polarisation fixes f_x : f_y."}
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
                    <td>{show(readTarget(found.result, t.id))}</td>
                  </tr>
                );
              })}
              {chosen.map((k) => (
                <tr key={k.id} data-knob={k.id}>
                  <th scope="row">{k.label}</th>
                  <td>{fieldText(k.get(setup), k.quantity, k.unit)}</td>
                  <td>—</td>
                  <td>{fieldText(k.get(found.setup), k.quantity, k.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {search?.error && <p className={styles.error}>{search.error}</p>}
        </div>
      )}
    </div>
  );
}

function fieldText(v: number, quantity: Parameters<typeof toFieldText>[1], unit: string): string {
  return `${toFieldText(v, quantity, unit, 3)}${unit ? ` ${unit}` : ""}`;
}
