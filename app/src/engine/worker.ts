/**
 * Web Worker: loads Pyodide, NumPy, SciPy and the levtrap wheel, then runs
 * `levtrap.solve.solve_json` so the UI thread never blocks.
 *
 * Solves run one at a time in arrival order. A solve cancelled while still
 * queued is dropped; Python cannot be interrupted mid-solve without
 * cross-origin isolation, which GitHub Pages does not offer, so a running
 * solve finishes and the client ignores its answer.
 */
import { PYODIDE_URL, PYODIDE_VERSION, type Versions, type WorkerReply, type WorkerRequest } from "./protocol.ts";

interface PyProxyFn {
  (...args: string[]): string;
}
interface Pyodide {
  loadPackage(names: string[]): Promise<void>;
  pyimport(name: string): { install(url: string, opts: { deps: boolean }): Promise<void> };
  runPython(code: string): unknown;
  globals: { get(name: string): PyProxyFn };
}

const ctx = self as unknown as {
  postMessage(msg: WorkerReply): void;
  addEventListener(type: "message", fn: (ev: MessageEvent<WorkerRequest>) => void): void;
};

const post = (msg: WorkerReply) => ctx.postMessage(msg);
const progress = (stage: string, fraction: number) => post({ type: "progress", stage, fraction });

let solveJson: PyProxyFn | null = null;
const queue: { id: number; setup: string; want: string }[] = [];
const cancelled = new Set<number>();
let pumping = false;

async function init(wheelBase: string): Promise<void> {
  progress("Loading Python (Pyodide)", 0.05);
  const { loadPyodide } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${PYODIDE_URL}pyodide.mjs`)) as {
    loadPyodide(opts: { indexURL: string }): Promise<Pyodide>;
  };
  const py = await loadPyodide({ indexURL: PYODIDE_URL });
  progress("Loading NumPy", 0.35);
  await py.loadPackage(["numpy"]);
  progress("Loading SciPy", 0.55);
  await py.loadPackage(["scipy", "micropip"]);
  progress("Installing levtrap", 0.85);
  const manifest = (await (await fetch(new URL("manifest.json", wheelBase), { cache: "no-cache" })).json()) as {
    wheel: string;
  };
  await py.pyimport("micropip").install(new URL(manifest.wheel, wheelBase).href, { deps: false });
  py.runPython("from levtrap.solve import solve_json");
  solveJson = py.globals.get("solve_json");
  const versions = JSON.parse(
    py.runPython(
      "import json, sys, numpy, scipy, levtrap; json.dumps(dict(python=sys.version.split()[0], " +
        "numpy=numpy.__version__, scipy=scipy.__version__, levtrap=levtrap.__version__))",
    ) as string,
  ) as Versions;
  progress("Ready", 1);
  post({ type: "ready", versions: { ...versions, backend: "pyodide", pyodide: PYODIDE_VERSION } });
}

async function pump(): Promise<void> {
  if (pumping || !solveJson) return;
  pumping = true;
  try {
    while (queue.length) {
      // let cancel messages that arrived during the last solve land first
      await new Promise((r) => setTimeout(r, 0));
      const job = queue.shift();
      if (!job) break;
      if (cancelled.delete(job.id)) {
        post({ type: "cancelled", id: job.id });
        continue;
      }
      const t0 = performance.now();
      const response = solveJson(job.setup, job.want);
      post({ type: "result", id: job.id, response, elapsed: (performance.now() - t0) / 1000 });
    }
  } finally {
    pumping = false;
  }
}

ctx.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    init(msg.wheelBase)
      .then(pump)
      .catch((err: unknown) => post({ type: "fatal", error: err instanceof Error ? err.message : String(err) }));
  } else if (msg.type === "solve") {
    queue.push(msg);
    void pump();
  } else if (msg.type === "cancel") {
    if (queue.some((j) => j.id === msg.id)) cancelled.add(msg.id);
  }
});
