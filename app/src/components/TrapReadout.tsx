"use client";

import { useEffect, useState } from "react";
import { chooseBackend, createEngine, isSuperseded, EngineError, type EngineStatus } from "@/engine/client";
import { DEFAULT_SETUP } from "@/engine/defaults";
import type { BeamField, Mode, Result } from "@/engine/types";
import { si, siParts } from "@/lib/format";
import styles from "./TrapReadout.module.css";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const LOCAL_API = process.env.NEXT_PUBLIC_LOCAL_API;

type Outcome = { kind: "result"; result: Result } | { kind: "error"; error: EngineError | Error } | null;

export function TrapReadout() {
  const [status, setStatus] = useState<EngineStatus>({ state: "loading", stage: "Starting the engine…", fraction: 0 });
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [backend, setBackend] = useState<"pyodide" | "local" | null>(null);

  useEffect(() => {
    const choice = chooseBackend(window.location.search, window.location.origin, BASE_PATH, LOCAL_API);
    const engine = createEngine(choice);
    const off = engine.subscribe((s) => {
      setStatus(s);
      setBackend(choice.kind);
    });
    engine
      .solve(DEFAULT_SETUP)
      .then((result) => setOutcome({ kind: "result", result }))
      .catch((error) => {
        if (!isSuperseded(error)) setOutcome({ kind: "error", error });
      });
    return () => {
      off();
      engine.close();
    };
  }, []);

  const result = outcome?.kind === "result" ? outcome.result : null;
  const busy = !outcome;
  const beam = DEFAULT_SETUP.trap.fields[0] as BeamField;

  return (
    <section className={styles.card} aria-labelledby="setup-title">
      <header className={styles.head}>
        <p className={styles.eyebrow}>Default setup</p>
        <h1 id="setup-title" className={styles.title}>
          Silica nanosphere in a {Math.round(beam.wavelength * 1e9)} nm tweezer
        </h1>
        <ul className={styles.chips} aria-label="Setup">
          <Chip label="radius" value={si(DEFAULT_SETUP.particle.radius, "m")} />
          <Chip label="material" value="SiO₂" />
          <Chip label="power" value={si(beam.power, "W")} />
          <Chip label="NA" value={String("NA" in beam.focus ? beam.focus.NA : "—")} />
          <Chip label="pressure" value={`${si(DEFAULT_SETUP.environment?.pressure, "Pa")} N₂`} />
        </ul>
      </header>

      <div className={styles.strip} data-busy={busy || undefined} aria-live="polite" aria-busy={busy}>
        {(result?.modes ?? PLACEHOLDER_MODES).map((m, i) => (
          <ModeTile key={m.name ?? i} mode={m} index={i} />
        ))}
        <div className={styles.tile} data-testid="depth">
          <span className={styles.label}>depth</span>
          <span className={styles.value}>
            <span className={styles.number}>{result ? fmtKT(result.depth.kT) : "—"}</span>
            <span className={styles.unit}>k<sub>B</sub>T</span>
          </span>
          <span className={styles.sub}>{result ? `U = ${si(result.depth.J, "J")}` : " "}</span>
        </div>
      </div>

      <Verdict outcome={outcome} status={status} />

      <footer className={styles.foot}>
        <EngineLine status={status} backend={backend} result={result} />
      </footer>
    </section>
  );
}

const PLACEHOLDER_MODES: Mode[] = ["x", "y", "z"].map((name) => ({
  name,
  axis: [0, 0, 0],
  frequency: null,
  stiffness: null,
}));

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <li className={styles.chip}>
      <span className={styles.chipLabel}>{label}</span> {value}
    </li>
  );
}

function ModeTile({ mode, index }: { mode: Mode; index: number }) {
  const name = mode.name ?? String(index + 1);
  const f = siParts(mode.frequency, "Hz");
  return (
    <div className={styles.tile} data-axis={name} data-testid={`freq-${name}`}>
      <span className={styles.label}>
        f<sub>{name}</sub>
      </span>
      <span className={styles.value}>
        <span className={styles.number}>{f.value}</span>
        <span className={styles.unit}>{f.unit}</span>
      </span>
      <span className={styles.sub}>{mode.stiffness != null ? `k = ${si(mode.stiffness, "N/m")}` : " "}</span>
    </div>
  );
}

function fmtKT(kT: number) {
  return kT >= 100 ? Math.round(kT).toString() : Number(kT.toPrecision(3)).toString();
}

function Verdict({ outcome, status }: { outcome: Outcome; status: EngineStatus }) {
  if (status.state === "failed" && !outcome) {
    return (
      <p className={styles.verdict} data-tone="bad" role="alert">
        The engine did not start: {status.error}
      </p>
    );
  }
  if (!outcome) {
    const pct = status.state === "loading" ? Math.round(status.fraction * 100) : 100;
    return (
      <div className={styles.loading}>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Engine loading"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className={styles.stage}>{status.state === "loading" ? status.stage : "Computing…"}</p>
      </div>
    );
  }
  if (outcome.kind === "error") {
    return (
      <p className={styles.verdict} data-tone="bad" role="alert">
        {outcome.error.message}
      </p>
    );
  }
  const r = outcome.result;
  const z = r.equilibrium?.[2];
  return (
    <div>
      <p className={styles.verdict} data-tone={r.stable ? "ok" : "bad"} data-testid="verdict">
        <span className={styles.dot} aria-hidden="true" />
        {r.stable
          ? `Stable trap. The particle rests ${si(z ?? 0, "m")} downstream of the focus.`
          : "No stable trap."}
      </p>
      {r.warnings.map((w) => (
        <p key={w} className={styles.verdict} data-tone="warn">
          {w}
        </p>
      ))}
    </div>
  );
}

function EngineLine({
  status,
  backend,
  result,
}: {
  status: EngineStatus;
  backend: "pyodide" | "local" | null;
  result: Result | null;
}) {
  const parts: string[] = [];
  if (result?.time != null) parts.push(`computed in ${si(result.time, "s", 2)}`);
  const model = result?.models.find((m) => m.quantity === "modes")?.model;
  if (model) parts.push(model === "mie" ? "Mie (T-matrix)" : model);
  if (status.state === "ready") {
    const v = status.versions;
    if (backend === "local") parts.push("local Python engine");
    else parts.push(`levtrap ${v.levtrap} · Pyodide ${v.pyodide}`);
  }
  return <span>{parts.join(" · ") || " "}</span>;
}
