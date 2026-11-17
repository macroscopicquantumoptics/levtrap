"use client";

/**
 * The explanation of one number: its value, the formula typeset (KaTeX),
 * the values that went in, and the model with its validity. Loaded on the
 * first click, so KaTeX is not in the first page load.
 */
import "katex/dist/katex.min.css";
import katex from "katex";
import { useMemo, useState } from "react";
import type { Explanation } from "./explain.ts";
import { FORMULAS, type Formula } from "./formulas.ts";
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
  onClose(): void;
}

export default function Explain({ explanation: e, onClose }: ExplainProps) {
  const [copied, setCopied] = useState(false);
  const formula: Formula = FORMULAS[e.formula];
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
