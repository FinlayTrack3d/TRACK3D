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
