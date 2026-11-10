import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngine, EngineError, isAbortError, type EngineStatus, type Transport } from "./client.ts";
import { DEFAULT_SETUP } from "./setup.ts";
import type { Result, SolveResponse } from "./types.ts";

/** A transport whose requests the test answers by hand. */
function fakeTransport() {
  const calls: { setup: string; want: string; signal: AbortSignal; answer(r: SolveResponse): void }[] = [];
  let report: (s: EngineStatus) => void = () => {};
  const transport: Transport = {
    start(onStatus) {
      report = onStatus;
    },
    request(setup, want, signal) {
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        calls.push({ setup, want, signal, answer: resolve });
      });
    },
    dispose() {},
  };
  return { transport, calls, report: (s: EngineStatus) => report(s) };
}

const result = (f: number) => ({ version: 1, modes: [{ frequency: f }] }) as unknown as Result;

test("solve sends the setup and wants as JSON and returns the result", async () => {
  const { transport, calls } = fakeTransport();
  const engine = createEngine(transport);
  const p = engine.solve(DEFAULT_SETUP, ["curves"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].setup), DEFAULT_SETUP);
  assert.deepEqual(JSON.parse(calls[0].want), ["curves"]);
  calls[0].answer({ ok: true, result: result(1e5) });
  assert.equal((await p).modes[0].frequency, 1e5);
});

test("a newer solve supersedes the older one", async () => {
  const { transport, calls } = fakeTransport();
  const engine = createEngine(transport);
  const first = engine.solve(DEFAULT_SETUP);
  const second = engine.solve(DEFAULT_SETUP);
  await assert.rejects(first, (err) => isAbortError(err));
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  calls[1].answer({ ok: true, result: result(2) });
  assert.equal((await second).modes[0].frequency, 2);
});

test("solves under different keys do not supersede each other", async () => {
  const { transport, calls } = fakeTransport();
  const engine = createEngine(transport);
  const a = engine.solve(DEFAULT_SETUP, [], { key: "numbers" });
  const b = engine.solve(DEFAULT_SETUP, ["curves"], { key: "plot" });
  calls[0].answer({ ok: true, result: result(1) });
  calls[1].answer({ ok: true, result: result(2) });
  assert.equal((await a).modes[0].frequency, 1);
  assert.equal((await b).modes[0].frequency, 2);
});

test("an AbortSignal cancels a solve", async () => {
  const { transport, calls } = fakeTransport();
  const engine = createEngine(transport);
  const ctrl = new AbortController();
  const p = engine.solve(DEFAULT_SETUP, [], { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (err) => isAbortError(err));
  assert.equal(calls[0].signal.aborted, true);
});

test("an already aborted signal never reaches the transport", async () => {
  const { transport, calls } = fakeTransport();
  const engine = createEngine(transport);
  await assert.rejects(engine.solve(DEFAULT_SETUP, [], { signal: AbortSignal.abort() }), (err) => isAbortError(err));
  assert.equal(calls.length, 0);
});

test("engine errors carry their kind and key path", async () => {
  const { transport, calls } = fakeTransport();
  const engine = createEngine(transport);
  const p = engine.solve(DEFAULT_SETUP);
  calls[0].answer({ ok: false, kind: "setup", path: "particle.radius", error: "must be greater than 0" });
  await assert.rejects(p, (err) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.kind, "setup");
    assert.equal(err.path, "particle.radius");
    assert.equal(err.message, "particle.radius: must be greater than 0");
    return true;
  });
});

test("status follows the transport and notifies subscribers", () => {
  const { transport, report } = fakeTransport();
  const engine = createEngine(transport);
  assert.equal(engine.status.state, "loading");
  let calls = 0;
  const off = engine.subscribe(() => calls++);
  report({ state: "loading", stage: "Loading NumPy", fraction: 0.35 });
  report({ state: "ready", versions: { backend: "pyodide" } });
  assert.equal(calls, 2);
  assert.equal(engine.status.state, "ready");
  off();
  report({ state: "failed", error: "x" });
  assert.equal(calls, 2);
});
