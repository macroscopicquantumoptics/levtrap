/**
 * The file menu's actions: open and save a setup file, copy a share link or
 * the Python that computes the setup, export the results and the scene.
 */
import type { Result, Setup } from "../../engine/types.ts";
import { download } from "./download.ts";
import { resultsCsv, resultsJson } from "./results.ts";
import { readSetupText, setupFileText, shareUrl } from "./setupText.ts";

/** A sentence over the screen: a confirmation goes by itself, a problem waits to be dismissed. */
export interface Notice {
  tone: "ok" | "bad";
  text: string;
  testId: string;
}

export interface FileActions {
  open(text: string, fileName: string): void;
  save(): void;
  share(): Promise<void>;
  python(): void;
  /** null when there are no results to export */
  exportCsv: (() => void) | null;
  exportJson: (() => void) | null;
  exportPng(): Promise<void>;
}

interface Context {
  setup: Setup;
  name: string;
  result: Result | null;
  open(setup: Setup): void;
  say(notice: Notice): void;
  showPython(): void;
}

/** A file name from the setup's name: "optical-tweezer-edited". */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "setup";

export function fileActions({ setup, name, result, open, say, showPython }: Context): FileActions {
  const base = `levtrap-${slug(name)}`;
  return {
    open(text, fileName) {
      const opened = readSetupText(text);
      if (opened.ok) {
        open(opened.setup);
        say({ tone: "ok", text: `Opened ${fileName}.`, testId: "file-opened" });
      } else {
        say({ tone: "bad", text: `${fileName} could not be opened: ${opened.reason}.`, testId: "file-refused" });
      }
    },
    save() {
      download(`${base}.json`, new Blob([setupFileText(setup)], { type: "application/json" }));
    },
    async share() {
      const url = shareUrl(setup, window.location.href);
      try {
        await navigator.clipboard.writeText(url);
        say({ tone: "ok", text: "A link to this setup is on the clipboard. It holds the whole setup; nothing is sent anywhere.", testId: "link-copied" });
      } catch {
        say({ tone: "bad", text: `The clipboard is not available here. The link: ${url}`, testId: "link-copied" });
      }
    },
    python: showPython,
    exportCsv: result ? () => download(`${base}-results.csv`, new Blob([resultsCsv(result)], { type: "text/csv" })) : null,
    exportJson: result ? () => download(`${base}-results.json`, new Blob([resultsJson(setup, result)], { type: "application/json" })) : null,
    async exportPng() {
      const scene = document.querySelector<HTMLElement>('[data-testid="scene"]');
      const gl = scene?.querySelector("canvas");
      if (!scene || !gl) {
        say({ tone: "bad", text: "The scene can be saved as an image only when it is drawn in 3D.", testId: "png-refused" });
        return;
      }
      // the drawing on the scene's own background (the canvas is transparent)
      const out = document.createElement("canvas");
      out.width = gl.width;
      out.height = gl.height;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(scene).backgroundColor;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(gl, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (blob) download(`${base}-scene.png`, blob);
    },
  };
}
