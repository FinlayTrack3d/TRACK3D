import test from "node:test";
import assert from "node:assert/strict";

// /api/plan-change: the coach is told to lead with a recommendation, and the
// request is size-capped like the other AI routes.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.ANTHROPIC_API_KEY = "test-key";

const anthropicCalls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input?.url || input));
  if (url.pathname.includes("/auth/v1/user")) return Response.json({ id: "user-1", aud: "authenticated" });
  if (url.hostname === "api.anthropic.com") {
    anthropicCalls.push(JSON.parse(init.body));
    return Response.json({ content: [{ type: "text", text: JSON.stringify({ message: "I'd drop Cable Fly to 2 sets: it's been skipped twice. Does that suit you?", recommendation: "targeted", changes: [] }) }] });
  }
  return Response.json([], { status: (init.method || "GET") === "GET" ? 200 : 201 });
};

const { POST } = await import("../app/api/plan-change/route.js");
const post = (body) => POST(new Request("http://localhost/api/plan-change", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer t" },
  body: typeof body === "string" ? body : JSON.stringify(body),
}));
const systemOf = (body) => (Array.isArray(body.system) ? body.system.map((block) => block.text).join("\n\n") : body.system);

test("the plan-change coach leads with a recommendation, never only a question", async () => {
  const response = await post({ messages: [{ role: "user", content: "Review my plan and recommend changes" }], currentPlan: [{ name: "Push A", days: ["MON"], exercises: [] }] });
  assert.equal(response.status, 200);
  const system = systemOf(anthropicCalls.at(-1));
  assert.match(system, /EVERY REPLY LEADS WITH A RECOMMENDATION/);
  assert.match(system, /Never reply with only a question, and never just ask the user what they want to change/);
  assert.match(system, /your recommendation first, then at most one question/);
});

test("an oversized plan is refused before reaching the coach", async () => {
  const before = anthropicCalls.length;
  const hugePlan = [{ name: "Push A", days: ["MON"], exercises: [], notes: "x".repeat(70_000) }];
  assert.equal((await post({ messages: [{ role: "user", content: "Change it" }], currentPlan: hugePlan })).status, 413);
  assert.equal((await post("x".repeat(250_000))).status, 413);
  assert.equal(anthropicCalls.length, before);
});
