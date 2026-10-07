import { createClient } from "@supabase/supabase-js";
import { postAnthropicMessages } from "../../../lib/coaching/anthropic.js";
import { buildCoachSystem } from "../../../lib/coaching/system.js";
import { readPlanChangeReply } from "../../../lib/coaching/plan-change-reply.js";
import { aiRequestAllowed, jsonSize, limitedResponse, readJsonBody } from "../../../lib/ai-guard.js";

// Request limits: the whole body, and the plan and workouts sent with it.
const MAX_BODY_BYTES = 200_000;
const MAX_CONTEXT_CHARS = 60_000;

function clientFor(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false },
  });
}

function extractJson(text) {
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

export async function POST(request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Coach provider is not configured" }, { status: 503 });
    const supabase = clientFor(request);
    if (!supabase) return Response.json({ error: "Coach data service is not configured" }, { status: 503 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

    const read = await readJsonBody(request, MAX_BODY_BYTES);
    if (!read.ok) return Response.json({ error: read.error }, { status: read.status });
    const body = read.value;
    if (jsonSize(body?.currentPlan) > MAX_CONTEXT_CHARS || jsonSize(body?.recentWorkouts) > MAX_CONTEXT_CHARS) return Response.json({ error: "This request is too large." }, { status: 413 });
    const allowed = await aiRequestAllowed(supabase, user.id);
    if (!allowed.ok) return limitedResponse(allowed);
    const messages = Array.isArray(body?.messages)
      ? body.messages.slice(-12).map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: String(message.content || "").slice(0, 2000) }))
      : [];
    if (!messages.some((message) => message.role === "user" && message.content.trim())) return Response.json({ error: "A change request is required" }, { status: 400 });

    const currentPlan = Array.isArray(body?.currentPlan) ? body.currentPlan : [];
    // A change the coach proposed earlier that is still waiting in the app.
    const pendingChanges = Array.isArray(body?.pendingChanges) ? body.pendingChanges.slice(0, 20).map((line) => String(line).slice(0, 200)) : [];
    const recentWorkouts = Array.isArray(body?.recentWorkouts) ? body.recentWorkouts.slice(0, 30) : [];
    const { data: historyData, error: historyError } = await supabase.rpc("search_training_history", {
      exercise_search: null,
      from_date: null,
      to_date: null,
      result_limit: 120,
    });
    // Recent legacy logs still give the coach useful context if an older
    // deployment does not have the structured-history function yet.
    const structuredHistory = historyError ? [] : (historyData || []);
    if (historyError) console.warn("Plan change history fallback:", historyError.message);

    const planChangeInstructions = `You are TRACK3D's plan-change coach. Your job is to prevent unnecessary programme resets while respecting the user's goals and preferences.

First determine whether the problem needs: (1) a small targeted change to session days, exercises, sets, or reps; (2) clarification with one concise question; or (3) a full plan rebuild because the goal, training frequency, equipment, limitations, or overall structure has materially changed. Prefer targeted changes when the issue is isolated. A change to which weekdays are available normally needs update_session_days, not a full rebuild, unless the number of weekly sessions or recovery structure must also change. Do not recommend a full rebuild merely because one exercise is disliked or one prescription needs adjusting.

Use the current plan and training history. Never erase or rewrite completed workout history. Be honest when the evidence is limited. If pain or injury is mentioned, tell the user to stop the painful movement and seek qualified advice; do not diagnose.

HOW CHANGES ARE SAVED: every change you put in "changes" appears under your message in a "Proposed change" card with APPROVE & SAVE and DISCARD buttons. Nothing is saved until the user taps APPROVE & SAVE. So never say a change has been made, removed, saved or applied. Describe changes as proposed (for example "I'd take Full Body Pump out of Friday, leaving five sessions") and end with "Tap APPROVE & SAVE to save it." Never describe a change in "message" that isn't in "changes". If CHANGE WAITING FOR APPROVAL is listed below, it is already in a card: don't propose it again; if the user asks whether it's saved or says they approve, tell them to tap APPROVE & SAVE on the Proposed change card (or DISCARD to keep their plan).

Only propose exact targeted changes when the user has supplied enough information or explicitly accepted your recommendation. Use exact session and exercise names from CURRENT PLAN. To take a whole session out of the plan (its days become rest days), use remove_session; to change which days a session is on, use update_session_days. Rep prescriptions may be a string such as "8-12" or one string per set. A replacement is a different movement; a rename is only a label correction for the same movement, and preserves its history alias. Adding a new session is a full rebuild. A full rebuild is never applied automatically: recommend it and explain why.

Return only JSON:
{"message":"brief collaborative reply in plain text, at most 120 words, including at most one question","recommendation":"clarify|targeted|full_rebuild","changes":[{"kind":"remove_session|update_session_days|update_prescription|replace_exercise|rename_exercise|remove_exercise|add_exercise","sessionName":"exact session","days":["MON"],"exerciseName":"exact current exercise when applicable","replacementName":"new exercise when applicable","sets":3,"reps":"8-12","tempo":"3-0-1-0","reason":"why"}]}`;
    const { data: profile } = await supabase.from("coach_profiles").select("personality,experience_level").eq("user_id", user.id).maybeSingle();
    const system = buildCoachSystem({ areaInstructions: planChangeInstructions, kind: "conversation", personality: profile?.personality, experienceLevel: profile?.experience_level });

    const provider = await postAnthropicMessages({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 1800,
        system,
        messages: [{ role: "user", content: `CURRENT PLAN\n${JSON.stringify(currentPlan)}\n\nRECENT LEGACY WORKOUTS\n${JSON.stringify(recentWorkouts)}\n\nSTRUCTURED EXERCISE HISTORY\n${JSON.stringify(structuredHistory || [])}${pendingChanges.length ? `\n\nCHANGE WAITING FOR APPROVAL (not saved yet)\n${pendingChanges.map((line) => `- ${line}`).join("\n")}` : ""}` }, ...messages],
      });
    if (!provider.ok) return Response.json({ error: provider.publicError }, { status: provider.status === 429 ? 429 : 502 });
    const payload = provider.payload;
    const text = payload.content?.map((block) => block.text || "").join("") || "";
    let result;
    try {
      result = readPlanChangeReply(extractJson(text));
    } catch {
      result = {
        message: text.replace(/```json|```/g, "").trim() || "I need one more detail before I can recommend a safe plan change.",
        recommendation: "clarify",
        changes: [],
      };
    }
    return Response.json(result);
  } catch (error) {
    console.error("Plan change coach error:", error.message);
    return Response.json({ error: "The plan-change coach is unavailable" }, { status: 500 });
  }
}
