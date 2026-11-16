"use client";

import { useEffect, useRef } from "react";
import { issueUrl } from "./answer.ts";
import { PRESETS, type Preset } from "./presets.ts";
import { RECORDED } from "./recorded.ts";
import { Scene } from "./Scene.tsx";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
import styles from "./PresetPicker.module.css";

export interface PresetPickerProps {
  open: boolean;
  /** the preset the screen holds now */
  current: Preset;
  onPick(preset: Preset): void;
  onClose(): void;
}

const NO_INSET = { top: 6, right: 6, bottom: 6, left: 6 };
const nothing = () => {};

/** Start from a trap, never from an empty form: one card per trap type. */
export function PresetPicker({ open, current, onPick, onClose }: PresetPickerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`${ui.island} ${styles.dialog}`}
      aria-labelledby="presets-title"
      data-testid="presets"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // a click on the backdrop
      }}
    >
      {open && (
        <div className={styles.body}>
          <header className={styles.head}>
            <div>
              <h2 id="presets-title" className={styles.title} tabIndex={-1} autoFocus>
                Start from a trap
              </h2>
              <p className={styles.lead}>Pick the one closest to yours. Everything can be changed afterwards.</p>
            </div>
            <button type="button" className={ui.iconButton} aria-label="Close" onClick={onClose} data-testid="presets-close">
              <Icon name="close" />
            </button>
          </header>
          <ul className={styles.cards}>
            {PRESETS.map((preset) => (
              <li key={preset.id}>
                <button type="button" className={styles.card} data-testid={`preset-${preset.id}`} aria-current={preset.id === current.id || undefined} onClick={() => onPick(preset)}>
                  <span className={styles.picture} aria-hidden="true">
                    <Scene setup={preset.setup} result={RECORDED[preset.id] ?? null} selected={null} onSelect={nothing} inset={NO_INSET} labels={false} grid={false} thumbnail />
                  </span>
                  <span className={styles.text}>
                    <span className={styles.name}>
                      {preset.name}
                      {preset.id === current.id && <span className={ui.tag}>open now</span>}
                    </span>
                    <span className={styles.blurb}>{preset.blurb}</span>
                    <span className={styles.source}>
                      {preset.source}
                      {preset.pending ? " · not computed yet" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {PRESETS.some((p) => p.pending) && (
            <p className={styles.foot}>
              A trap marked “not computed yet” is drawn and can be edited; its numbers arrive with the engine (
              {PRESETS.filter((p) => p.pending).map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <a href={issueUrl(p.pending!)} target="_blank" rel="noreferrer">
                    issue #{p.pending}
                  </a>
                </span>
              ))}
              ).
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}
