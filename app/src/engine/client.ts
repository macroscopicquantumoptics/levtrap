// Engine client: Setup in, Result out, over a transport (the Pyodide worker in
// the browser, or HTTP to scripts/devserver.py with ?backend=local).
//
// A new solve() on a channel supersedes the previous one on that channel: the
// older promise rejects with SupersededError and its work is dropped if it has
// not started yet. The UI never sees a stale result arrive after a fresh one.

import type { Result, Setup, SolveReply, Want } from "./types.ts";

export type EngineStatus =
  | { state: "loading"; stage: string; fraction: number }
  | { state: "ready"; versions: Record<string, string> }
  | { state: "failed"; error: string };

export interface Transport {
  /** Call an api.handle method; resolves with its raw return value. Must
   * reject with `signal.reason` once the signal aborts. */
  call(method: string, args: string[], signal: AbortSignal): Promise<unknown>;
  /** Status updates while the runtime loads; called at least once. */
  subscribe(listener: (s: EngineStatus) => void): () => void;
  close(): void;
}

export class SupersededError extends Error {
  constructor() {
    super("superseded by a newer request");
    this.name = "SupersededError";
  }
}

/** The engine refused or failed to compute a setup. */
export class EngineError extends Error {
  readonly kind: "setup" | "unsupported" | "internal" | "transport";
  readonly path?: string;
  constructor(kind: EngineError["kind"], message: string, path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "EngineError";
    this.kind = kind;
    this.path = path;
  }
}

export function isSuperseded(err: unknown): err is SupersededError {
  return err instanceof Error && err.name === "SupersededError";
}

export interface SolveOptions {
  /** Requests on the same channel supersede each other. Default "main". */
  channel?: string;
  signal?: AbortSignal;
}

export class EngineClient {
  private readonly transport: Transport;
  private readonly inflight = new Map<string, AbortController>();

  constructor(transport: Transport) {
    this.transport = transport;
  }

  subscribe(listener: (s: EngineStatus) => void): () => void {
    return this.transport.subscribe(listener);
  }

  async solve(setup: Setup, want: Want[] = [], opts: SolveOptions = {}): Promise<Result> {
    const channel = opts.channel ?? "main";
    this.inflight.get(channel)?.abort(new SupersededError());
    const ctrl = new AbortController();
    this.inflight.set(channel, ctrl);
    const onAbort = () => ctrl.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const raw = await this.transport.call("solve", [JSON.stringify(setup), JSON.stringify(want)], ctrl.signal);
      if (ctrl.signal.aborted) throw ctrl.signal.reason;
      return parseReply(raw);
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
      if (this.inflight.get(channel) === ctrl) this.inflight.delete(channel);
    }
  }

  close(): void {
    for (const c of this.inflight.values()) c.abort(new SupersededError());
    this.inflight.clear();
    this.transport.close();
  }
}

