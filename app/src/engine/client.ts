/**
 * The engine client: `solve(setup, want)` over a transport (the Pyodide
 * worker, or `scripts/devserver.py` with `?backend=local`).
 *
 * A new solve supersedes the one before it: the older promise rejects with
 * an `AbortError` and its request is cancelled, so the screen only ever
 * shows the answer to the latest setup.
 */
import type { Versions } from "./protocol.ts";
import type { Result, Setup, SolveResponse, Want } from "./types.ts";

export type EngineStatus =
  | { state: "loading"; stage: string; fraction: number }
  | { state: "ready"; versions: Versions }
  | { state: "failed"; error: string };

/** How the client reaches an engine. */
export interface Transport {
  /** Start loading; report status changes through `onStatus`. */
  start(onStatus: (status: EngineStatus) => void): void;
  /** Send one solve; `setup` and `want` are JSON text. Rejects with an AbortError when `signal` aborts. */
  request(setup: string, want: string, signal: AbortSignal): Promise<SolveResponse>;
  dispose(): void;
}

/** A solve the engine refused: an invalid setup (with the offending key path), an unsupported one, or a crash. */
export class EngineError extends Error {
  readonly kind: "setup" | "unsupported" | "internal";
  readonly path?: string;
  constructor(kind: EngineError["kind"], message: string, path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "EngineError";
    this.kind = kind;
    this.path = path;
  }
}

export function abortError(message = "superseded by a newer solve"): DOMException {
  return new DOMException(message, "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export interface SolveOptions {
  /** Abort this solve. */
  signal?: AbortSignal;
  /**
   * Requests with the same key supersede each other (default "solve").
   * Use different keys for independent requests, e.g. headline numbers and a plot.
   */
  key?: string;
}

export interface Engine {
  solve(setup: Setup, want?: readonly Want[], opts?: SolveOptions): Promise<Result>;
  readonly status: EngineStatus;
  /** Calls `listener` on every status change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createEngine(transport: Transport): Engine {
  let status: EngineStatus = { state: "loading", stage: "Starting", fraction: 0 };
  const listeners = new Set<() => void>();
  const inflight = new Map<string, AbortController>();

  transport.start((s) => {
    status = s;
    for (const l of listeners) l();
  });

  return {
    get status() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async solve(setup, want = [], opts = {}) {
      const key = opts.key ?? "solve";
      inflight.get(key)?.abort(abortError());
      const ctrl = new AbortController();
      inflight.set(key, ctrl);
      const onAbort = () => ctrl.abort(opts.signal?.reason ?? abortError("aborted"));
      if (opts.signal?.aborted) onAbort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        if (ctrl.signal.aborted) throw ctrl.signal.reason;
        const res = await transport.request(JSON.stringify(setup), JSON.stringify(want), ctrl.signal);
        if (ctrl.signal.aborted) throw ctrl.signal.reason;
        if (!res.ok) throw new EngineError(res.kind, res.error, res.kind === "setup" ? res.path : undefined);
        return res.result;
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
        if (inflight.get(key) === ctrl) inflight.delete(key);
      }
    },
    dispose() {
      for (const c of inflight.values()) c.abort(abortError("engine disposed"));
      inflight.clear();
      listeners.clear();
      transport.dispose();
    },
  };
}
