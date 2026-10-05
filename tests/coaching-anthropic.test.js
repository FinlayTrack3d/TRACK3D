import test from "node:test";
import assert from "node:assert/strict";
import { postAnthropicMessages } from "../lib/coaching/anthropic.js";

const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });

test("temporary provider failures are retried once", async () => {
  const responses = [reply(529, { error: { message: "Overloaded" } }), reply(200, { content: [{ text: "ok" }] })];
  const result = await postAnthropicMessages({}, { apiKey: "k", fetchImpl: async () => responses.shift(), retryDelayMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.payload.content[0].text, "ok");
});

test("provider errors keep their real reason and are not retried when permanent", async () => {
  let calls = 0;
  const result = await postAnthropicMessages({}, { apiKey: "k", fetchImpl: async () => { calls += 1; return reply(400, { error: { message: "model: not found" } }); }, retryDelayMs: 0 });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Coach provider failed (400): model: not found");
});