/** Turn solve_json's reply (JSON text or an already-parsed object) into a Result. */
export function parseReply(raw: unknown): Result {
  const reply = (typeof raw === "string" ? JSON.parse(raw) : raw) as SolveReply;
  if (!reply || typeof reply !== "object" || !("ok" in reply)) {
    throw new EngineError("internal", "the engine returned an unexpected reply");
  }
  if (!reply.ok) throw new EngineError(reply.kind, reply.error, reply.path);
  return reply.result;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

type WorkerReply =
  | { type: "progress"; stage: string; fraction: number }
  | { type: "ready"; versions: Record<string, string> }
  | { type: "fatal"; error: string }
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/** Minimal Worker surface, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", fn: (ev: { data: unknown }) => void): void;
  terminate(): void;
}

class StatusHub {
  private status: EngineStatus;
  private readonly listeners = new Set<(s: EngineStatus) => void>();
  constructor(initial: EngineStatus) {
    this.status = initial;
  }
  get current() {
    return this.status;
  }
  set(s: EngineStatus) {
    this.status = s;
    for (const l of this.listeners) l(s);
  }
  subscribe(l: (s: EngineStatus) => void) {
    this.listeners.add(l);
    l(this.status);
    return () => void this.listeners.delete(l);
  }
}

/** The Pyodide worker (public/engine/worker.js). */
export class WorkerTransport implements Transport {
  private readonly worker: WorkerLike;
  private readonly hub = new StatusHub({ state: "loading", stage: "Starting the engine…", fraction: 0 });
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private nextId = 1;

  constructor(worker: WorkerLike) {
    this.worker = worker;
    worker.addEventListener("message", (ev) => this.onMessage(ev.data as WorkerReply));
  }

  private onMessage(msg: WorkerReply) {
    if ("type" in msg) {
      if (msg.type === "progress") this.hub.set({ state: "loading", stage: msg.stage, fraction: msg.fraction });
      else if (msg.type === "ready") this.hub.set({ state: "ready", versions: msg.versions });
      else if (msg.type === "fatal") {
        this.hub.set({ state: "failed", error: msg.error });
        for (const p of this.pending.values()) p.reject(new EngineError("transport", msg.error));
        this.pending.clear();
      }
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return; // cancelled
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new EngineError("internal", msg.error));
  }

  call(method: string, args: string[], signal: AbortSignal): Promise<unknown> {
    if (this.hub.current.state === "failed") {
      return Promise.reject(new EngineError("transport", this.hub.current.error));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      this.pending.set(id, { resolve, reject });
      signal.addEventListener(
        "abort",
        () => {
          if (!this.pending.delete(id)) return;
          this.worker.postMessage({ type: "cancel", id });
          reject(signal.reason);
        },
        { once: true },
      );
      this.worker.postMessage({ id, method, args });
    });
  }

  subscribe(l: (s: EngineStatus) => void) {
    return this.hub.subscribe(l);
  }

  close() {
    this.worker.terminate();
  }
}

/** Native Python through scripts/devserver.py: POST {method, args} -> {ok, result | error}. */
export class HttpTransport implements Transport {
  private readonly url: string;
  private readonly hub = new StatusHub({ state: "loading", stage: "Contacting the local engine…", fraction: 0.5 });
  private readonly fetchFn: typeof fetch;

  constructor(url: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  async call(method: string, args: string[], signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, args }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      const msg = `local engine at ${this.url} is not reachable (${String(err)})`;
      this.hub.set({ state: "failed", error: msg });
      throw new EngineError("transport", msg);
    }
    if (!res.ok) throw new EngineError("transport", `local engine replied HTTP ${res.status}`);
    const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
    if (this.hub.current.state !== "ready") this.hub.set({ state: "ready", versions: { backend: "local" } });
    if (!body.ok) throw new EngineError("internal", body.error ?? "unknown error");
    return body.result;
  }

  subscribe(l: (s: EngineStatus) => void) {
    return this.hub.subscribe(l);
  }

  close() {}
}

export interface BackendChoice {
  kind: "pyodide" | "local";
  /** Worker script URL (pyodide) or API endpoint (local). */
  url: string;
}

/** Pick the backend from the page URL: `?backend=local` talks to
 * scripts/devserver.py (at `localApi`, or same-origin `/api`); anything else
 * runs Pyodide in a worker. */
export function chooseBackend(search: string, origin: string, basePath: string, localApi?: string): BackendChoice {
  const q = new URLSearchParams(search);
  if (q.get("backend") === "local") {
    return { kind: "local", url: q.get("api") || localApi || `${origin}/api` };
  }
  return { kind: "pyodide", url: `${basePath}/engine/worker.js` };
}

export function createEngine(choice: BackendChoice): EngineClient {
  if (choice.kind === "local") return new EngineClient(new HttpTransport(choice.url));
  return new EngineClient(new WorkerTransport(new Worker(choice.url)));
}
