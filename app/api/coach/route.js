import { createClient } from "@supabase/supabase-js";
import { prepareAction } from "../../../lib/coaching/actions.js";
import { conversationTurns, needsHistoricalRetrieval } from "../../../lib/coaching/context.js";
import { WORKOUT_COACH_INSTRUCTIONS } from "../../../lib/coaching/playbook.js";
import { buildCoachSystem, cleanCoachReply, PLAN_CHANGE_FROM_CHAT } from "../../../lib/coaching/system.js";
import { activePainReports, SAFE_ACTIONS_DURING_PAIN, safetyDirective } from "../../../lib/coaching/safety.js";
import { postAnthropicMessages } from "../../../lib/coaching/anthropic.js";

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

    // Pain reported in the last 48 hours and not marked resolved.
    const { data: painRows } = await supabase.from("pain_reports")
      .select("id,report,body_area,exercise_key,severity,status,reported_at")
      .eq("user_id", user.id).neq("status", "resolved")
      .gte("reported_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order("reported_at", { ascending: false }).limit(5);
    let activePain = activePainReports(painRows || []);

    // The instant stop reply is for a first pain report and for red flags.
    // Later messages while pain is active go to the coach with the
    // active-pain directive, so it can actually adapt the session.
    const safety = safetyDirective(message);
    if (safety && (safety.severity === "concerning" || !activePain.length)) {
      const payload = { message: safety.message, insights: [{ kind: "safety", text: safety.message }], actions: [], activePain: true, safetyStop: true };
      const currentExercise = body?.clientContext?.activeWorkout?.find?.((item) => item?.isCurrentExercise)?.exercise || null;
      await Promise.all([
        supabase.from("pain_reports").insert({ user_id: user.id, report: message.slice(0, 1000), body_area: safety.bodyArea, exercise_key: currentExercise, severity: safety.severity === "concerning" ? "concerning" : "unspecified" }),
        supabase.from("coach_messages").insert({ user_id: user.id, conversation_id: conversationId, role: "assistant", content: safety.message, structured_payload: payload }),
      ]);
      return Response.json({ ...payload, conversationId });
    }
    if (safety && activePain.length) {
      // A further pain mention while pain is active: keep it in the directive.
      activePain = [{ report: message, body_area: safety.bodyArea, status: "active", reported_at: new Date().toISOString() }, ...activePain];
    }

    const [{ data: rawContext, error: contextError }, { data: profile }, { data: recentTurns }] = await Promise.all([
      supabase.rpc("get_coach_recent_context", { window_days: 14 }),
      supabase.from("coach_profiles").select("personality,experience_level").eq("user_id", user.id).maybeSingle(),
      supabase.from("coach_messages").select("role,content,created_at").eq("user_id", user.id).eq("conversation_id", conversationId)
        .order("created_at", { ascending: false }).limit(11),
    ]);
    if (contextError) return Response.json({ error: "Could not load Coach context" }, { status: 500 });
    // Old coach messages are left out of the context: the model copied its
    // earlier answers and voice from them. Only this conversation's recent
    // turns are sent, as real messages.
    const { messages: _oldMessages, ...context } = rawContext || {};
    const turns = conversationTurns(recentTurns || [], message);

    let olderHistory = [];
    const usedHistoricalRetrieval = needsHistoricalRetrieval(message);
    if (usedHistoricalRetrieval) {
      const { data } = await supabase.rpc("search_training_history", { exercise_search: null, result_limit: 80 });
      olderHistory = data || [];
    }

    // Retry once when the model's reply is not valid JSON before reporting an error.
    let answer;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      const providerResponse = await postAnthropicMessages({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
          max_tokens: 1200,
          system: buildCoachSystem({
            areaInstructions: `${WORKOUT_COACH_INSTRUCTIONS}\n\n${responseShape}`,
            kind: "conversation",
            personality: profile?.personality,
            experienceLevel: profile?.experience_level,
            activePain,
            context: `14-DAY CONTEXT\n${JSON.stringify(context)}\n\nCURRENT CLIENT CONTEXT\n${JSON.stringify(body?.clientContext || null)}\n\nOLDER HISTORY RETRIEVAL\n${JSON.stringify(olderHistory)}`,
          }),
          messages: [...turns, { role: "user", content: message }],
        });
      if (!providerResponse.ok) return Response.json({ error: providerResponse.error }, { status: 502 });
      const providerPayload = providerResponse.payload;
      const text = providerPayload.content?.map((block) => block.text || "").join("") || "";
      try { answer = extractJson(text); } catch { answer = undefined; }
    }
    if (!answer) return Response.json({ error: "Coach returned an invalid response" }, { status: 502 });

    const preparedActions = [];
    // While pain is active only temporary, load-free actions are allowed.
    const proposed = (answer.actions || []).filter((raw) => !activePain.length || SAFE_ACTIONS_DURING_PAIN.has(raw?.type));
    for (const raw of proposed) {
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

    const cleaned = cleanCoachReply(answer.message);
    // A permanent change the coach could not propose (no ids in the data) gets
    // the plain CHANGE PLAN answer and a button.
    const askedForPermanent = /\b(permanent(ly)?|for good|every (week|time)|from now on|in my plan|to my plan)\b/i.test(message) && !preparedActions.some(({ action }) => action.scope === "permanent");
    const result = {
      message: cleaned.message,
      insights: (answer.insights || []).filter((insight) => !cleanCoachReply(insight?.text).planChangeHint).slice(0, 3),
      actions: storedActions || [],
      activePain: activePain.length > 0,
      planChangeHint: cleaned.planChangeHint || askedForPermanent,
    };
    if (askedForPermanent && !cleaned.planChangeHint && !result.message.includes("CHANGE PLAN")) result.message = `${result.message} ${PLAN_CHANGE_FROM_CHAT}`.trim();
    await supabase.from("coach_messages").insert({ user_id: user.id, conversation_id: conversationId, role: "assistant", content: result.message, structured_payload: result });
    return Response.json({ ...result, conversationId, usedHistoricalRetrieval });
  } catch (error) {
    console.error("Coach route error:", error.message);
    return Response.json({ error: "Coach is unavailable" }, { status: 500 });
  }
}
