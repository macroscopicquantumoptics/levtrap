"use client";

import { engineMismatch } from "../engine/build.ts";
import type { Engine, EngineStatus } from "../engine/client.ts";
import type { Pattern, Result, Setup } from "../engine/types.ts";
import { formatSI } from "../lib/format.ts";
import type { Answer } from "./answer.ts";
import type { PartId } from "./model.ts";
import { ForcesTab, HeatingTab, PotentialTab, RadiationTab, SpectrumTab, SweepTab, WavefrontTab } from "./plots/tabs.tsx";
import { DesignTab } from "./plots/DesignTab.tsx";
import { unavailableTabs } from "./plots/availability.ts";
import { ResultsStrip } from "./ResultsStrip.tsx";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
import styles from "./Dock.module.css";

export type TabId = "forces" | "potential" | "sweep" | "design" | "radiation" | "heating" | "spectrum" | "wavefront";

const TABS: { id: TabId; label: string }[] = [
  { id: "forces", label: "Forces" },
  { id: "potential", label: "Potential" },
  { id: "sweep", label: "Sweep" },
  { id: "design", label: "Design" },
  { id: "radiation", label: "Radiation" },
  { id: "heating", label: "Heating" },
  { id: "spectrum", label: "Spectrum" },
  { id: "wavefront", label: "Wavefront" },
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
  /** an edit from a tab (Design → Apply) */
  onEdit?(setup: Setup): void;
  /** the Radiation tab's pattern, once computed, for the results export (#75) */
  onPattern?(setup: Setup, pattern: Pattern): void;
}

/** The bottom of the screen: the results strip, always visible, and the plots drawer under it. */
export function Dock({ setup, answer, pending, status, tab, onTab, expanded, onToggle, onSelect, engine, recorded, onEdit, onPattern }: DockProps) {
  // tabs that cannot compute for this setup are greyed, with the reason as the tooltip (#81)
  const unavailable = unavailableTabs(setup);
  return (
    <section className={`${ui.island} ${styles.dock}`} aria-label="Results">
      <ResultsStrip setup={setup} answer={answer} pending={pending} status={status} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
      <div className={styles.bar}>
        <div className={styles.tabs} role="tablist" aria-label="Plots">
          {TABS.map((t) => {
            const why = unavailable[t.id];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                className={styles.tab}
                aria-selected={tab === t.id}
                aria-controls="drawer"
                title={why}
                data-unavailable={why ? "" : undefined}
                data-testid={`tab-${t.id}`}
                onClick={() => onTab(tab === t.id ? null : t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <StaleEngine status={status} />
        <EngineLine status={status} answer={answer} />
      </div>
      {tab && (
        <div className={styles.drawer} role="tabpanel" id="drawer" aria-labelledby={`tab-${tab}`} data-testid="drawer" data-tab={tab}>
          <div className={styles.panel} data-pending={pending || undefined}>
            <Panel tab={tab} setup={setup} result={answer.result} engine={engine} recorded={recorded} onEdit={onEdit} onPattern={onPattern} />
          </div>
          <button type="button" className={`${ui.iconButton} ${styles.close}`} aria-label="Close the plots" onClick={() => onTab(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The page and the engine it loaded come from different builds: a page from
 * before a deploy (its HTML still cached) with the engine from after it (#96).
 * A reload brings the page up to date.
 */
/** The engine build this page was built with ("" when no wheel was staged at build time). */
const APP_ENGINE_BUILD: string = process.env.NEXT_PUBLIC_ENGINE_BUILD ?? "";

function StaleEngine({ status }: { status: EngineStatus | null }) {
  const build = status?.state === "ready" ? status.versions.build : undefined;
  if (!engineMismatch(APP_ENGINE_BUILD, build)) return null;
  return (
    <p className={styles.stale} role="status" data-testid="engine-stale" title={`page built with engine ${APP_ENGINE_BUILD}, engine loaded ${build}`}>
      levtrap was updated.
      <button type="button" className={`${ui.button} ${styles.reload}`} data-testid="engine-reload" onClick={() => window.location.reload()}>
        Reload
      </button>
    </p>
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

function Panel({
  tab,
  setup,
  result,
  engine,
  recorded,
  onEdit,
  onPattern,
}: {
  tab: TabId;
  setup: Setup;
  result: Result | null;
  engine: (() => Engine) | null;
  recorded: boolean;
  onEdit?(setup: Setup): void;
  onPattern?(setup: Setup, pattern: Pattern): void;
}) {
  if (tab === "forces") return <ForcesTab setup={setup} engine={engine} recorded={recorded} />;
  if (tab === "potential") return <PotentialTab setup={setup} engine={engine} recorded={recorded} />;
  if (tab === "sweep") return <SweepTab setup={setup} engine={engine} recorded={recorded} />;
  if (tab === "design") return <DesignTab setup={setup} result={result} engine={engine} onEdit={onEdit} />;
  if (tab === "radiation") return <RadiationTab setup={setup} engine={engine} recorded={recorded} onPattern={onPattern} />;
  if (tab === "spectrum") return <SpectrumTab setup={setup} result={result} />;
  if (tab === "wavefront") return <WavefrontTab setup={setup} engine={engine} recorded={recorded} />;
  return <HeatingTab setup={setup} result={result} />;
}
