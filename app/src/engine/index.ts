/**
 * The engine for this page, created on first use in the browser.
 *
 *   const result = await getEngine().solve(DEFAULT_SETUP);
 */
import { backendFromSearch, wheelBase } from "./backend.ts";
import { createEngine, type Engine } from "./client.ts";
import { localTransport, workerTransport } from "./transports.ts";

export { DEFAULT_SETUP } from "./setup.ts";
export { EngineError, isAbortError, type Engine, type EngineStatus } from "./client.ts";
export type * from "./types.ts";

let engine: Engine | null = null;

export function getEngine(): Engine {
  if (engine) return engine;
  const backend = backendFromSearch(window.location.search);
  engine = createEngine(
    backend.kind === "local"
      ? localTransport(backend.api)
      : workerTransport(
          () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "levtrap-engine" }),
          wheelBase(window.location.origin, process.env.NEXT_PUBLIC_BASE_PATH ?? ""),
        ),
  );
  return engine;
}
