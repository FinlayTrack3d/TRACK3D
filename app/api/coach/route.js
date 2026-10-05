import { createClient } from "@supabase/supabase-js";
import { prepareAction } from "../../../lib/coaching/actions.js";
import { needsHistoricalRetrieval } from "../../../lib/coaching/context.js";
import { buildCoachSystemInstructions } from "../../../lib/coaching/playbook.js";
import { safetyDirective } from "../../../lib/coaching/safety.js";

const responseShape = `Return only JSON matching:
{"message":"concise answer","insights":[{"kind":"progress|recovery|form|consistency|safety","text":"..."}],"actions":[],"memoryCandidates":[]}.
Allowed actions are temporary_exercise_swap, temporary_reorder, temporary_reduce_sets, propose_permanent_exercise_swap, propose_permanent_set_change, set_inline_cue, record_memory_candidate, and record_pain_report. Use the exact camelCase fields required by the requested action. Temporary changes require a workoutId and scope today or this_week. Permanent proposals require a programmeExerciseId and scope permanent. Do not emit an action when the supplied identifiers are missing.`;

function supabaseForRequest(request) {
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
    const supabase = supabaseForRequest(request);
    if (!supabase) return Response.json({ error: "Coach data service is not configured" }, { status: 503 });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

    const body = await request.json();
    const message = String(body?.message || "").trim();
    if (!message) return Response.json({ error: "Message is required" }, { status: 400 });

    let conversationId = body?.conversationId;
    if (!conversationId) {
      const { data, error } = await supabase.from("coach_conversations").insert({ user_id: user.id, title: message.slice(0, 80) }).select("id").single();
      if (error) return Response.json({ error: "Could not start Coach conversation" }, { status: 500 });
      conversationId = data.id;
    }

    await supabase.from("coach_messages").insert({ user_id: user.id, conversation_id: conversationId, role: "user", content: message });

    const safety = safetyDirective(message);
    if (safety) {
      const payload = { message: safety.message, insights: [{ kind: "safety", text: safety.message }], actions: [] };
      await Promise.all([
        supabase.from("pain_reports").insert({ user_id: user.id, report: message, severity: safety.severity === "concerning" ? "concerning" : "unspecified" }),
        supabase.from("coach_messages").insert({ user_id: user.id, conversation_id: conversationId, role: "assistant", content: safety.message, structured_payload: payload }),
      ]);
      return Response.json({ ...payload, conversationId });
    }

    const [{ data: context, error: contextError }, { data: profile }] = await Promise.all([
      supabase.rpc("get_coach_recent_context", { window_days: 14 }),
      supabase.from("coach_profiles").select("personality").eq("user_id", user.id).maybeSingle(),
    ]);
    if (contextError) return Response.json({ error: "Could not load Coach context" }, { status: 500 });

    let olderHistory = [];
    const usedHistoricalRetrieval = needsHistoricalRetrieval(message);
    if (usedHistoricalRetrieval) {
      const { data } = await supabase.rpc("search_training_history", { exercise_search: null, result_limit: 80 });
      olderHistory = data || [];
    }

    // Retry once when the model's reply is not valid JSON before reporting an error.
    let answer;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      const providerResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
          max_tokens: 1200,
          system: `${buildCoachSystemInstructions(profile?.personality)}\n\n${responseShape}`,
          messages: [{ role: "user", content: `14-DAY CONTEXT\n${JSON.stringify(context)}\n\nCURRENT CLIENT CONTEXT\n${JSON.stringify(body?.clientContext || null)}\n\nOLDER HISTORY RETRIEVAL\n${JSON.stringify(olderHistory)}\n\nUSER\n${message}` }],
        }),
      });
      if (!providerResponse.ok) return Response.json({ error: "Coach provider failed" }, { status: 502 });
      const providerPayload = await providerResponse.json();
      const text = providerPayload.content?.map((block) => block.text || "").join("") || "";
      try { answer = extractJson(text); } catch { answer = undefined; }
    }
    if (!answer) return Response.json({ error: "Coach returned an invalid response" }, { status: 502 });

    const preparedActions = [];
    for (const raw of answer.actions || []) {
      try { preparedActions.push(prepareAction(raw)); } catch { /* Reject unrecognised or malformed model actions. */ }
    }

    const actionRows = preparedActions.map(({ action, status }) => ({
      user_id: user.id,
      conversation_id: conversationId,
      action_type: action.type,
      scope: action.scope || "temporary",
      payload: action,
      rationale: action.reason || action.evidence,
      status,
    }));
    const { data: storedActions } = actionRows.length
      ? await supabase.from("coach_actions").insert(actionRows).select("id,action_type,scope,payload,status")
      : { data: [] };

    const allowedMemoryCategories = new Set(["goal", "priority", "exercise_preference", "equipment", "availability", "schedule", "communication"]);
    const memoryRows = (answer.memoryCandidates || []).flatMap((candidate) => {
      if (!allowedMemoryCategories.has(candidate?.category) || !candidate?.key || candidate?.value === undefined) return [];
      return [{
        user_id: user.id,
        category: candidate.category,
        memory_key: String(candidate.key).slice(0, 100),
        value: typeof candidate.value === "object" ? candidate.value : { value: candidate.value },
        evidence: String(candidate.evidence || message).slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0.7)),
        status: candidate.explicit === true ? "active" : "candidate",
        last_confirmed_at: candidate.explicit === true ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }];
    });
    if (memoryRows.length) await supabase.from("coach_memories").upsert(memoryRows, { onConflict: "user_id,category,memory_key" });

    const result = { message: String(answer.message || ""), insights: (answer.insights || []).slice(0, 3), actions: storedActions || [] };
    await supabase.from("coach_messages").insert({ user_id: user.id, conversation_id: conversationId, role: "assistant", content: result.message, structured_payload: result });
    return Response.json({ ...result, conversationId, usedHistoricalRetrieval });
  } catch (error) {
    console.error("Coach route error:", error.message);
    return Response.json({ error: "Coach is unavailable" }, { status: 500 });
  }
}
