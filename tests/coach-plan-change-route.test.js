import test from "node:test";
import assert from "node:assert/strict";

// /api/coach during a workout: a plan change the coach proposes by name
// reaches the app as a change waiting for approval, and the reply never
// points to a card that isn't there.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.ANTHROPIC_API_KEY = "test-key";

const anthropicCalls = [];
const storedActions = [];
let modelReply = {};
let recentActions = [];

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input?.url || input));
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  if (url.pathname.includes("/auth/v1/user")) return Response.json({ id: "user-1", aud: "authenticated" });
  if (url.hostname === "api.anthropic.com") {
    anthropicCalls.push(body);
    return Response.json({ content: [{ type: "text", text: JSON.stringify(modelReply) }] });
  }
  const table = url.pathname.split("/").pop();
  if (table === "pain_reports") return Response.json([]);
  if (table === "get_coach_recent_context") return Response.json({ messages: [], actions: recentActions });
  if (table === "coach_profiles") return Response.json(null);
  if (table === "coach_actions" && method === "POST") {
    const rows = (Array.isArray(body) ? body : [body]).map((row, index) => ({ id: `a${storedActions.length + index}`, ...row }));
    storedActions.push(...rows);
    return Response.json(rows, { status: 201 });
  }
  return Response.json([], { status: method === "GET" ? 200 : 201 });
};

const { POST } = await import("../app/api/coach/route.js");
const clientContext = {
  activeWorkout: [{ exercise: "Bench Press", isCurrentExercise: true, targetSets: 4, repRangeTarget: ["8-10", "8-10", "8-10", "8-10"], loggedSets: [] }],
  savedPlan: [{ name: "Push A", days: ["MON"], exercises: [{ name: "Bench Press", prescription: "4 × 8-10" }, { name: "Cable Fly", prescription: "3 × 12-15" }] }],
};
const ask = async (message) => {
  const response = await POST(new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ message, conversationId: "conv-1", clientContext }),
  }));
  return response.json();
};
const systemOf = (body) => (Array.isArray(body.system) ? body.system.map((block) => block.text).join("\n\n") : body.system);

test("a permanent change asked for mid-workout comes back as a change waiting for approval", async () => {
  modelReply = { message: "I'd take Cable Fly out of Push A from next time. Tap APPROVE & SAVE to save it.", insights: [], actions: [
    { type: "propose_plan_change", scope: "permanent", reason: "You asked to drop it", changes: [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Cable Fly" }] },
  ] };
  const reply = await ask("Remove cable fly from my plan permanently");
  const system = systemOf(anthropicCalls.at(-1));
  assert.match(system, /propose_plan_change/);
  assert.match(system, /"savedPlan":\[\{"name":"Push A"/);
  assert.doesNotMatch(system, /data has no identifier/);
  assert.equal(reply.actions.length, 1);
  assert.equal(reply.actions[0].action_type, "propose_plan_change");
  assert.equal(reply.actions[0].status, "pending_approval");
  assert.deepEqual(reply.actions[0].payload.changes, [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Cable Fly" }]);
  assert.equal(reply.message, "I'd take Cable Fly out of Push A from next time. Tap APPROVE & SAVE to save it.");
  assert.equal(reply.planChangeHint, false, "no OPEN CHANGE PLAN when the card is there");
});

test("a change the app can't prepare is never pointed to; the reply says so and offers Change Plan", async () => {
  modelReply = { message: "Good call. I'd add an arms day on Saturday. Tap APPROVE & SAVE to save it.", insights: [], actions: [
    { type: "propose_plan_change", scope: "permanent", changes: [{ kind: "add_session", sessionName: "Arms", days: ["SAT"] }] },
  ] };
  const before = storedActions.length;
  const reply = await ask("Add an arms day on Saturday");
  assert.equal(storedActions.length, before, "nothing stored");
  assert.deepEqual(reply.actions, []);
  assert.doesNotMatch(reply.message, /APPROVE & SAVE/);
  assert.equal(reply.message, "Good call. I'd add an arms day on Saturday. That change couldn't be prepared for you to approve, so nothing is waiting in a card. To change your plan, use CHANGE PLAN on the Fitness page.");
  assert.equal(reply.planChangeHint, true);
});

test("part of a change the app can't prepare is left out, and the reply says so", async () => {
  modelReply = { message: "I'd drop Cable Fly and add an arms day. Tap APPROVE & SAVE to save it.", insights: [], actions: [
    { type: "propose_plan_change", scope: "permanent", changes: [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Cable Fly" }, { kind: "add_session", sessionName: "Arms" }] },
  ] };
  const reply = await ask("Drop cable fly and add an arms day for good");
  assert.deepEqual(reply.actions[0].payload.changes, [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Cable Fly" }]);
  assert.match(reply.message, /One part of this couldn't be prepared as a change you can approve, so it isn't included below\.\)$/);
  assert.equal(reply.planChangeHint, false);
});

test("a reply that leaks internal names points to the card when there is one", async () => {
  modelReply = { message: "Added a propose_plan_change using savedPlan names.", insights: [], actions: [
    { type: "propose_plan_change", changes: [{ kind: "update_prescription", sessionName: "Push A", exerciseName: "Bench Press", sets: 3 }] },
  ] };
  const reply = await ask("Make bench 3 sets from now on");
  assert.equal(reply.message, "Here's the change I'd make to your plan. Tap APPROVE & SAVE to save it, or DISCARD to keep your plan as it is.");
  assert.equal(reply.actions[0].scope, "permanent");
  assert.equal(reply.planChangeHint, false);
});

test("pointing to CHANGE PLAN without a change of its own shows the button", async () => {
  modelReply = { message: "I can't save that change from here — use CHANGE PLAN on the Fitness page. For today, tap swap.", insights: [], actions: [] };
  const reply = await ask("Rebuild my whole programme around 3 days");
  assert.equal(reply.planChangeHint, true);
  assert.equal((reply.message.match(/CHANGE PLAN/g) || []).length, 1);
});

test("a reply pointing to APPROVE & SAVE without a change is corrected, unless a change is still waiting", async () => {
  modelReply = { message: "Sure, I'd cut Cable Fly. Tap APPROVE & SAVE to save it.", insights: [], actions: [] };
  const lost = await ask("cut cable fly");
  assert.equal(lost.message, "Sure, I'd cut Cable Fly. That change couldn't be prepared for you to approve, so nothing is waiting in a card. To change your plan, use CHANGE PLAN on the Fitness page.");
  assert.equal(lost.planChangeHint, true);
  recentActions = [{ id: "a0", action_type: "propose_plan_change", scope: "permanent", status: "pending_approval" }];
  modelReply = { message: "Not yet: tap APPROVE & SAVE on the Proposed change card to save it.", insights: [], actions: [] };
  const waiting = await ask("is it saved?");
  assert.equal(waiting.message, "Not yet: tap APPROVE & SAVE on the Proposed change card to save it.");
  assert.equal(waiting.planChangeHint, false);
  recentActions = [];
});
