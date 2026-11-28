"use client";

import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import type { EngineStatus } from "../engine/client.ts";
import type { Setup } from "../engine/types.ts";
import { formatNumber, formatSI, siParts } from "../lib/format.ts";
import { firstSentence, issueUrl, shownFrequency, verdict, type Answer, type Verdict as VerdictText } from "./answer.ts";
import { explainDepth, explainFrequency, secondaryNumbers, type Explanation } from "./explain.ts";
import { useDismiss } from "./hooks.ts";
import { partsOf, type PartId } from "./model.ts";
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

// KaTeX comes with the first explanation opened, not with the page
const Explain = lazy(() => import("./Explain.tsx"));

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
          also={result && result.stable ? formatSI(result.depth.K, "K") : undefined}
          open={open === "depth"}
          onOpen={(o) => setOpen(o ? "depth" : null)}
          explain={result && result.stable ? () => explainDepth(result, setup) : null}
        />
      </div>

      <Verdict
        v={v}
        link={
          notice?.kind === "pending" && notice.ticket ? (
            <a className={styles.link} href={issueUrl(notice.ticket)} target="_blank" rel="noreferrer">
              Issue #{notice.ticket}
            </a>
          ) : notice?.kind === "invalid" && notice.part ? (
            <button type="button" className={styles.link} onClick={() => onSelect(notice.part!)}>
              Show the {partsOf(setup).find((p) => p.id === notice.part)?.name.toLowerCase()}
            </button>
          ) : null
        }
      />

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
          {secondaryNumbers(result, setup).map((row) => (
            <Pair key={row.id} id={row.id} label={row.label} value={row.value} explain={row.explain} open={open === row.id} onOpen={(o) => setOpen(o ? row.id : null)} />
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The verdict as sentences: the headline, the cause and what to change (the
 * hint), a link (the ticket, or the part to fix), and the other notes. On a
 * phone only the first sentence shows; "Details" unfolds the rest (#109: the
 * spiral verdict took 300 px, 39 %, of a 320 × 760 phone; folded, 95 px). A verdict with a link keeps
 * it in sight, unfolded.
 */
function Verdict({ v, link }: { v: VerdictText; link: ReactNode }) {
  const [unfolded, setUnfolded] = useState(false);
  const [first, after] = firstSentence(v.text);
  const rest = (
    <>
      {after && (
        <span className={styles.headline}>
          {" "}
          {after}
        </span>
      )}
      {v.hint && (
        <span className={styles.hint} data-testid="verdict-hint">
          {" "}
          {v.hint}
        </span>
      )}
      {link && <> {link}</>}
      {v.more.map((sentence) => (
        <span key={sentence} className={styles.more}>
          {" "}
          {sentence}
        </span>
      ))}
    </>
  );
  const folds = !link && Boolean(after || v.hint || v.more.length);
  return (
    <div className={styles.verdict} data-tone={v.tone} data-unfolded={unfolded || undefined} data-testid="verdict" role="status">
      <span className={styles.mark} aria-hidden="true" />
      <p className={styles.sentences}>
        <span className={styles.headline}>{first}</span>
        {folds ? (
          <>
            <span className={styles.rest} id="verdict-rest" data-testid="verdict-rest">
              {rest}
            </span>{" "}
            <button type="button" className={styles.details} aria-expanded={unfolded} aria-controls="verdict-rest" data-testid="verdict-details" onClick={() => setUnfolded((u) => !u)}>
              {unfolded ? "Less" : "Details"}
            </button>
          </>
        ) : (
          rest
        )}
      </p>
    </div>
  );
}

interface FigureProps {
  id: string;
  label: ReactNode;
  value: string;
  unit: ReactNode;
  /** the same value in another unit, shown small beside it */
  also?: string;
  open: boolean;
  onOpen(open: boolean): void;
  /** null: nothing to explain (no value) */
  explain: (() => Explanation) | null;
}

/** One headline number. Click it for the formula, the inputs and the model. */
function Figure({ id, label, value, unit, also, open, onOpen, explain }: FigureProps) {
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
          {also && (
            <span className={styles.also} data-testid={`${id}-also`}>
              {also}
            </span>
          )}
        </span>
      </button>
      {open && explain && <Popover explain={explain} anchor={node} onClose={close} />}
    </div>
  );
}

/** The explanation, beside its number (the anchor); place.ts says where it opens. */
function Popover({ explain, anchor, onClose }: { explain: () => Explanation; anchor: HTMLElement | null; onClose(): void }) {
  return (
    <Suspense fallback={null}>
      <Explain explanation={explain()} anchor={anchor} onClose={onClose} />
    </Suspense>
  );
}

interface PairProps {
  id: string;
  label: string;
  value: string;
  explain(): Explanation;
  open: boolean;
  onOpen(open: boolean): void;
}

/** One number of the second row; it too explains itself. */
function Pair({ id, label, value, explain, open, onOpen }: PairProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const close = useCallback(() => onOpen(false), [onOpen]);
  useDismiss(node, open, close);
  return (
    <div className={styles.pair} ref={setNode}>
      <dt>{label}</dt>
      <dd>
        <button
          type="button"
          className={styles.pairValue}
          data-testid={`more-${id}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="How this number is computed"
          onClick={() => onOpen(!open)}
        >
          {value}
        </button>
      </dd>
      {open && <Popover explain={explain} anchor={node} onClose={close} />}
    </div>
  );
}

