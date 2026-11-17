"use client";

import type { Engine, EngineStatus } from "../engine/client.ts";
import type { Result, Setup } from "../engine/types.ts";
import { formatSI } from "../lib/format.ts";
import type { Answer } from "./answer.ts";
import type { PartId } from "./model.ts";
import { ForcesTab, HeatingTab, PotentialTab, RadiationTab, SweepTab } from "./plots/tabs.tsx";
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
  /** the engine, for the plots' own data */
  engine: (() => Engine) | null;
  recorded: boolean;
}

/** The bottom of the screen: the results strip, always visible, and the plots drawer under it. */
export function Dock({ setup, answer, pending, status, tab, onTab, expanded, onToggle, onSelect, engine, recorded }: DockProps) {
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
            <Panel tab={tab} setup={setup} result={answer.result} engine={engine} recorded={recorded} />
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

function Panel({ tab, setup, result, engine, recorded }: { tab: TabId; setup: Setup; result: Result | null; engine: (() => Engine) | null; recorded: boolean }) {
  if (tab === "forces") return <ForcesTab setup={setup} engine={engine} recorded={recorded} />;
  if (tab === "potential") return <PotentialTab setup={setup} engine={engine} recorded={recorded} />;
  if (tab === "sweep") return <SweepTab setup={setup} engine={engine} recorded={recorded} />;
  if (tab === "radiation") return <RadiationTab setup={setup} engine={engine} recorded={recorded} />;
  return <HeatingTab setup={setup} result={result} />;
}
