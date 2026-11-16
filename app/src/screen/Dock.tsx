"use client";

import type { ReactNode } from "react";
import type { EngineStatus } from "../engine/client.ts";
import type { Result, Setup } from "../engine/types.ts";
import { formatNumber, formatSci, formatSI } from "../lib/format.ts";
import { toFieldText } from "../lib/units.ts";
import { issueUrl, type Answer } from "./answer.ts";
import { ForcePlot } from "./ForcePlot.tsx";
import { environmentOf, pressureText, subscript, type PartId } from "./model.ts";
import { ResultsStrip } from "./ResultsStrip.tsx";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
import styles from "./Dock.module.css";

export type TabId = "forces" | "potential" | "sweep" | "radiation" | "heating";

const TABS: { id: TabId; label: string }[] = [
  { id: "forces", label: "Forces" },
  { id: "potential", label: "Potential" },
  { id: "sweep", label: "Sweep" },
  { id: "radiation", label: "Radiation" },
  { id: "heating", label: "Heating" },
];

export interface DockProps {
  setup: Setup;
  answer: Answer;
  pending: boolean;
  status: EngineStatus | null;
  tab: TabId | null;
  onTab(tab: TabId | null): void;
  expanded: boolean;
  onToggle(): void;
  onSelect(id: PartId): void;
}

/** The bottom of the screen: the results strip, always visible, and the plots drawer under it. */
export function Dock({ setup, answer, pending, status, tab, onTab, expanded, onToggle, onSelect }: DockProps) {
  return (
    <section className={`${ui.island} ${styles.dock}`} aria-label="Results">
      <ResultsStrip setup={setup} answer={answer} pending={pending} status={status} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
      <div className={styles.bar}>
        <div className={styles.tabs} role="tablist" aria-label="Plots">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              className={styles.tab}
              aria-selected={tab === t.id}
              aria-controls="drawer"
              data-testid={`tab-${t.id}`}
              onClick={() => onTab(tab === t.id ? null : t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <EngineLine status={status} answer={answer} />
      </div>
      {tab && (
        <div className={styles.drawer} role="tabpanel" id="drawer" aria-labelledby={`tab-${tab}`} data-testid="drawer" data-tab={tab}>
          <div className={styles.panel} data-pending={pending || undefined}>
            <Panel tab={tab} setup={setup} result={answer.result} />
          </div>
          <button type="button" className={`${ui.iconButton} ${styles.close}`} aria-label="Close the plots" onClick={() => onTab(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </section>
  );
}

/** Where the numbers on screen came from, and the state of the engine. */
function EngineLine({ status, answer }: { status: EngineStatus | null; answer: Answer }) {
  let text: string;
  let tone: "plain" | "bad" = "plain";
  let title: string | undefined;
  if (!status) {
    text = "No engine in this preview";
  } else if (status.state === "failed") {
    text = `The engine did not start: ${status.error}`;
    tone = "bad";
  } else if (status.state === "loading") {
    text = `Engine starting: ${status.stage.toLowerCase()} ${Math.round(status.fraction * 100)}%`;
  } else {
    const v = status.versions;
    title = v.backend === "local" ? "Local Python engine" : `levtrap ${v.levtrap} · Pyodide ${v.pyodide} · Python ${v.python}`;
    if (answer.origin === "preset") text = "Recorded from the engine for this preset";
    else if (answer.origin === "engine" && answer.result) text = `Computed in ${formatSI(answer.result.time, "s", 2, true)}`;
    else text = "Engine ready";
  }
  return (
    <p className={styles.engine} data-tone={tone} data-state={status?.state ?? "none"} data-testid="engine-status" title={title}>
      {text}
    </p>
  );
}

function Panel({ tab, setup, result }: { tab: TabId; setup: Setup; result: Result | null }) {
  if (tab === "forces") {
    return result ? <ForcePlot result={result} /> : <Later title="Forces">The forces appear here once the trap is computed.</Later>;
  }
  if (tab === "heating") return <Heating setup={setup} result={result} />;
  if (tab === "potential") {
    return (
      <Later title="Potential" ticket={21}>
        The potential along each axis in units of k<sub>B</sub>T, with the harmonic fit drawn over it so that anharmonicity shows.
      </Later>
    );
  }
  if (tab === "sweep") {
    return (
      <Later title="Sweep" ticket={21}>
        Any input on the horizontal axis, any headline number on the vertical one, with the unstable regions shaded.
      </Later>
    );
  }
  return (
    <Later title="Radiation" ticket={21}>
      Where the scattered light goes, and how much of it a collection lens catches.
    </Later>
  );
}

/** A tab that is designed but not built yet says what it will show. */
function Later({ title, ticket, children }: { title: string; ticket?: number; children: ReactNode }) {
  return (
    <div className={styles.later}>
      <p className={styles.laterTitle}>{title}</p>
      <p className={styles.laterText}>{children}</p>
      {ticket && (
        <p className={styles.laterNote}>
          Not built yet:{" "}
          <a href={issueUrl(ticket)} target="_blank" rel="noreferrer">
            issue #{ticket}
          </a>
          .
        </p>
      )}
    </div>
  );
}

/** The Heating tab: the rates the engine already returns, as a table. The plot against pressure is D5. */
function Heating({ setup, result }: { setup: Setup; result: Result | null }) {
  const rates = result?.rates;
  if (!rates) {
    return (
      <Later title="Heating">
        {result ? "Heating rates are computed for traps with a beam. This trap has no light." : "The heating rates appear here once the trap is computed."}
      </Later>
    );
  }
  const env = environmentOf(setup);
  return (
    <div className={styles.heating} data-testid="heating">
      <p className={styles.heatingTitle}>
        Heating rates in phonons per second, at {pressureText(env.pressure)} of {subscript(env.gas)} and {formatNumber(env.temperature, 3, true)} K
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Axis</th>
              <th scope="col">Gas collisions</th>
              <th scope="col">Photon recoil</th>
              <th scope="col">Total</th>
              <th scope="col">Oscillations before one phonon</th>
              <th scope="col">Recoil exceeds gas below</th>
            </tr>
          </thead>
          <tbody>
            {rates.modes.map((m) => (
              <tr key={m.name}>
                <th scope="row">
                  <span className={styles.key} data-axis={m.name} aria-hidden="true" /> {m.name}
                </th>
                <td>{formatSci(m.gas_heating)}</td>
                <td>{formatSci(m.recoil_heating)}</td>
                <td>{formatSci(m.reheating)}</td>
                <td>{formatSci(m.coherent_oscillations)}</td>
                <td>{m.crossover_pressure == null ? "—" : `${toFieldText(m.crossover_pressure, "pressure", "mbar", 2)} mbar`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.laterNote}>
        The rates against pressure, as a plot:{" "}
        <a href={issueUrl(21)} target="_blank" rel="noreferrer">
          issue #21
        </a>
        .
      </p>
    </div>
  );
}
