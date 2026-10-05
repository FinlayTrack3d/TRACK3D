import test from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.ANTHROPIC_API_KEY = "test-key";

let rateResult = { data: "ok", status: 200 };
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  calls.push({ url, body: init.body });
  if (url.includes("/auth/v1/user")) return Response.json({ id: "user-1", aud: "authenticated" });
  if (url.includes("/rest/v1/rpc/chat_rate_check")) {
    return rateResult.status === 200 ? Response.json(rateResult.data) : Response.json({ message: "function not found" }, { status: rateResult.status });
  }
  if (url.includes("api.anthropic.com")) return Response.json({ content: [{ type: "text", text: "Hello" }] });
  throw new Error(`unexpected fetch ${url}`);
};

const { POST } = await import("../app/api/chat/route.js");
const post = (body, token = "t") => POST(new Request("http://localhost/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: typeof body === "string" ? body : JSON.stringify(body),
}));
const ask = { messages: [{ role: "user", content: "Hi" }] };

test("unauthenticated requests are refused", async () => {
  assert.equal((await post(ask, null)).status, 401);
});

test("a normal request reaches Anthropic through the shared helper", async () => {
  calls.length = 0;
  const response = await post(ask);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).content, [{ type: "text", text: "Hello" }]);
  const anthropic = JSON.parse(calls.find((call) => call.url.includes("anthropic")).body);
  assert.equal(anthropic.max_tokens, 1000);
  assert.deepEqual(anthropic.messages, ask.messages);
});

test("oversized input is rejected before calling Anthropic", async () => {
  calls.length = 0;
  const response = await post({ messages: [{ role: "user", content: "x".repeat(70_000) }] });
  assert.equal(response.status, 413);
  assert.equal(calls.some((call) => call.url.includes("anthropic")), false);
  assert.equal((await post("x".repeat(250_000))).status, 413);
});

test("the database rate limit returns 429 with Retry-After", async () => {
  rateResult = { data: "minute", status: 200 };
  calls.length = 0;
  const response = await post(ask);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(calls.some((call) => call.url.includes("anthropic")), false);
  rateResult = { data: "day", status: 200 };
  assert.match((await (await post(ask)).json()).error, /Daily coach limit/);
});

test("if the limit function is not installed yet, requests still work", async () => {
  rateResult = { status: 404 };
  assert.equal((await post(ask)).status, 200);
  rateResult = { data: "ok", status: 200 };
});
