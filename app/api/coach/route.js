import { createClient } from "@supabase/supabase-js";
import { prepareAction } from "../../../lib/coaching/actions.js";
import { conversationTurns, needsHistoricalRetrieval } from "../../../lib/coaching/context.js";
import { WORKOUT_COACH_INSTRUCTIONS, WORKOUT_RESPONSE_SHAPE as responseShape } from "../../../lib/coaching/playbook.js";
import { buildCoachSystemBlocks, cleanCoachReply, PLAN_CHANGE_FROM_CHAT, PLAN_CHANGE_NOT_PREPARED, PLAN_CHANGE_READY } from "../../../lib/coaching/system.js";
import { droppedChangesNote } from "../../../lib/coaching/plan-change-reply.js";
import { activePainReports, SAFE_ACTIONS_DURING_PAIN, safetyDirective } from "../../../lib/coaching/safety.js";
import { openAnthropicStream, partialJsonStringField, postAnthropicMessages, readAnthropicStream } from "../../../lib/coaching/anthropic.js";
import { readCoachAnswer } from "../../../lib/coaching/coach-answer.js";
import { aiRequestAllowed, jsonSize, limitedResponse, readJsonBody } from "../../../lib/ai-guard.js";

// Request limits: the whole body, the message, and the app context sent with it.
const MAX_BODY_BYTES = 150_000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTEXT_CHARS = 60_000;


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


