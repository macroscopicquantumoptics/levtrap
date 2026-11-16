import { abortError, type EngineStatus, type Transport } from "./client.ts";
import type { WorkerReply, WorkerRequest } from "./protocol.ts";
import type { SolveResponse } from "./types.ts";

/** Runs the engine in a Web Worker with Pyodide. */
export function workerTransport(makeWorker: () => Worker, wheelBase: string): Transport {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve(r: SolveResponse): void; reject(e: unknown): void }>();
  const send = (msg: WorkerRequest) => worker?.postMessage(msg);

  return {
    start(onStatus) {
      worker = makeWorker();
      worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
        const msg = ev.data;
        switch (msg.type) {
          case "progress":
            onStatus({ state: "loading", stage: msg.stage, fraction: msg.fraction });
            break;
          case "ready":
            onStatus({ state: "ready", versions: msg.versions });
            break;
          case "fatal":
            onStatus({ state: "failed", error: msg.error });
            for (const p of pending.values()) p.reject(new Error(msg.error));
            pending.clear();
            break;
          case "result": {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            p?.resolve(JSON.parse(msg.response) as SolveResponse);
            break;
          }
          case "cancelled":
            pending.delete(msg.id);
            break;
        }
      };
      worker.onerror = (ev) => onStatus({ state: "failed", error: ev.message || "the engine worker failed" });
      send({ type: "init", wheelBase });
    },
    request(setup, want, signal) {
      const id = nextId++;
      return new Promise<SolveResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        signal.addEventListener(
          "abort",
          () => {
            if (!pending.delete(id)) return;
            send({ type: "cancel", id });
            reject(signal.reason ?? abortError());
          },
          { once: true },
        );
        send({ type: "solve", id, setup, want });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(abortError("engine disposed"));
      pending.clear();
    },
  };
}

/**
 * Posts to `scripts/devserver.py` (native Python, no Pyodide): the fast path
 * for development and for the browser tests.
 */
export function localTransport(apiUrl: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Transport {
  return {
    start(onStatus: (s: EngineStatus) => void) {
      onStatus({ state: "ready", versions: { backend: "local" } });
    },
    async request(setup, want, signal) {
      const res = await fetchFn(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "solve", args: [setup, want] }),
        signal,
      });
      if (!res.ok) throw new Error(`local engine: HTTP ${res.status}`);
      const body = (await res.json()) as { ok: true; result: string } | { ok: false; error: string };
      if (!body.ok) throw new Error(`local engine: ${body.error}`);
      return JSON.parse(body.result) as SolveResponse;
    },
    dispose() {},
  };
}
