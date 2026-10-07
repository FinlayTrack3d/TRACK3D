import test from "node:test";
import assert from "node:assert/strict";
import { aiRequestAllowed, jsonSize, readJsonBody } from "../lib/ai-guard.js";

const supabaseWith = (rpc) => ({ rpc: async () => rpc });

test("the database limit decides when it is available", async () => {
  assert.deepEqual(await aiRequestAllowed(supabaseWith({ data: "ok" }), "a"), { ok: true });
  const minute = await aiRequestAllowed(supabaseWith({ data: "minute" }), "b");
  assert.equal(minute.ok, false);
  assert.equal(minute.retryAfter, 60);
  assert.match((await aiRequestAllowed(supabaseWith({ data: "day" }), "c")).error, /Daily coach limit/);
});

test("if the database limit can't run, a tighter limit applies instead of none", async () => {
  const broken = supabaseWith({ error: { message: "function not found" } });
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await aiRequestAllowed(broken, "user-fallback")).ok);
  assert.deepEqual(results, [true, true, true, true, false, false]);
});

test("request bodies are size-capped and must be JSON", async () => {
  const request = (body) => new Request("http://localhost/api", { method: "POST", body });
  assert.deepEqual(await readJsonBody(request('{"a":1}'), 100), { ok: true, value: { a: 1 } });
  assert.equal((await readJsonBody(request("x".repeat(101)), 100)).status, 413);
  assert.equal((await readJsonBody(request("{not json"), 100)).status, 400);
  assert.equal(jsonSize({ a: "bc" }), 10);
});