export async function POST(request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Coach provider is not configured" }, { status: 503 });
    const supabase = supabaseForRequest(request);
    if (!supabase) return Response.json({ error: "Coach data service is not configured" }, { status: 503 });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

    const read = await readJsonBody(request, MAX_BODY_BYTES);
    if (!read.ok) return Response.json({ error: read.error }, { status: read.status });
    const body = read.value;
    const message = String(body?.message || "").trim();
    if (!message) return Response.json({ error: "Message is required" }, { status: 400 });
    if (message.length > MAX_MESSAGE_CHARS) return Response.json({ error: `That message is too long (limit ${MAX_MESSAGE_CHARS.toLocaleString("en-GB")} characters).` }, { status: 413 });
    if (jsonSize(body?.clientContext) > MAX_CONTEXT_CHARS) return Response.json({ error: "This request is too large." }, { status: 413 });

    const allowed = await aiRequestAllowed(supabase, user.id);
    if (!allowed.ok) return limitedResponse(allowed);

    // A conversation id from the request is only used if it is this user's.
    let conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
    if (conversationId) {
      const { data: owned } = await supabase.from("coach_conversations").select("id").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
      if (!owned) conversationId = null;
    }
    if (!conversationId) {
      const { data, error } = await supabase.from("coach_conversations").insert({ user_id: user.id, title: message.slice(0, 80) }).select("id").single();
      if (error) return Response.json({ error: "Could not start Coach conversation" }, { status: 500 });
      conversationId = data.id;
    }

    await supabase.from("coach_messages").insert({ user_id: user.id, conversation_id: conversationId, role: "user", content: message });

    const inWorkout = Array.isArray(body?.clientContext?.activeWorkout) && body.clientContext.activeWorkout.length > 0;

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
      // Between sets a week of context is enough; history questions fetch more below.
      supabase.rpc("get_coach_recent_context", { window_days: inWorkout && !needsHistoricalRetrieval(message) ? 7 : 14 }),
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

    const providerRequest = (maxTokens) => ({
      // ANTHROPIC_WORKOUT_MODEL lets a faster model be compared on the coach
      // test set before switching; it defaults to the main model.
      model: process.env.ANTHROPIC_WORKOUT_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      // Replies are read between sets: a short budget, raised only if cut off.
      max_tokens: maxTokens,
      system: buildCoachSystemBlocks({
        areaInstructions: `${WORKOUT_COACH_INSTRUCTIONS}\n\n${responseShape}`,
        kind: "conversation",
        personality: profile?.personality,
        experienceLevel: profile?.experience_level,
        activePain,
        context: `${inWorkout ? "7" : "14"}-DAY CONTEXT\n${JSON.stringify(context)}\n\nCURRENT CLIENT CONTEXT\n${JSON.stringify(body?.clientContext || null)}\n\nOLDER HISTORY RETRIEVAL\n${JSON.stringify(olderHistory)}`,
      }),
      messages: [...turns, { role: "user", content: message }],
    });

    // Gets the model's JSON answer. With onPartial, the first attempt streams
    // and reports the "message" text as it is written. Retries once (with a
    // bigger budget) when the reply is cut off or not valid JSON; after that
    // the readable part of the reply is used rather than an error.
    const getAnswer = async (onPartial) => {
      let lastText = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const maxTokens = attempt === 0 ? 900 : 2000;
        let text = "";
        if (onPartial && attempt === 0) {
          const opened = await openAnthropicStream(providerRequest(maxTokens));
          if (!opened.ok) return { error: opened.publicError };
          const streamed = await readAnthropicStream(opened.response, (_delta, soFar) => {
            const partial = partialJsonStringField(soFar, "message");
            if (partial) onPartial(partial);
          });
          if (!streamed.ok) return { error: streamed.publicError };
          text = streamed.text;
        } else {
          const providerResponse = await postAnthropicMessages(providerRequest(maxTokens));
          if (!providerResponse.ok) return { error: providerResponse.publicError };
          text = providerResponse.payload.content?.map((block) => block.text || "").join("") || "";
        }
        const parsed = readCoachAnswer(text);
        if (parsed.complete) return { answer: parsed.answer };
        lastText = text;
      }
      const fallback = readCoachAnswer(lastText);
      return fallback.answer ? { answer: fallback.answer } : { error: "The coach couldn't answer that just now. Please try again." };
    };

    // Actions, memory and the stored reply, once the full answer is in.
    const finish = async (answer) => {
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
      // A plan change waits in a Proposed change card under the reply.
      const proposedChange = (storedActions || []).some((action) => action.scope === "permanent");
      // A plan change the coach described but the app couldn't prepare (or
      // may not make while pain is active), or a reply pointing to APPROVE &
      // SAVE with no change of its own and none still waiting: the reply
      // must not point to a card that isn't there.
      const cardWaiting = (context.actions || []).some((action) => action?.scope === "permanent" && action?.status === "pending_approval");
      const lostPlanChange = !proposedChange && ((answer.actions || []).some((raw) => raw?.type === "propose_plan_change") || (!cardWaiting && /APPROVE\s*&\s*SAVE/i.test(cleaned.message)));
      // A permanent change the coach didn't propose gets the plain CHANGE PLAN
      // answer and a button.
      const askedForPermanent = /\b(permanent(ly)?|for good|every (week|time)|from now on|in my plan|to my plan)\b/i.test(message) && !proposedChange;
      let reply = cleaned.planChangeHint && proposedChange ? PLAN_CHANGE_READY : cleaned.message;
      if (!cleaned.planChangeHint && lostPlanChange) reply = `${reply.replace(/[^.!?\n]*APPROVE\s*&\s*SAVE[^.!?\n]*[.!?]?/gi, "").trim()} ${PLAN_CHANGE_NOT_PREPARED}`.trim();
      else if (!cleaned.planChangeHint && askedForPermanent && !reply.includes("CHANGE PLAN")) reply = `${reply} ${PLAN_CHANGE_FROM_CHAT}`.trim();
      if (proposedChange) reply += droppedChangesNote(preparedActions.reduce((total, prepared) => total + prepared.droppedChanges, 0));
      const result = {
        message: reply,
        insights: (answer.insights || []).filter((insight) => !cleanCoachReply(insight?.text).planChangeHint).slice(0, 3),
        actions: storedActions || [],
        activePain: activePain.length > 0,
        // The OPEN CHANGE PLAN button, whenever the reply points there.
        planChangeHint: !proposedChange && (cleaned.planChangeHint || askedForPermanent || lostPlanChange || /\bCHANGE PLAN\b/.test(reply)),
      };
      await supabase.from("coach_messages").insert({ user_id: user.id, conversation_id: conversationId, role: "assistant", content: result.message, structured_payload: result });
      return result;
    };

    // Streaming: newline-delimited JSON events ({type:"partial"|"final"|"error"}).
    if (body?.stream === true) {
      const encoder = new TextEncoder();
      const send = (controller, event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let lastSent = "";
            const outcome = await getAnswer((partial) => {
              if (partial !== lastSent && !cleanCoachReply(partial).planChangeHint) { lastSent = partial; send(controller, { type: "partial", message: partial }); }
            });
            if (outcome.error) send(controller, { type: "error", error: outcome.error });
            else send(controller, { type: "final", ...(await finish(outcome.answer)), conversationId, usedHistoricalRetrieval });
          } catch (error) {
            console.error("Coach stream error:", error.message);
            send(controller, { type: "error", error: "Coach is unavailable" });
          }
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
    }

    const outcome = await getAnswer();
    if (outcome.error) return Response.json({ error: outcome.error }, { status: 502 });
    const result = await finish(outcome.answer);
    return Response.json({ ...result, conversationId, usedHistoricalRetrieval });
  } catch (error) {
    console.error("Coach route error:", error.message);
    return Response.json({ error: "Coach is unavailable" }, { status: 500 });
  }
}
