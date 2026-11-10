import assert from "node:assert/strict";
import { test } from "node:test";
import { localTransport } from "./transports.ts";

test("the local transport posts a solve to the devserver and unwraps its answer", async () => {
  let seen: { url: string; body: unknown } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(init.body as string) };
    const inner = JSON.stringify({ ok: true, result: { version: 1 } });
    return new Response(JSON.stringify({ ok: true, result: inner }), { status: 200 });
  }) as unknown as typeof fetch;
  const t = localTransport("http://127.0.0.1:8000/api", fakeFetch);
  const res = await t.request('{"version":1}', "[]", new AbortController().signal);
  assert.deepEqual(res, { ok: true, result: { version: 1 } });
  assert.deepEqual(seen, {
    url: "http://127.0.0.1:8000/api",
    body: { method: "solve", args: ['{"version":1}', "[]"] },
  });
});

test("the local transport reports devserver failures", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ ok: false, error: "KeyError: 'solve'" }), { status: 200 })) as unknown as typeof fetch;
  const t = localTransport("http://x/api", fakeFetch);
  await assert.rejects(t.request("{}", "[]", new AbortController().signal), /KeyError/);
});
