"use client";

import { useRef, useState } from "react";
import { Icon } from "../ui/Icon.tsx";
import ui from "../ui/ui.module.css";
import styles from "./ShareLink.module.css";

/**
 * The share link when the clipboard refused it (an embedded browser pane, an
 * iframe without the permission): the link in a read-only field, selected on
 * focus, with a Copy button (#74). The link is 600 to 900 characters with no
 * place to break, so it lives in a field that scrolls inside itself rather
 * than in a sentence that would widen the screen. It is not a problem, so it
 * is drawn in a neutral tone; it waits until dismissed, since copying it
 * takes a moment.
 */
export function ShareLink({ link, onClose }: { link: string; onClose(): void }) {
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "by-hand">("no");
  const copy = async () => {
    const input = field.current;
    if (!input) return;
    input.focus();
    input.select();
    // copying the selection works where the clipboard API is refused; it has to happen within the click
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        await navigator.clipboard.writeText(link);
        ok = true;
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? "yes" : "by-hand");
  };
  return (
    <div className={`${ui.island} ${styles.share}`} role="status" data-testid="link-shown">
      <div className={styles.head}>
        <p className={styles.text}>The clipboard is not available here, so here is the link to this setup. It holds the whole setup; nothing is sent anywhere.</p>
        <button type="button" className={ui.iconButton} onClick={onClose} aria-label="Dismiss">
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.row}>
        <input
          ref={field}
          className={styles.field}
          type="text"
          readOnly
          value={link}
          aria-label="Link to this setup"
          spellCheck={false}
          data-testid="link-field"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className={ui.button} data-testid="link-copy" onClick={() => void copy()}>
          <Icon name={copied === "yes" ? "check" : "copy"} />
          {copied === "yes" ? "Copied" : "Copy"}
        </button>
      </div>
      {copied === "by-hand" && (
        <p className={styles.hint} data-testid="link-by-hand">
          The link is selected: copy it with Ctrl C (⌘ C on a Mac).
        </p>
      )}
    </div>
  );
}
