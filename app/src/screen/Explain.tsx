"use client";

/**
 * The explanation of one number: its value, the formula typeset (KaTeX),
 * the values that went in, and the model with its validity. Loaded on the
 * first click, so KaTeX is not in the first page load.
 */
import "katex/dist/katex.min.css";
import katex from "katex";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { Explanation } from "./explain.ts";
import { FORMULAS, type Formula } from "./formulas.ts";
import { placePopover } from "./place.ts";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
import styles from "./ResultsStrip.module.css";

/** TeX, typeset. A formula that fails shows its TeX in red (formulas.test.ts keeps that from happening). */
function Tex({ tex, display = false, label }: { tex: string; display?: boolean; label?: string }) {
  const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, displayMode: display, output: "htmlAndMathml" }), [tex, display]);
  return <span className={display ? styles.tex : undefined} aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />;
}

export interface ExplainProps {
  explanation: Explanation;
  /** the number it explains: it opens beside it */
  anchor: HTMLElement | null;
  onClose(): void;
}

/** Phones show the explanation as a sheet along the window's bottom (CSS), not beside its number. */
const SHEET = "(max-width: 520px)";

interface Placed {
  style: CSSProperties;
  side: "up" | "down";
}

/**
 * Where the explanation goes: beside its number, on the side with room for
 * it, and no taller than that room (#109). Placed before it is painted, and
 * again when the window is resized or anything scrolls.
 */
function usePlacement(anchor: HTMLElement | null): [RefObject<HTMLDivElement | null>, Placed | undefined] {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | undefined>();
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el || !anchor || window.matchMedia(SHEET).matches) return setPlaced(undefined);
      // the height with no cap: the content's, which scrolls inside the box, plus the border
      const natural = el.scrollHeight + el.offsetHeight - el.clientHeight;
      const p = placePopover(anchor.getBoundingClientRect(), el.offsetWidth, natural, { width: window.innerWidth, height: window.innerHeight });
      setPlaced({ style: { left: p.left, top: p.top ?? "auto", bottom: p.bottom ?? "auto", maxHeight: p.maxHeight }, side: p.side });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  return [ref, placed];
}

export default function Explain({ explanation: e, anchor, onClose }: ExplainProps) {
  const [copied, setCopied] = useState(false);
  const formula: Formula = FORMULAS[e.formula];
  const [ref, placed] = usePlacement(anchor);
  return (
    <div
      ref={ref}
      className={`${ui.island} ${styles.explain}`}
      style={placed?.style}
      data-side={placed?.side}
      role="dialog"
      aria-label={e.title}
      data-testid="explain"
    >
      <header className={styles.explainHead}>
        <div>
          <p className={styles.explainTitle}>{e.title}</p>
          <p className={styles.explainValue}>{e.value}</p>
        </div>
        <button
          type="button"
          className={ui.button}
          title="Copy the value in SI units"
          data-testid="copy-value"
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
      <div className={styles.formula} data-testid="formula" data-formula={e.formula}>
        <Tex tex={formula.tex} display label={formula.text} />
        {formula.source && <p className={styles.source}>{formula.source}</p>}
      </div>
      <dl className={styles.inputs}>
        {e.inputs.map((input) => (
          <div key={input.symbol} className={styles.input}>
            <dt>
              <Tex tex={input.symbol} />
            </dt>
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
