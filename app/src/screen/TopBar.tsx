"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { EngineStatus } from "../engine/client.ts";
import { currentTheme, setTheme, subscribeTheme } from "../lib/theme.ts";
import { issueUrl } from "./answer.ts";
import type { FileActions } from "./files/actions.ts";
import { useDismiss } from "./hooks.ts";
import { Icon } from "./ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem, MenuRule } from "./ui/Menu.tsx";
import ui from "./ui/ui.module.css";
import styles from "./TopBar.module.css";

const REPO = "https://github.com/macroscopicquantumoptics/levtrap";

export interface ShowOptions {
  labels: boolean;
  grid: boolean;
  /** the 3D scene's overlays */
  axes: boolean;
  forces: boolean;
  trueSize: boolean;
}

export interface TopBarProps {
  /** the setup's name: its preset, with "edited" once it differs */
  name: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  show: ShowOptions;
  onShow(show: ShowOptions): void;
  onPresets(): void;
  status: EngineStatus | null;
  files: FileActions;
}

/** The islands along the top: file menu and name, undo · show · redo, help and theme. */
export function TopBar({ name, canUndo, canRedo, onUndo, onRedo, show, onShow, onPresets, status, files }: TopBarProps) {
  const picker = useRef<HTMLInputElement>(null);
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "light" as const);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <header className={styles.bar}>
      <div className={`${ui.island} ${styles.island}`}>
        <Menu
          label="File"
          button={(p) => (
            <button type="button" className={ui.iconButton} aria-label="File menu" data-testid="file-menu" {...p}>
              <Icon name="menu" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon="plus"
                title="Start from a preset"
                note="One per trap type"
                testId="open-presets"
                onSelect={() => {
                  close();
                  onPresets();
                }}
              />
              <MenuRule />
              <MenuHeading>Setup</MenuHeading>
              <MenuItem
                title="Open a setup file"
                note=".json, as saved here or written for levtrap.solve"
                testId="file-open"
                onSelect={() => {
                  close();
                  picker.current?.click();
                }}
              />
              <MenuItem
                title="Save the setup"
                note="A .json file to open here or in Python"
                testId="file-save"
                onSelect={() => {
                  close();
                  files.save();
                }}
              />
              <MenuItem
                title="Copy a share link"
                note="The whole setup in the link; no server"
                testId="file-share"
                onSelect={() => {
                  close();
                  void files.share();
                }}
              />
              <MenuItem
                title="Copy as Python"
                note="The code that computes these numbers"
                testId="file-python"
                onSelect={() => {
                  close();
                  files.python();
                }}
              />
              <MenuRule />
              <MenuHeading>Export</MenuHeading>
              <MenuItem
                title="Results as CSV"
                note="Every number, in SI units, with its model"
                testId="file-results-csv"
                disabled={!files.exportCsv}
                onSelect={() => {
                  close();
                  files.exportCsv?.();
                }}
              />
              <MenuItem
                title="Results as JSON"
                note="The setup and the engine's whole result"
                testId="file-results-json"
                disabled={!files.exportJson}
                onSelect={() => {
                  close();
                  files.exportJson?.();
                }}
              />
              <MenuItem
                title="The scene as PNG"
                note="The drawing as it is on screen"
                testId="file-scene-png"
                onSelect={() => {
                  close();
                  void files.exportPng();
                }}
              />
              <MenuRule />
              <a className={ui.menuItem} role="menuitem" href="../">
                <span className={ui.menuIcon} />
                <span className={ui.menuText}>
                  <span className={ui.menuTitle}>Go to the current site</span>
                  <span className={ui.menuNote}>The version this one replaces</span>
                </span>
              </a>
            </>
          )}
        </Menu>
        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void file.text().then((text) => files.open(text, file.name));
          }}
        />
        <h1 className={styles.wordmark}>
          lev<span>trap</span>
        </h1>
        <span className={styles.name} data-testid="setup-name">
          {name}
        </span>
      </div>

      <div className={`${ui.island} ${styles.island}`} role="group" aria-label="History and view">
        <button type="button" className={ui.iconButton} aria-label="Undo" title="Undo (Ctrl Z)" disabled={!canUndo} onClick={onUndo} data-testid="undo">
          <Icon name="undo" />
        </button>
        <Menu
          label="Show"
          align="center"
          button={(p) => (
            <button type="button" className={ui.button} data-testid="show-menu" {...p}>
              <Icon name="eye" />
              <span className={styles.showText}>Show</span>
            </button>
          )}
        >
          {() => (
            <>
              <MenuItem title="Labels" note="Name every part beside it" checked={show.labels} onSelect={() => onShow({ ...show, labels: !show.labels })} testId="show-labels" />
              <MenuItem title="Grid" checked={show.grid} onSelect={() => onShow({ ...show, grid: !show.grid })} testId="show-grid" />
              <MenuRule />
              <MenuHeading>In the 3D scene</MenuHeading>
              <MenuItem title="Trap axes" note="The eigen-axes through the equilibrium" checked={show.axes} onSelect={() => onShow({ ...show, axes: !show.axes })} testId="show-axes" />
              <MenuItem
                title="Force arrows"
                note="Each field's force on the particle, log length"
                checked={show.forces}
                onSelect={() => onShow({ ...show, forces: !show.forces })}
                testId="show-forces"
              />
              <MenuItem
                title="True particle size"
                note="Do not enlarge a particle too small to see"
                checked={show.trueSize}
                onSelect={() => onShow({ ...show, trueSize: !show.trueSize })}
                testId="show-true-size"
              />
              <MenuItem title="Intensity slice" tag="later" disabled />
            </>
          )}
        </Menu>
        <button type="button" className={ui.iconButton} aria-label="Redo" title="Redo (Ctrl Shift Z)" disabled={!canRedo} onClick={onRedo} data-testid="redo">
          <Icon name="redo" />
        </button>
      </div>

      <div className={`${ui.island} ${styles.island}`}>
        <Help status={status} />
        <button type="button" className={ui.iconButton} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} data-testid="theme-toggle" onClick={() => setTheme(next)}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

