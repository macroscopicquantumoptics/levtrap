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
  /** drawn to scale (the toggle in the scene's corner) */
  toScale: boolean;
  /** the particle moves as the trap's modes oscillate (the Play button) */
  motion: boolean;
  /** the radiation pattern as a surface about the particle */
  pattern: boolean;
  /** the light's intensity on the lab plane through the trap that faces the camera */
  slice: boolean;
  /** rays traced through a real lens (an asphere) */
  rays: boolean;
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
                title="Radiation pattern"
                note="Where the particle scatters the light, as a surface about it"
                checked={show.pattern}
                onSelect={() => onShow({ ...show, pattern: !show.pattern })}
                testId="show-pattern"
              />
              <MenuItem
                title="To scale"
                note="The particle at its true size, the ideal lens left out"
                checked={show.toScale}
                onSelect={() => onShow({ ...show, toScale: !show.toScale })}
                testId="show-to-scale"
              />
              <MenuItem
                title="Intensity slice"
                note="The light on the plane through the trap that faces you"
                checked={show.slice}
                onSelect={() => onShow({ ...show, slice: !show.slice })}
                testId="show-slice"
              />
              <MenuItem
                title="Traced rays"
                note="Through a real lens (Lens → Asphere)"
                checked={show.rays}
                onSelect={() => onShow({ ...show, rays: !show.rays })}
                testId="show-rays"
              />
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

/**
 * The conventions a result depends on but no input shows (#71): beam frames,
 * the phase reference, the power of a coherent group, the NA ↔ waist mapping
 * (#64), the trapping lens (#97), and what the depth and the reheating rate
 * include. Folded, so the help stays three lines until asked. The physics is
 * in src/levtrap/optics.py (frames, phase, power), api._beam_angle (mapping),
 * solve.trap_lens (trapping lens), solver.py (depth) and rates.py (reheating).
 */
function Conventions() {
  return (
    <details className={styles.conventions} data-testid="help-conventions">
      <summary className={styles.helpTitle}>Conventions</summary>
      <dl className={styles.conventionList}>
        <dt>Frames</dt>
        <dd>
          In the lab, z is the first beam&apos;s axis and y is up. Each beam is set in its own frame: it travels along its own z and its
          polarisation lies in its own x–y plane. A beam against the first is turned by 180° about x, so its y is the lab&apos;s −y and Circular
          + on it turns the other way in the lab. Circular − on it turns the same way as Circular + on the first beam: Add field → Counter-propagating
          beam picks that sign.
        </dd>
        <dt>Phase</dt>
        <dd>
          A beam&apos;s phase φ multiplies its field by e<sup>iφ</sup> at its own focus, in its own frame. It matters only between beams that
          interfere. Two opposing beams focused at one point, polarised alike in the lab and in phase, have an antinode there.
        </dd>
        <dt>Power</dt>
        <dd>
          Beams that do not interfere each keep their power, and their forces add. Beams that interfere form one field whose power is the sum of
          their powers: interference changes the power of the sum, so the field is rescaled to it. Opposing beams whose cones do not overlap (NA
          below n/√2) keep their own powers. A beam of a coherent group shows the group&apos;s total power: a new total scales every beam of
          the group and keeps their split.
        </dd>
        <dt>NA and waist</dt>
        <dd>
          Two descriptions of one focus, through its half-angle θ (NA = n sin θ). Gaussian (OTT), the default, takes tan θ = λ w<sub>p</sub> / (π n
          w₀), as OTT and the papers built on it do. Gaussian (sine) takes sin θ = λ w<sub>p</sub> / (π n w₀): at a small NA the textbook waist λ /
          (π NA), and a tighter focus. w<sub>p</sub> is 1 for a Gaussian and grows with a mode&apos;s order.
        </dd>
        <dt>Trapping lens</dt>
        <dd>
          The lens the first beam goes through. Beams going the same way as the first (the same direction, not merely the same axis) go through
          it too, so its NA is the largest of theirs, at most n. The Radiation tab and the information sweep use this NA.
        </dd>
        <dt>Depth</dt>
        <dd>
          The lowest energy barrier from the trap along the three axes of its modes, of the summed force of every field: the beams, the Paul
          trap&apos;s pseudopotential and gravity. Escape routes off those three lines are not searched.
        </dd>
        <dt>Reheating</dt>
        <dd>
          Per mode, in phonons per second: gas heating, γ k<sub>B</sub>T / (ħΩ), plus photon recoil. The recoil is the backaction of the
          position information the scattered light carries: how much its far field changes when the sphere moves, from the field at the
          trap (Mie theory). It splits into the scattered photons (their Mie pattern), the photons taken out of the beam (the field&apos;s
          gradient at the sphere: less than a plane wave&apos;s along a focused beam) and their cross term, the interference of the two kicks.
          It holds for any beams, standing waves and dark foci included. Laser noise, the recoil of absorbed photons and the heating of
          the sphere by the light it absorbs are not included; when the sphere absorbs more than a tenth of what it scatters, the recoil
          is marked approximate.
        </dd>
      </dl>
    </details>
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
          <Conventions />
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
            <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer" data-testid="help-docs">
              Docs
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
