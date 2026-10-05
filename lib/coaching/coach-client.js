import { supabase } from "../supabase.js";

export async function sendCoachMessage(message, conversationId, clientContext) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in to use Coach.");
  const response = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ message, conversationId, clientContext }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Coach is unavailable.");
  return payload;
}

// Marks every unresolved pain report as resolved. Returns { ok, error }.
export async function resolveActivePain() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("pain_reports")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("user_id", session.user.id).neq("status", "resolved");
  return error ? { ok: false, error: error.message } : { ok: true };
}
