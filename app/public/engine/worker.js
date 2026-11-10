/* levtrap engine worker: Pyodide + NumPy/SciPy + the levtrap wheel.
 *
 * Protocol (postMessage), typed on the page side in src/engine/client.ts:
 *   in : {id, method, args: [...strings]}      -- call levtrap.api.handle
 *        {type: "cancel", id}                  -- drop a queued call
 *   out: {id, ok, result | error}              -- replies
 *        {type: "progress", stage, fraction}   -- while loading
 *        {type: "ready", versions}             -- once loaded
 *        {type: "fatal", error}                -- the runtime failed to load
 *
 * Calls run one at a time. A call cancelled before it starts is skipped; one
 * already running finishes and its reply is ignored by the client.
 */
/* global importScripts, loadPyodide */
"use strict";

// Keep in step with web/worker.js until web/ is retired.
const PYODIDE_VERSION = "0.29.5";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const WHEELS = new URL("../wheels/", self.location.href);

let handle = null;
const queue = [];
let draining = false;

function progress(stage, fraction) {
  self.postMessage({ type: "progress", stage, fraction });
}

async function init() {
  progress("Loading the Python runtime…", 0.05);
  importScripts(PYODIDE_URL + "pyodide.js");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  progress("Loading NumPy…", 0.35);
  await pyodide.loadPackage(["numpy"]);
  progress("Loading SciPy…", 0.55);
  await pyodide.loadPackage(["scipy", "micropip"]);
  progress("Installing levtrap…", 0.85);
  const manifest = await (await fetch(new URL("manifest.json", WHEELS), { cache: "no-cache" })).json();
  const micropip = pyodide.pyimport("micropip");
  await micropip.install(new URL(manifest.wheel, WHEELS).href, { deps: false });
  pyodide.runPython("import levtrap.api as _api");
  handle = pyodide.globals.get("_api").handle;
  const versions = JSON.parse(
    pyodide.runPython(
      "import json, sys, numpy, scipy, levtrap; json.dumps(dict(python=sys.version.split()[0], numpy=numpy.__version__, scipy=scipy.__version__, levtrap=levtrap.__version__))",
    ),
  );
  versions.pyodide = PYODIDE_VERSION;
  progress("Ready", 1);
  self.postMessage({ type: "ready", versions });
}

const ready = init().catch((err) => {
  self.postMessage({ type: "fatal", error: String(err && err.message ? err.message : err) });
  throw err;
});

async function drain() {
  if (draining) return;
  draining = true;
  try {
    await ready;
    while (queue.length) {
      const { id, method, args } = queue.shift();
      try {
        const result = handle(method, ...(args || []));
        self.postMessage({ id, ok: true, result });
      } catch (err) {
        self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
      }
      // Yield so cancel messages that arrived during the call are seen.
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch {
    // init failed; "fatal" was already posted.
  } finally {
    draining = false;
  }
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg && msg.type === "cancel") {
    const i = queue.findIndex((q) => q.id === msg.id);
    if (i >= 0) queue.splice(i, 1);
    return;
  }
  queue.push(msg);
  drain();
};
