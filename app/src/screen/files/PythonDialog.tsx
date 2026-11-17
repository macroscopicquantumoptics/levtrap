"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon.tsx";
import ui from "../ui/ui.module.css";
import styles from "./PythonDialog.module.css";

/** The Python that computes this setup, to read and to copy. */
export function PythonDialog({ open, code, onClose }: { open: boolean; code: string; onClose(): void }) {
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
      aria-labelledby="python-title"
      data-testid="python"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && <Body code={code} onClose={onClose} />}
    </dialog>
  );
}

/** The dialog's content: mounted while open, so "Copied" starts afresh each time. */
function Body({ code, onClose }: { code: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  return (
        <div className={styles.body}>
          <header className={styles.head}>
            <div>
              <h2 id="python-title" className={styles.title}>
                Copy as Python
              </h2>
              <p className={styles.lead}>The same numbers, computed with the levtrap package.</p>
            </div>
            <button
              type="button"
              className={ui.button}
              data-testid="python-copy"
              onClick={() => {
                void navigator.clipboard?.writeText(code).then(
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
          <pre className={styles.code} tabIndex={0} data-testid="python-code">
            {code}
          </pre>
        </div>
  );
}
