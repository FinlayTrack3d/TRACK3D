import test from "node:test";
import assert from "node:assert/strict";

// The system prompt is sent as cached blocks; tests read it as one text.
const systemOf = (body) => (Array.isArray(body.system) ? body.system.map((block) => block.text).join("\n\n") : body.system);

// Replays the conversation from the coach review (G1/G2): a sharp shoulder
// pain report, then two follow-ups on the same exercise.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.ANTHROPIC_API_KEY = "test-key";

const painReports = [];
const anthropicCalls = [];
let modelReply = { message: "For chest today, do machine chest press and cable fly with light, pain-free weight; skip pressing overhead.", insights: [], actions: [] };

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input?.url || input));
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  if (url.pathname.includes("/auth/v1/user")) return Response.json({ id: "user-1", aud: "authenticated" });
  if (url.hostname === "api.anthropic.com") {
    anthropicCalls.push(body);
    const text = typeof modelReply === "string" ? modelReply : JSON.stringify(modelReply);
    if (body.stream) {
      // Split mid-word to prove partial messages are read from a stream.
      const chunks = [text.slice(0, 25), text.slice(25)].map((part) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: part } })}\n\n`);
      return new Response(new ReadableStream({ start(c) { chunks.forEach((e) => c.enqueue(new TextEncoder().encode(e))); c.close(); } }));
    }
    return Response.json({ content: [{ type: "text", text }] });
  }
  const table = url.pathname.split("/").pop();
  if (table === "coach_conversations") return Response.json({ id: "conv-1" }, { status: 201 });
  if (table === "pain_reports" && method === "POST") {
    painReports.push({ id: `p${painReports.length}`, status: "active", reported_at: new Date().toISOString(), ...body });
    return new Response(null, { status: 201 });
  }
  if (table === "pain_reports") return Response.json(painReports.filter((report) => report.status !== "resolved"));
  if (table === "get_coach_recent_context") return Response.json({ messages: [] });
  if (table === "coach_profiles") return Response.json(null);
  if (table === "coach_actions") return Response.json((Array.isArray(body) ? body : [body]).map((row, index) => ({ id: `a${index}`, ...row })), { status: 201 });
  return Response.json([], { status: method === "GET" ? 200 : 201 });
};

const { POST } = await import("../app/api/coach/route.js");
const clientContext = { activeWorkout: [{ exercise: "Dumbbell Shoulder Press", isCurrentExercise: true, targetSets: 4, repRangeTarget: ["10", "10", "10", "10"], loggedSets: [{ setNumber: 1, weight: "20", reps: "10" }] }] };
const ask = async (message) => {
  const response = await POST(new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ message, conversationId: "conv-1", clientContext }),
  }));
  return response.json();
};

test("first pain report: instant stop, professional advice, pain recorded with area and exercise", async () => {
  const reply = await ask("Sharp pain in my left shoulder on that last rep.");
  assert.equal(reply.safetyStop, true);
  assert.equal(reply.activePain, true);
  assert.match(reply.message, /physio or doctor/);
  assert.equal(anthropicCalls.length, 0, "no model call for the stop");
  assert.equal(painReports.length, 1);
  assert.equal(painReports[0].body_area, "shoulder");
  assert.equal(painReports[0].exercise_key, "Dumbbell Shoulder Press");
});

test("asking for a pain-free alternative reaches the coach with the pain directive first", async () => {
  const reply = await ask("what can I do instead for chest today that won't hurt it?");
  assert.notEqual(reply.safetyStop, true, "not the canned stop again");
  assert.equal(anthropicCalls.length, 1);
  const system = systemOf(anthropicCalls[0]);
  assert.match(system, /^ACTIVE PAIN/);
  assert.match(system, /shoulder, during Dumbbell Shoulder Press/);
  assert.equal(reply.activePain, true);
  assert.match(reply.message, /pain-free/);
});

test("a later question on the same exercise still carries the directive, and load-adding actions are dropped", async () => {
  modelReply = { message: "Keep it light and switch to cable fly.", insights: [], actions: [
    { type: "propose_permanent_set_change", scope: "permanent", programmeExerciseId: "x", sets: 5, reason: "more volume" },
    { type: "temporary_exercise_swap", scope: "today", workoutId: "w1", fromExercise: "Dumbbell Shoulder Press", toExercise: "Cable Fly", reason: "pain-free alternative" },
  ] };
  const reply = await ask("Should I go up to 18kg on this one?");
  assert.match(systemOf(anthropicCalls.at(-1)), /^ACTIVE PAIN/);
  assert.ok(reply.actions.every((action) => action.action_type !== "propose_permanent_set_change"), "no load or plan increase while in pain");
});

test("red flags always get the urgent stop, even while pain is active", async () => {
  const calls = anthropicCalls.length;
  const reply = await ask("Now I have tingling down my arm and feel faint");
  assert.equal(reply.safetyStop, true);
  assert.match(reply.message, /medical help promptly/);
  assert.equal(anthropicCalls.length, calls);
});

test("once resolved, the directive is gone", async () => {
  painReports.forEach((report) => { report.status = "resolved"; });
  modelReply = { message: "Back to the plan.", insights: [], actions: [] };
  await ask("How many sets do I have left?");
  assert.doesNotMatch(systemOf(anthropicCalls.at(-1)), /ACTIVE PAIN/);
});

test("the workout coach streams its message, then sends the full result", async () => {
  modelReply = { message: "Do 3 sets of cable fly at a light, pain-free weight.", insights: [], actions: [] };
  const response = await POST(new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ message: "What next?", conversationId: "conv-1", clientContext, stream: true }),
  }));
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const partials = events.filter((event) => event.type === "partial");
  assert.ok(partials.length >= 1, "at least one partial message");
  assert.ok(partials[0].message.length < modelReply.message.length, "the first partial arrives before the reply is complete");
  const final = events.at(-1);
  assert.equal(final.type, "final");
  assert.equal(final.message, modelReply.message);
  assert.equal(anthropicCalls.at(-1).max_tokens, 900, "a short budget between sets");
  assert.equal(anthropicCalls.at(-1).stream, true);
});

test("a reply cut off by the short budget is retried, then its readable part is used", async () => {
  const before = anthropicCalls.length;
  modelReply = '{"message":"This reply was cut off mid';
  const reply = await ask("Explain my whole week in detail");
  assert.equal(anthropicCalls.length, before + 2);
  assert.equal(anthropicCalls.at(-1).max_tokens, 2000);
  assert.equal(reply.error, undefined, "no 'invalid response' error");
  assert.equal(reply.message, "This reply was cut off mid", "the readable part is shown");
  modelReply = { message: "ok", insights: [], actions: [] };
});

test("in a workout the context window is 7 days", async () => {
  const contextCalls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input?.url || input).includes("get_coach_recent_context")) contextCalls.push(JSON.parse(init.body));
    return original(input, init);
  };
  await ask("How many sets left?");
  globalThis.fetch = original;
  assert.equal(contextCalls.at(-1).window_days, 7);
});
