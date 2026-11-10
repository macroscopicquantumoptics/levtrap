/** Messages between the engine client and the Pyodide worker. */

/** Must match web/worker.js (a unit test checks). */
export const PYODIDE_VERSION = "0.29.5";
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export interface Versions {
  backend: "pyodide" | "local";
  levtrap?: string;
  python?: string;
  numpy?: string;
  scipy?: string;
  pyodide?: string;
}

/** Client -> worker */
export type WorkerRequest =
  /** Absolute URL of the folder holding manifest.json and the wheel. */
  | { type: "init"; wheelBase: string }
  /** setup and want are JSON text, handed to levtrap.solve.solve_json as is. */
  | { type: "solve"; id: number; setup: string; want: string }
  /** Drop a queued solve; a solve already running finishes and is ignored. */
  | { type: "cancel"; id: number };

/** Worker -> client */
export type WorkerReply =
  | { type: "progress"; stage: string; fraction: number }
  | { type: "ready"; versions: Versions }
  | { type: "fatal"; error: string }
  /** response is the JSON text solve_json returned */
  | { type: "result"; id: number; response: string; elapsed: number }
  | { type: "cancelled"; id: number };
