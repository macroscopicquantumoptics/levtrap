"use client";

import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeTheme } from "@/lib/theme";
import styles from "./ThemeToggle.module.css";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "light" as const);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      data-testid="theme-toggle"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
