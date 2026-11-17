"use client";

import { useState, type ReactNode } from "react";
import { parseQuantity, toFieldText, unitSymbols, type Quantity } from "../../lib/units.ts";
import styles from "./ui.module.css";

export interface NumberFieldProps {
  /** also the test id: `field-${id}` */
  id: string;
  label: ReactNode;
  /** SI value */
  value: number;
  quantity: Quantity;
  /** the unit shown until another is typed or chosen */
  unit?: string;
  onCommit(value: number): void;
  /** a sentence when the value cannot be used */
  check?(value: number): string | null;
  note?: ReactNode;
  disabled?: boolean;
}

/**
 * A number with its unit. Type a value, optionally with a unit ("200 mW");
 * Enter or leaving the field applies it, Esc puts the old value back.
 */
export function NumberField({ id, label, value, quantity, unit: firstUnit = "", onCommit, check, note, disabled }: NumberFieldProps) {
  const [unit, setUnit] = useState(firstUnit);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const units = unitSymbols(quantity);
  const text = draft ?? toFieldText(value, quantity, unit);

  function commit() {
    if (draft === null) return;
    const parsed = parseQuantity(draft, quantity, unit);
    if (!parsed.ok) return setError(parsed.error);
    const problem = check?.(parsed.value) ?? null;
    if (problem) return setError(problem);
    setDraft(null);
    setError(null);
    if (parsed.unit && parsed.unit !== unit) setUnit(parsed.unit);
    if (parsed.value !== value) onCommit(parsed.value);
  }

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={`field-${id}`}>
        {label}
      </label>
      <div className={styles.control} data-invalid={error ? "" : undefined} data-disabled={disabled ? "" : undefined}>
        <input
          id={`field-${id}`}
          data-testid={`field-${id}`}
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `field-${id}-error` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape" && (draft !== null || error)) {
              e.stopPropagation();
              setDraft(null);
              setError(null);
            }
          }}
        />
        {units.length > 1 ? (
          <select
            className={styles.unit}
            aria-label={`Unit of ${typeof label === "string" ? label : id}`}
            data-testid={`unit-${id}`}
            value={unit}
            disabled={disabled}
            onChange={(e) => {
              setUnit(e.target.value);
              setDraft(null);
              setError(null);
            }}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        ) : (
          units.length === 1 && <span className={styles.unitFixed}>{units[0]}</span>
        )}
      </div>
      {error && (
        <p className={styles.fieldError} id={`field-${id}-error`} role="alert">
          {error}
        </p>
      )}
      {note && !error && <p className={styles.fieldNote}>{note}</p>}
    </div>
  );
}

export interface SelectFieldProps<T extends string> {
  id: string;
  label: ReactNode;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(value: T): void;
  note?: ReactNode;
}

export function SelectField<T extends string>({ id, label, value, options, onChange, note }: SelectFieldProps<T>) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={`field-${id}`}>
        {label}
      </label>
      <div className={styles.control}>
        <select id={`field-${id}`} data-testid={`field-${id}`} className={styles.select} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {note && <p className={styles.fieldNote}>{note}</p>}
    </div>
  );
}