/** How the screen works in three lines, and what levtrap is. No separate help page. */
function Help({ status }: { status: EngineStatus | null }) {
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(node, open, close);
  const v = status?.state === "ready" ? status.versions : null;
  return (
    <span className={ui.anchor} ref={setNode}>
      <button type="button" className={ui.iconButton} aria-label="Help" aria-expanded={open} aria-haspopup="dialog" data-testid="help" onClick={() => setOpen((o) => !o)}>
        <Icon name="help" />
      </button>
      {open && (
        <div className={`${ui.island} ${styles.help}`} role="dialog" aria-label="Help">
          <p className={styles.helpTitle}>How it works</p>
          <ol className={styles.steps}>
            <li>Click a thing in the drawing to change it.</li>
            <li>Read the answer at the bottom. It follows every change.</li>
            <li>Click a number to see how it is computed.</li>
          </ol>
          <p className={styles.keys}>
            <kbd>Ctrl</kbd> <kbd>Z</kbd> undoes · <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> redoes · <kbd>Esc</kbd> deselects
          </p>
          <p className={styles.helpTitle}>About</p>
          <p className={styles.about}>
            levtrap computes the forces on a levitated sphere in optical and Paul traps. The optical part is a port of the{" "}
            <a href="https://github.com/ilent2/ott" target="_blank" rel="noreferrer">
              Optical Tweezers Toolbox v1
            </a>{" "}
            © The University of Queensland, licensed CC BY-NC 4.0: non-commercial use only.
          </p>
          <p className={styles.about}>
            <a href={REPO} target="_blank" rel="noreferrer">
              Source
            </a>{" "}
            ·{" "}
            <a href={issueUrl(6)} target="_blank" rel="noreferrer">
              Roadmap
            </a>
            {v && (
              <span className={styles.versions}>
                {" "}
                · {v.backend === "local" ? "local Python engine" : `levtrap ${v.levtrap}, Pyodide ${v.pyodide}`}
              </span>
            )}
          </p>
        </div>
      )}
    </span>
  );
}
