import { createClient } from "@supabase/supabase-js";
import { openAnthropicStream, postAnthropicMessages, readAnthropicStream } from "../../../lib/coaching/anthropic.js";
import { CHAT_LIMITS, validateChatPayload } from "../../../lib/chat-limits.js";
import { aiRequestAllowed, limitedResponse } from "../../../lib/ai-guard.js";
import { areaMaxTokens, chatArea } from "../../../lib/coaching/chat-areas.js";
import { buildCoachSystemBlocks } from "../../../lib/coaching/system.js";
import { activePainReports, bodyAreaOf, classifySafetyText } from "../../../lib/coaching/safety.js";

function supabaseForToken(token) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

// Coach settings and recent unresolved pain, read with the user's own token.
async function coachState(supabase, userId, latestUserText) {
  const [profileResult, painResult] = await Promise.all([
    supabase.from("coach_profiles").select("personality,experience_level").eq("user_id", userId).maybeSingle(),
    supabase.from("pain_reports").select("report,body_area,exercise_key,status,reported_at").eq("user_id", userId).neq("status", "resolved")
      .gte("reported_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).order("reported_at", { ascending: false }).limit(5),
  ]);
  const activePain = activePainReports(painResult.data || []);
  // Pain mentioned in this message counts too, even before it is recorded.
  if (latestUserText && classifySafetyText(latestUserText).hasPain) {
    activePain.unshift({ report: latestUserText.slice(0, 300), body_area: bodyAreaOf(latestUserText), status: "active", reported_at: new Date().toISOString() });
  }
  return { personality: profileResult.data?.personality || "balanced", experienceLevel: profileResult.data?.experience_level || null, activePain };
}

export async function POST(request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Unauthorised" }, { status: 401 });
    const supabase = supabaseForToken(token);
    if (!supabase) return Response.json({ error: "Chat data service is not configured" }, { status: 503 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

    const raw = await request.text();
    if (raw.length > CHAT_LIMITS.maxBodyBytes) return Response.json({ error: "This request is too large." }, { status: 413 });
    let payload;
    try { payload = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
    const checked = validateChatPayload(payload);
    if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });
    // Instructions come from the server, never from the request.
    const area = chatArea(checked.value.area);
    if (!area) return Response.json({ error: "Unknown coach area" }, { status: 400 });

    const allowed = await aiRequestAllowed(supabase, user.id);
    if (!allowed.ok) return limitedResponse(allowed);

    if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Coach provider is not configured" }, { status: 503 });
    const latestUser = [...checked.value.messages].reverse().find((message) => message.role === "user");
    const latestUserText = typeof latestUser?.content === "string" ? latestUser.content : "";
    const state = await coachState(supabase, user.id, area.kind === "conversation" ? latestUserText : "");
    const system = buildCoachSystemBlocks({
      areaInstructions: area.instructions,
      kind: area.kind,
      personality: state.personality,
      experienceLevel: state.experienceLevel,
      activePain: area.kind === "conversation" ? state.activePain : [],
      context: checked.value.context,
    });
    const providerRequest = {
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      // The reply length is set by the area on the server; the request can only ask for less.
      max_tokens: Math.min(checked.value.maxTokens, areaMaxTokens(area)),
      system,
      messages: checked.value.messages,
    };
    // Conversations stream as plain text so the first words show at once.
    if (checked.value.stream && area.kind === "conversation") {
      const opened = await openAnthropicStream(providerRequest);
      if (!opened.ok) return Response.json({ error: opened.publicError }, { status: opened.status === 429 ? 429 : 502 });
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const streamed = await readAnthropicStream(opened.response, (delta) => controller.enqueue(encoder.encode(delta)));
          const failure = !streamed.ok ? streamed.publicError : !streamed.text.trim() ? "The coach sent an empty reply. Please try again." : null;
          // A failure part-way through is marked so the client shows an error, not a cut-off reply.
          if (failure) controller.enqueue(encoder.encode(`\u0000ERROR:${failure}`));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Coach-Stream": "1" } });
    }
    const result = await postAnthropicMessages(providerRequest);
    if (!result.ok) return Response.json({ error: result.publicError }, { status: result.status === 429 ? 429 : 502 });
    return Response.json({ content: result.payload.content });
  } catch (error) {
    console.error("Route error:", error.message);
    return Response.json({ error: "The coach couldn't answer that just now. Please try again." }, { status: 500 });
  }
}
