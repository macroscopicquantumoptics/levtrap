"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useDismiss } from "../hooks.ts";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./ui.module.css";

export interface MenuProps {
  /** the button that opens the menu; gets `aria-expanded` and the click handler */
  button(props: { "aria-expanded": boolean; "aria-haspopup": "menu"; onClick(): void }): ReactNode;
  side?: "below" | "above";
  align?: "start" | "center" | "end";
  label: string;
  /** render the items; call `close` after an action */
  children(close: () => void): ReactNode;
}

/** A button with a popover list. Esc or a press outside closes it. */
export function Menu({ button, side = "below", align = "start", label, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(node, open, close);
  return (
    <span className={styles.anchor} ref={setNode}>
      {button({ "aria-expanded": open, "aria-haspopup": "menu", onClick: () => setOpen((o) => !o) })}
      {open && (
        <div className={`${styles.island} ${styles.menu}`} role="menu" aria-label={label} data-side={side} data-align={align}>
          {children(close)}
        </div>
      )}
    </span>
  );
}

export interface MenuItemProps {
  icon?: IconName;
  title: string;
  note?: string;
  /** a short mark at the right, e.g. the ticket that will build it */
  tag?: string;
  disabled?: boolean;
  checked?: boolean;
  onSelect?(): void;
  testId?: string;
}

export function MenuItem({ icon, title, note, tag, disabled, checked, onSelect, testId }: MenuItemProps) {
  return (
    <button
      type="button"
      className={styles.menuItem}
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      onClick={() => {
        if (!disabled) onSelect?.();
      }}
    >
      <span className={styles.menuIcon}>{checked !== undefined ? checked && <Icon name="check" /> : icon && <Icon name={icon} />}</span>
      <span className={styles.menuText}>
        <span className={styles.menuTitle}>{title}</span>
        {note && <span className={styles.menuNote}>{note}</span>}
      </span>
      {tag && <span className={styles.tag}>{tag}</span>}
    </button>
  );
}

export function MenuRule() {
  return <div className={styles.menuRule} role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className={styles.menuHeading}>{children}</div>;
}
