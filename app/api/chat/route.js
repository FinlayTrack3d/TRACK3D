import { createClient } from "@supabase/supabase-js";

function supabaseForToken(token) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

export async function POST(request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Unauthorised" }, { status: 401 });
    const supabase = supabaseForToken(token);
    if (!supabase) return Response.json({ error: "Chat data service is not configured" }, { status: 503 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

    const { messages, system, responseTokens } = await request.json();
    const key = process.env.ANTHROPIC_API_KEY;
    
    if (!key) {
      return Response.json({ error: "No API key found" }, { status: 500 });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: Number.isInteger(responseTokens) ? Math.min(6000, Math.max(1000, responseTokens)) : 1000,
        system: (system || "You are TRACK3D's AI coach.") + "\nFor conversational replies default to 1–2 short sentences and at most 60 words. Answer directly. Expand when explicitly asked for detail. Preserve complete requested JSON and structured plans.",
        messages: messages,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("Anthropic error:", JSON.stringify(data));
      return Response.json({ error: data.error?.message || "Anthropic error" }, { status: 500 });
    }
    
    return Response.json({ content: data.content });
  } catch (error) {
    console.error("Route error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}