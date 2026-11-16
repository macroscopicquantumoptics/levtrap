"use client";

import type { Part, PartId } from "./model.ts";
import { Icon } from "./ui/Icon.tsx";
import styles from "./PartsRow.module.css";

export interface PartsRowProps {
  parts: Part[];
  selected: PartId | null;
  onSelect(id: PartId | null): void;
}

/**
 * Every part as a button in one row. On a narrow screen this stands in for
 * the labels in the scene, which have no room there; on a wide one it is
 * where the environment, which is not drawn, is found.
 */
export function PartsRow({ parts, selected, onSelect }: PartsRowProps) {
  return (
    <ul className={styles.row} aria-label="Parts of the setup" data-testid="parts">
      {parts.map((part) => (
        <li key={part.id}>
          <button
            type="button"
            className={styles.chip}
            data-part={part.id}
            data-kind={part.kind}
            aria-pressed={selected === part.id}
            onClick={() => onSelect(selected === part.id ? null : part.id)}
          >
            <span className={styles.icon}>
              <Icon name={part.kind} size={14} />
            </span>
            <span className={styles.name}>{part.name}</span>
            <span className={styles.summary}>{part.summary}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
