import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EngineClient,
  EngineError,
  HttpTransport,
  WorkerTransport,
  chooseBackend,
  isSuperseded,
  parseReply,
  type EngineStatus,
  type WorkerLike,
} from "./client.ts";
import { DEFAULT_SETUP } from "./defaults.ts";
import type { Result } from "./types.ts";

const RESULT: Result = {
  version: 1,
  stable: true,
  equilibrium: [0, 0, 2e-7],
  modes: [
    { name: "x", axis: [1, 0, 0], frequency: 2e5, stiffness: 1e-5 },
    { name: "y", axis: [0, 1, 0], frequency: 3e5, stiffness: 3e-5 },
    { name: "z", axis: [0, 0, 1], frequency: 1e5, stiffness: 3e-6 },
  ],
  depth: { J: 1e-18, K: 1e5, kT: 380 },
  models: [],
  warnings: [],
};

/** A fake worker: records posted messages; the test replies by hand. */
class FakeWorker implements WorkerLike {
  sent: Record<string, unknown>[] = [];
  private fn: ((ev: { data: unknown }) => void) | null = null;
  postMessage(msg: unknown) {
    this.sent.push(msg as Record<string, unknown>);
  }
  addEventListener(_t: "message", fn: (ev: { data: unknown }) => void) {
    this.fn = fn;
  }
  terminate() {}
  emit(data: unknown) {
    this.fn?.({ data });
  }
  calls() {
    return this.sent.filter((m) => "method" in m);
  }
}

const reply = (result: Result) => JSON.stringify({ ok: true, result });

test("solve sends the setup as JSON and parses the reply", async () => {
  const w = new FakeWorker();
  const engine = new EngineClient(new WorkerTransport(w));
  const p = engine.solve(DEFAULT_SETUP, ["curves"]);
  const [call] = w.calls();
  assert.equal(call.method, "solve");
  const [setupJson, wantJson] = call.args as string[];
  assert.deepEqual(JSON.parse(setupJson), DEFAULT_SETUP);
  assert.deepEqual(JSON.parse(wantJson), ["curves"]);
  w.emit({ id: call.id, ok: true, result: reply(RESULT) });
  assert.deepEqual(await p, RESULT);
});

test("a newer request supersedes the older one on the same channel", async () => {
  const w = new FakeWorker();
  const engine = new EngineClient(new WorkerTransport(w));
  const first = engine.solve(DEFAULT_SETUP);
  const second = engine.solve(DEFAULT_SETUP);
  await assert.rejects(first, (e) => isSuperseded(e));
  const [c1, c2] = w.calls();
  assert.ok(w.sent.some((m) => m.type === "cancel" && m.id === c1.id), "worker told to drop the old call");
  // A late reply to the superseded call is ignored.
  w.emit({ id: c1.id, ok: true, result: reply({ ...RESULT, stable: false }) });
  w.emit({ id: c2.id, ok: true, result: reply(RESULT) });
  assert.equal((await second).stable, true);
});

test("different channels do not supersede each other", async () => {
  const w = new FakeWorker();
  const engine = new EngineClient(new WorkerTransport(w));
  const a = engine.solve(DEFAULT_SETUP, [], { channel: "main" });
  const b = engine.solve(DEFAULT_SETUP, [], { channel: "sweep" });
  const [c1, c2] = w.calls();
  w.emit({ id: c2.id, ok: true, result: reply(RESULT) });
  w.emit({ id: c1.id, ok: true, result: reply(RESULT) });
  await Promise.all([a, b]);
});

test("an external abort signal cancels the request", async () => {
  const w = new FakeWorker();
  const engine = new EngineClient(new WorkerTransport(w));
  const ctrl = new AbortController();
  const p = engine.solve(DEFAULT_SETUP, [], { signal: ctrl.signal });
  ctrl.abort(new Error("user cancelled"));
  await assert.rejects(p, /user cancelled/);
});

test("load progress and ready are reported", () => {
  const w = new FakeWorker();
  const t = new WorkerTransport(w);
  const seen: EngineStatus[] = [];
  t.subscribe((s) => seen.push(s));
  w.emit({ type: "progress", stage: "Loading NumPy…", fraction: 0.35 });
  w.emit({ type: "ready", versions: { levtrap: "0.1.0" } });
  assert.deepEqual(
    seen.map((s) => s.state),
    ["loading", "loading", "ready"],
  );
  assert.equal((seen[1] as { fraction: number }).fraction, 0.35);
});

test("a fatal load error fails pending and later calls", async () => {
  const w = new FakeWorker();
  const engine = new EngineClient(new WorkerTransport(w));
  const p = engine.solve(DEFAULT_SETUP);
  w.emit({ type: "fatal", error: "network down" });
  await assert.rejects(p, (e) => e instanceof EngineError && e.kind === "transport");
  await assert.rejects(engine.solve(DEFAULT_SETUP), /network down/);
});

test("engine failures carry kind and key path", () => {
  assert.throws(
    () => parseReply(JSON.stringify({ ok: false, kind: "setup", path: "particle.radius", error: "is required" })),
    (e) => e instanceof EngineError && e.kind === "setup" && e.path === "particle.radius",
  );
  assert.throws(
    () => parseReply(JSON.stringify({ ok: false, kind: "unsupported", error: "paul fields are not computed yet" })),
    (e) => e instanceof EngineError && e.kind === "unsupported",
  );
});

test("HTTP transport posts {method, args} to the local devserver", async () => {
  let body: { method: string; args: string[] } | null = null;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ ok: true, result: reply(RESULT) }));
  }) as unknown as typeof fetch;
  const t = new HttpTransport("http://127.0.0.1:8000/api", fakeFetch);
  const engine = new EngineClient(t);
  const r = await engine.solve(DEFAULT_SETUP);
  assert.equal(r.modes.length, 3);
  assert.equal(body!.method, "solve");
  let status: EngineStatus | null = null;
  t.subscribe((s) => (status = s));
  assert.equal(status!.state, "ready");
});

test("backend choice from the page URL", () => {
  assert.deepEqual(chooseBackend("", "https://x.io", "/levtrap/next"), {
    kind: "pyodide",
    url: "/levtrap/next/engine/worker.js",
  });
  assert.deepEqual(chooseBackend("?backend=local", "http://127.0.0.1:8000", "/next"), {
    kind: "local",
    url: "http://127.0.0.1:8000/api",
  });
  assert.equal(chooseBackend("?backend=local", "http://localhost:3000", "", "http://127.0.0.1:8000/api").url,
    "http://127.0.0.1:8000/api");
  assert.equal(chooseBackend("?backend=local&api=http://h:1/api", "o", "").url, "http://h:1/api");
});
