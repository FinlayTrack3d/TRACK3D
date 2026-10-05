import { createClient } from "@supabase/supabase-js";
import { postAnthropicMessages } from "../../../lib/coaching/anthropic.js";
import { CHAT_LIMITS, createMemoryRateLimiter, validateChatPayload } from "../../../lib/chat-limits.js";

function supabaseForToken(token) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

const memoryLimit = createMemoryRateLimiter();

// The shared limit lives in the database (chat_rate_check). If that
// function has not been installed yet, the per-instance limit still applies.
async function databaseLimit(supabase) {
  const { data, error } = await supabase.rpc("chat_rate_check", { per_minute: CHAT_LIMITS.perMinute, per_day: CHAT_LIMITS.perDay });
  if (error) {
    console.error("chat_rate_check unavailable:", error.message);
    return { ok: true };
  }
  if (data === "minute") return { ok: false, retryAfter: 60, error: `Too many coach requests. Please wait a minute (limit ${CHAT_LIMITS.perMinute} per minute).` };
  if (data === "day") return { ok: false, retryAfter: 3600, error: `Daily coach limit reached (${CHAT_LIMITS.perDay} requests per day).` };
  return { ok: true };
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

    const limited = memoryLimit(user.id);
    const allowed = limited.ok ? await databaseLimit(supabase) : limited;
    if (!allowed.ok) return Response.json({ error: allowed.error }, { status: 429, headers: { "Retry-After": String(allowed.retryAfter) } });

    if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "No API key found" }, { status: 500 });
    const result = await postAnthropicMessages({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: checked.value.maxTokens,
      system: (checked.value.system || "You are TRACK3D's AI coach.") + "\nFor conversational replies default to 1–2 short sentences and at most 60 words. Answer directly. Expand when explicitly asked for detail. Preserve complete requested JSON and structured plans.",
      messages: checked.value.messages,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status === 429 ? 429 : 502 });
    return Response.json({ content: result.payload.content });
  } catch (error) {
    console.error("Route error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
