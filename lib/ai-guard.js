// Shared protection for the routes that call the AI provider (/api/chat,
// /api/coach, /api/plan-change): a size cap on the request body and one
// per-user request budget across all three, so no route can be used to run
// up the provider bill.
import { CHAT_LIMITS, createMemoryRateLimiter } from "./chat-limits.js";

const memoryLimit = createMemoryRateLimiter();
// Used only when the database check can't run. Serverless instances don't
// share memory, so it is tighter than the real limit.
const fallbackLimit = createMemoryRateLimiter({ perMinute: 4, perDay: 40 });

const tooMany = (kind) => (kind === "minute"
  ? { ok: false, retryAfter: 60, error: `Too many coach requests. Please wait a minute (limit ${CHAT_LIMITS.perMinute} per minute).` }
  : { ok: false, retryAfter: 3600, error: `Daily coach limit reached (${CHAT_LIMITS.perDay} requests per day).` });

// The shared per-user limit lives in the database (chat_rate_check).
export async function aiRequestAllowed(supabase, userId) {
  const local = memoryLimit(userId);
  if (!local.ok) return local;
  const { data, error } = await supabase.rpc("chat_rate_check", { per_minute: CHAT_LIMITS.perMinute, per_day: CHAT_LIMITS.perDay });
  if (error) {
    console.error("chat_rate_check unavailable:", error.message);
    return fallbackLimit(userId);
  }
  return data === "minute" || data === "day" ? tooMany(data) : { ok: true };
}

export const limitedResponse = (limit) => Response.json({ error: limit.error }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

// Reads a JSON body no larger than maxBytes.
export async function readJsonBody(request, maxBytes) {
  const raw = await request.text();
  if (raw.length > maxBytes) return { ok: false, status: 413, error: "This request is too large." };
  try { return { ok: true, value: JSON.parse(raw || "null") }; } catch { return { ok: false, status: 400, error: "Invalid request" }; }
}

// Characters a value takes up once sent to the model as JSON.
export const jsonSize = (value) => {
  try { return JSON.stringify(value ?? null).length; } catch { return Infinity; }
};
