/** Which engine to talk to, from the page's query string. */

export const DEFAULT_LOCAL_API = "http://127.0.0.1:8000/api";

export type Backend = { kind: "pyodide" } | { kind: "local"; api: string };

/**
 * `?backend=local` uses `scripts/devserver.py` at its default address;
 * `&api=http://host:port/api` points it elsewhere. Anything else uses Pyodide.
 */
export function backendFromSearch(search: string): Backend {
  const q = new URLSearchParams(search);
  if (q.get("backend") === "local") return { kind: "local", api: q.get("api") || DEFAULT_LOCAL_API };
  return { kind: "pyodide" };
}

/** Absolute URL of the folder holding the wheel, under the app's base path. */
export function wheelBase(origin: string, basePath: string): string {
  return new URL(`${basePath.replace(/\/+$/, "")}/wheels/`, origin).href;
}
