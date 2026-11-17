"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { EngineStatus } from "../engine/client.ts";
import type { Result, Setup } from "../engine/types.ts";
import { formatMass, formatNumber, formatSci, formatSI, siParts } from "../lib/format.ts";
import { toFieldText } from "../lib/units.ts";
import { issueUrl, shownFrequency, verdict, type Answer } from "./answer.ts";
import { explainDepth, explainFrequency, type Explanation } from "./explain.ts";
import { useDismiss } from "./hooks.ts";
import { environmentOf, partsOf, subscript, type PartId } from "./model.ts";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
import styles from "./ResultsStrip.module.css";

export interface ResultsStripProps {
  setup: Setup;
  answer: Answer;
  /** the answer shown belongs to an earlier setup */
  pending: boolean;
  status: EngineStatus | null;
  expanded: boolean;
  onToggle(): void;
  onSelect(id: PartId): void;
}

const AXES = ["x", "y", "z"];

/** The answer, always on screen: three frequencies, the depth, and the verdict as a sentence. */
export function ResultsStrip({ setup, answer, pending, status, expanded, onToggle, onSelect }: ResultsStripProps) {
  const { result, notice } = answer;
  const v = verdict(answer, setup);
  const [open, setOpen] = useState<string | null>(null);
  const names = result?.modes.length === 3 ? result.modes.map((m) => m.name) : AXES;
  const loading = pending && status?.state === "loading";

  return (
    <div className={styles.strip} data-pending={pending || undefined} aria-busy={pending} data-testid="results">
      <div className={styles.numbers}>
        {names.map((name, i) => {
          const mode = result?.modes[i];
          const f = siParts(result && mode ? shownFrequency(result, mode) : null, "Hz");
          return (
            <Figure
              key={name}
              id={`freq-${name}`}
              label={
                <>
                  <span className={styles.key} data-axis={name} aria-hidden="true" />
                  <i>f</i>
                  <sub>{name}</sub>
                </>
              }
              value={f.value}
              unit={f.unit}
              open={open === name}
              onOpen={(o) => setOpen(o ? name : null)}
              explain={result && mode && f.value !== "—" ? () => explainFrequency(result, setup, i) : null}
            />
          );
        })}
        <Figure
          id="depth"
          label="Depth"
          value={result && result.stable ? formatNumber(result.depth.kT, 3) : "—"}
          unit={
            <>
              k<sub>B</sub>T
            </>
          }
          open={open === "depth"}
          onOpen={(o) => setOpen(o ? "depth" : null)}
          explain={result && result.stable ? () => explainDepth(result, setup) : null}
        />
      </div>

      <div className={styles.verdict} data-tone={v.tone} data-testid="verdict" role="status">
        <span className={styles.mark} aria-hidden="true" />
        <p className={styles.sentences}>
          <span className={styles.headline}>{v.text}</span>
          {notice?.kind === "pending" && notice.ticket && (
            <>
              {" "}
              <a className={styles.link} href={issueUrl(notice.ticket)} target="_blank" rel="noreferrer">
                Issue #{notice.ticket}
              </a>
            </>
          )}
          {notice?.kind === "invalid" && notice.part && (
            <>
              {" "}
              <button type="button" className={styles.link} onClick={() => onSelect(notice.part!)}>
                Show the {partsOf(setup).find((p) => p.id === notice.part)?.name.toLowerCase()}
              </button>
            </>
          )}
          {v.more.map((sentence) => (
            <span key={sentence} className={styles.more}>
              {" "}
              {sentence}
            </span>
          ))}
        </p>
      </div>

      <div className={styles.side}>
        {pending && (
          <span className={styles.busy} data-testid="busy">
            <span className={styles.spinner} aria-hidden="true" />
            {loading ? `Starting the engine ${Math.round((status.fraction ?? 0) * 100)}%` : "Computing"}
          </span>
        )}
        <button
          type="button"
          className={ui.button}
          aria-expanded={expanded}
          aria-controls="more-numbers"
          data-testid="more"
          onClick={onToggle}
          disabled={!result}
        >
          More
          <span className={styles.caret} data-open={expanded || undefined}>
            <Icon name="chevron" />
          </span>
        </button>
      </div>

      {expanded && result && (
        <dl className={styles.secondary} id="more-numbers" data-testid="more-numbers">
          {secondary(result, setup).map(([label, value]) => (
            <div key={label} className={styles.pair}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The numbers behind the headline ones, straight from the Result. */
function secondary(result: Result, setup: Setup): [string, string][] {
  const out: [string, string][] = [];
  const triple = (values: (number | null | undefined)[], unit: string) => values.map((v) => formatSI(v, unit)).join(" · ");
  if (result.equilibrium) out.push(["Position (x, y, z)", result.equilibrium.map((c) => (Math.abs(c) < 1e-15 ? "0" : formatSI(c, "m"))).join(" · ")]);
  if (result.modes.length) out.push(["Stiffness (x, y, z)", triple(result.modes.map((m) => m.stiffness), "N/m")]);
  out.push(["Mass", formatMass(result.particle.mass)]);
  if (result.paul) {
    out.push(["Mathieu q (x, y, z)", [result.paul.q.x, result.paul.q.y, result.paul.q.z].map((q) => formatNumber(q, 3)).join(" · ")]);
    out.push(["Mathieu a (x, y, z)", [result.paul.a.x, result.paul.a.y, result.paul.a.z].map((a) => formatSci(a, 3)).join(" · ")]);
    if (result.paul.micromotion) out.push(["Micromotion amplitude", formatSI(Math.hypot(...result.paul.micromotion), "m")]);
  }
  if (result.optical) out.push(["Scattered power", formatSI(result.optical.P_sca, "W")]);
  if (result.rates) {
    const env = environmentOf(setup);
    out.push([`Gas damping γ/2π in ${subscript(env.gas)}`, formatSI(result.rates.gas_damping / (2 * Math.PI), "Hz")]);
    out.push(["Reheating in phonons/s (x, y, z)", result.rates.reheating_phonons_per_s.map((r) => formatSci(r, 3)).join(" · ")]);
    const crossover = result.rates.modes.map((m) => m.crossover_pressure);
    if (crossover.every((p) => p != null)) {
      out.push(["Recoil exceeds gas heating below (x, y, z)", `${crossover.map((p) => toFieldText(p!, "pressure", "mbar", 2)).join(" · ")} mbar`]);
    }
  }
  return out;
}

interface FigureProps {
  id: string;
  label: ReactNode;
  value: string;
  unit: ReactNode;
  open: boolean;
  onOpen(open: boolean): void;
  /** null: nothing to explain (no value) */
  explain: (() => Explanation) | null;
}

/** One headline number. Click it for the formula, the inputs and the model. */
function Figure({ id, label, value, unit, open, onOpen, explain }: FigureProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const close = useCallback(() => onOpen(false), [onOpen]);
  useDismiss(node, open, close);
  return (
    <div className={styles.cell} ref={setNode}>
      <button
        type="button"
        className={styles.number}
        data-testid={id}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!explain}
        onClick={() => onOpen(!open)}
        title={explain ? "How this number is computed" : undefined}
      >
        <span className={styles.label}>{label}</span>{" "}
        <span className={styles.value}>
          <span className={styles.figure} data-empty={value === "—" || undefined}>
            {value}
          </span>{" "}
          <span className={styles.unit}>{unit}</span>
        </span>
      </button>
      {open && explain && <Explain explanation={explain()} onClose={close} />}
    </div>
  );
}

function Explain({ explanation: e, onClose }: { explanation: Explanation; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`${ui.island} ${styles.explain}`} role="dialog" aria-label={e.title} data-testid="explain">
      <header className={styles.explainHead}>
        <div>
          <p className={styles.explainTitle}>{e.title}</p>
          <p className={styles.explainValue}>{e.value}</p>
        </div>
        <button
          type="button"
          className={ui.button}
          onClick={() => {
            void navigator.clipboard?.writeText(e.copy).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          <Icon name={copied ? "check" : "copy"} />
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className={ui.iconButton} aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <p className={styles.formula}>{e.formula}</p>
      <dl className={styles.inputs}>
        {e.inputs.map((input) => (
          <div key={input.symbol} className={styles.input}>
            <dt>{input.symbol}</dt>
            <dd>
              <span className={styles.inputValue}>{input.value}</span>
              <span className={styles.inputNote}>{input.note}</span>
            </dd>
          </div>
        ))}
      </dl>
      {e.model && (
        <p className={styles.model}>
          <span className={styles.modelName}>{e.model.name}.</span> {e.model.validity}
          {e.model.notes.length > 0 ? `: ${e.model.notes.join("; ")}.` : "."}
        </p>
      )}
    </div>
  );
}
