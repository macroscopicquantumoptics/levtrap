/* Web Worker: loads Pyodide + NumPy/SciPy + the levtrap wheel and runs
 * levtrap.api calls so the UI thread never blocks.
 *
 * Protocol (postMessage):
 *   in : {id, method, args: [...strings]}
 *   out: {id, ok, result | error}            -- replies
 *        {type: "progress", stage, fraction}  -- while loading
 *        {type: "ready", versions}            -- once loaded
 */
/* global importScripts, loadPyodide */
const PYODIDE_VERSION = "0.29.5";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodide = null;
let handle = null;

function progress(stage, fraction) {
  self.postMessage({ type: "progress", stage, fraction });
}

async function init() {
  progress("Loading Python runtime (Pyodide)…", 0.05);
  importScripts(PYODIDE_URL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  progress("Loading NumPy…", 0.35);
  await pyodide.loadPackage(["numpy"]);
  progress("Loading SciPy…", 0.55);
  await pyodide.loadPackage(["scipy", "micropip"]);
  progress("Installing levtrap…", 0.85);
  const manifest = await (await fetch("wheels/manifest.json", { cache: "no-cache" })).json();
  const wheelUrl = new URL("wheels/" + manifest.wheel, self.location.href).href;
  const micropip = pyodide.pyimport("micropip");
  await micropip.install(wheelUrl, { deps: false });
  pyodide.runPython("import levtrap.api as _api");
  handle = pyodide.globals.get("_api").handle;
  const versions = JSON.parse(
    pyodide.runPython(
      "import json, sys, numpy, scipy, levtrap; json.dumps(dict(python=sys.version.split()[0], numpy=numpy.__version__, scipy=scipy.__version__, levtrap=levtrap.__version__))"
    )
  );
  versions.pyodide = PYODIDE_VERSION;
  progress("Ready", 1.0);
  self.postMessage({ type: "ready", versions });
}

const ready = init().catch((err) => {
  self.postMessage({ type: "fatal", error: String(err && err.message ? err.message : err) });
  throw err;
});

self.onmessage = async (ev) => {
  const { id, method, args } = ev.data;
  try {
    await ready;
    const t0 = performance.now();
    const out = handle(method, ...(args || []));
    self.postMessage({ id, ok: true, result: out, elapsed: (performance.now() - t0) / 1000 });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
