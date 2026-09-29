import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const prescriptionFields = {
  sets: z.coerce.number().int().min(1).max(10).optional(),
  reps: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(10)]).optional(),
  tempo: z.string().min(1).optional(),
  reason: z.string().min(1),
};

const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("update_session_days"), sessionName: z.string().min(1), days: z.array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])).min(1).max(7), reason: z.string().min(1) }),
  z.object({ kind: z.literal("update_prescription"), sessionName: z.string().min(1), exerciseName: z.string().min(1), ...prescriptionFields }),
  z.object({ kind: z.literal("replace_exercise"), sessionName: z.string().min(1), exerciseName: z.string().min(1), replacementName: z.string().min(1), ...prescriptionFields }),
  z.object({ kind: z.literal("rename_exercise"), sessionName: z.string().min(1), exerciseName: z.string().min(1), replacementName: z.string().min(1), reason: z.string().min(1) }),
  z.object({ kind: z.literal("remove_exercise"), sessionName: z.string().min(1), exerciseName: z.string().min(1), reason: z.string().min(1) }),
  z.object({ kind: z.literal("add_exercise"), sessionName: z.string().min(1), replacementName: z.string().min(1), ...prescriptionFields }),
]);

const responseSchema = z.object({
  message: z.string().min(1),
  recommendation: z.enum(["clarify", "targeted", "full_rebuild"]),
  changes: z.array(changeSchema).max(16).default([]),
});

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

    const body = await request.json();
    const messages = Array.isArray(body?.messages)
      ? body.messages.slice(-12).map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: String(message.content || "").slice(0, 2000) }))
      : [];
    if (!messages.some((message) => message.role === "user" && message.content.trim())) return Response.json({ error: "A change request is required" }, { status: 400 });

    const currentPlan = Array.isArray(body?.currentPlan) ? body.currentPlan : [];
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

    const system = `You are TRACK3D's plan-change coach. Your job is to prevent unnecessary programme resets while respecting the user's goals and preferences.

First determine whether the problem needs: (1) a small targeted change to session days, exercises, sets, or reps; (2) clarification with one concise question; or (3) a full plan rebuild because the goal, training frequency, equipment, limitations, or overall structure has materially changed. Prefer targeted changes when the issue is isolated. A change to which weekdays are available normally needs update_session_days, not a full rebuild, unless the number of weekly sessions or recovery structure must also change. Do not recommend a full rebuild merely because one exercise is disliked or one prescription needs adjusting.

Use the current plan and training history. Never erase or rewrite completed workout history. Be honest when the evidence is limited. If pain or injury is mentioned, tell the user to stop the painful movement and seek qualified advice; do not diagnose.

Only propose exact targeted changes when the user has supplied enough information or explicitly accepted your recommendation. Use exact session and exercise names from CURRENT PLAN. Rep prescriptions may be a string such as "8-12" or one string per set. A replacement is a different movement; a rename is only a label correction for the same movement, and preserves its history alias. A full rebuild is never applied automatically: recommend it and explain why.

Return only JSON:
{"message":"brief collaborative reply, including at most one question","recommendation":"clarify|targeted|full_rebuild","changes":[{"kind":"update_session_days|update_prescription|replace_exercise|rename_exercise|remove_exercise|add_exercise","sessionName":"exact session","days":["MON"],"exerciseName":"exact current exercise when applicable","replacementName":"new exercise when applicable","sets":3,"reps":"8-12","tempo":"3-0-1-0","reason":"why"}]}`;

    const provider = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 1800,
        system,
        messages: [{ role: "user", content: `CURRENT PLAN\n${JSON.stringify(currentPlan)}\n\nRECENT LEGACY WORKOUTS\n${JSON.stringify(recentWorkouts)}\n\nSTRUCTURED EXERCISE HISTORY\n${JSON.stringify(structuredHistory || [])}` }, ...messages],
      }),
    });
    if (!provider.ok) return Response.json({ error: "Coach provider failed" }, { status: 502 });
    const payload = await provider.json();
    const text = payload.content?.map((block) => block.text || "").join("") || "";
    let result;
    try {
      const raw = extractJson(text);
      const validated = responseSchema.safeParse(raw);
      result = validated.success ? validated.data : {
        message: String(raw?.message || "I need one more detail before I can recommend a safe plan change."),
        recommendation: ["clarify", "targeted", "full_rebuild"].includes(raw?.recommendation) ? raw.recommendation : "clarify",
        changes: [],
      };
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
