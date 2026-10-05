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

// Like sendCoachMessage, but shows the reply as it is written: onPartial is
// called with the message so far. Returns the final payload.
export async function streamCoachMessage(message, conversationId, clientContext, onPartial = () => {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in to use Coach.");
  const response = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ message, conversationId, clientContext, stream: true }),
  });
  if (!response.ok || !response.body || !String(response.headers.get("content-type") || "").includes("ndjson")) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Coach is unavailable.");
    return payload;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? "" : decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "partial") onPartial(event.message);
      else if (event.type === "final") return event;
      else if (event.type === "error") throw new Error(event.error || "Coach is unavailable.");
    }
    if (done) break;
  }
  throw new Error("The coach reply was cut off. Please try again.");
}
