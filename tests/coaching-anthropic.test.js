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

test("streamed replies are read from server-sent events", async () => {
  const { readAnthropicStream } = await import("../lib/coaching/anthropic.js");
  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Drop to "}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_d',
    'elta","text":"18 kg."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
  ];
  const body = new ReadableStream({ start(controller) { events.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk))); controller.close(); } });
  const seen = [];
  const result = await readAnthropicStream(new Response(body), (delta) => seen.push(delta));
  assert.deepEqual(seen, ["Drop to ", "18 kg."], "events split across chunks are joined");
  assert.equal(result.text, "Drop to 18 kg.");
  assert.equal(result.stopReason, "end_turn");
});

test("the message field of a half-written JSON reply can be shown early", async () => {
  const { partialJsonStringField } = await import("../lib/coaching/anthropic.js");
  assert.equal(partialJsonStringField('{"insights":[],"mess'), null);
  assert.equal(partialJsonStringField('{"message":"Drop to 18'), "Drop to 18");
  assert.equal(partialJsonStringField('{"message":"Say \\"hi\\"\\nthen rest","actions":[]}'), 'Say "hi"\nthen rest');
  assert.equal(partialJsonStringField('{"message":"caf\\u00e9 time'), "café time");
  assert.equal(partialJsonStringField('{"message":"half escape \\'), "half escape ");
});

test("a billing or key failure is an outage: users see 'offline', the owner is alerted once an hour", async () => {
  const { COACH_OFFLINE, isProviderOutage, postAnthropicMessages, providerErrorResponse, reportProviderOutage, resetOutageAlertForTests } = await import("../lib/coaching/anthropic.js");
  assert.equal(isProviderOutage(400, "Your credit balance is too low to access the Anthropic API."), true);
  assert.equal(isProviderOutage(401), true);
  assert.equal(isProviderOutage(400, "messages: field required"), false);
  assert.equal(isProviderOutage(529), false);
  resetOutageAlertForTests();
  const calls = [];
  const fetchImpl = async (url, options) => {
    if (url.includes("anthropic")) return new Response(JSON.stringify({ error: { message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400 });
    calls.push(JSON.parse(options.body).text);
    return new Response("ok");
  };
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    process.env.AI_ALERT_WEBHOOK_URL = "https://hooks.example/alert";
    const result = await postAnthropicMessages({}, { apiKey: "k", fetchImpl, retryDelayMs: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.outage, true);
    assert.equal(result.publicError, COACH_OFFLINE);
    const response = providerErrorResponse(result);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: COACH_OFFLINE, offline: true });
    assert.equal(calls.length, 1, "alerted once");
    assert.equal(await reportProviderOutage({ status: 400, detail: "credit" }, { fetchImpl }), false, "not again within the hour");
    assert.equal(calls.length, 1);
    assert.ok(logged.some(line => line.includes("[TRACK3D-AI-OUTAGE]")), "tagged in the logs every time");
  } finally {
    console.error = originalError;
    delete process.env.AI_ALERT_WEBHOOK_URL;
    resetOutageAlertForTests();
  }
});
