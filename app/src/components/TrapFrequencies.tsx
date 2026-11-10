"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_SETUP, getEngine, isAbortError, type EngineStatus, type Result } from "@/engine";
import { formatFrequency } from "@/lib/format";
import styles from "./TrapFrequencies.module.css";

const SERVER_STATUS: EngineStatus = { state: "loading", stage: "Starting", fraction: 0 };
const subscribe = (l: () => void) => getEngine().subscribe(l);
const getStatus = () => getEngine().status;
const getServerStatus = () => SERVER_STATUS;

/** The default tweezer's three trap frequencies. */
export function TrapFrequencies() {
  const status = useSyncExternalStore(subscribe, getStatus, getServerStatus);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEngine()
      .solve(DEFAULT_SETUP)
      .then(setResult, (err: unknown) => {
        if (!isAbortError(err)) setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const busy = !result && !error;
  return (
    <section className={styles.panel} aria-labelledby="freq-title" aria-busy={busy}>
      <h2 id="freq-title" className={styles.title}>
        Trap frequencies
      </h2>
      <p className={styles.setup}>100 nm silica sphere · 1064 nm, 0.2 W · NA 0.8 · 10⁻⁴ Pa</p>

      <div className={styles.tiles}>
        {(["x", "y", "z"] as const).map((axis, i) => (
          <div key={axis} className={styles.tile} data-testid={`freq-${axis}`}>
            <span className={styles.label}>
              f<sub>{axis}</sub>
            </span>
            <span className={styles.value} data-ready={result ? "" : undefined}>
              {result ? formatFrequency(result.modes[i]?.frequency) : "—"}
            </span>
          </div>
        ))}
      </div>

      <p className={styles.status} role="status" data-testid="engine-status">
        {error ? (
          <span className={styles.error}>{error}</span>
        ) : result ? (
          <>
            <span className={result.stable ? styles.ok : styles.warn}>●</span>{" "}
            {result.stable ? `stable · depth ${result.depth.kT.toFixed(0)} kT` : (result.warnings[0] ?? "not stable")}
          </>
        ) : status.state === "loading" ? (
          <>
            {status.stage}…
            <progress className={styles.progress} value={status.fraction} max={1} />
          </>
        ) : status.state === "failed" ? (
          <span className={styles.error}>Engine failed to load: {status.error}</span>
        ) : (
          "Computing…"
        )}
      </p>
    </section>
  );
}
