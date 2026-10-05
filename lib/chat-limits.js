// Limits for /api/chat: request size, message shape and per-user rate.

export const CHAT_LIMITS = {
  maxBodyBytes: 200_000, // raw request body
  maxMessages: 40,
  maxInputChars: 60_000, // system prompt + every message, in characters
  perMinute: 10,
  perDay: 150,
};

const textOf = (content) => (typeof content === "string"
  ? content
  : Array.isArray(content) ? content.map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : null)) : null);

// Returns { ok: true, value } or { ok: false, status, error }.
export function validateChatPayload(payload, limits = CHAT_LIMITS) {
  const { messages, context, area, responseTokens } = payload || {};
  if (typeof area !== "string" || !area) return { ok: false, status: 400, error: "area is required" };
  if (!Array.isArray(messages) || !messages.length) return { ok: false, status: 400, error: "messages must be a non-empty list" };
  if (messages.length > limits.maxMessages) return { ok: false, status: 413, error: `Too many messages (${messages.length}); the limit is ${limits.maxMessages}.` };
  if (context !== undefined && context !== null && typeof context !== "string") return { ok: false, status: 400, error: "context must be text" };
  let chars = (context || "").length;
  for (const message of messages) {
    if (!message || !["user", "assistant"].includes(message.role)) return { ok: false, status: 400, error: "each message needs a user or assistant role" };
    const text = textOf(message.content);
    if (text === null || (Array.isArray(text) && text.some((part) => part === null))) return { ok: false, status: 400, error: "message content must be text" };
    chars += Array.isArray(text) ? text.reduce((total, part) => total + part.length, 0) : text.length;
  }
  if (chars > limits.maxInputChars) return { ok: false, status: 413, error: `This request is too long (${chars.toLocaleString("en-GB")} characters); the limit is ${limits.maxInputChars.toLocaleString("en-GB")}.` };
  return {
    ok: true,
    value: {
      messages: messages.map(({ role, content }) => ({ role, content })),
      area,
      context: context || "",
      stream: payload.stream === true,
      maxTokens: Number.isInteger(responseTokens) ? Math.min(6000, Math.max(1000, responseTokens)) : 1000,
      chars,
    },
  };
}

// Per-instance sliding window. Serverless instances do not share memory, so
// this only stops bursts within one instance; the database check
// (chat_rate_check) is the real per-user limit when it is installed.
export function createMemoryRateLimiter({ perMinute = CHAT_LIMITS.perMinute, perDay = CHAT_LIMITS.perDay, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function check(userId) {
    const time = now();
    const recent = (hits.get(userId) || []).filter((stamp) => time - stamp < 86_400_000);
    const lastMinute = recent.filter((stamp) => time - stamp < 60_000).length;
    if (lastMinute >= perMinute) return { ok: false, retryAfter: 60, error: `Too many coach requests. Please wait a minute (limit ${perMinute} per minute).` };
    if (recent.length >= perDay) return { ok: false, retryAfter: 3600, error: `Daily coach limit reached (${perDay} requests per day).` };
    recent.push(time);
    hits.set(userId, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    return { ok: true };
  };
}

// Keeps a long chat inside the message limit instead of failing: once a
// conversation is longer than max, only the most recent turns are sent,
// starting with a user message. Shorter conversations are sent unchanged.
export function recentChatMessages(messages = [], max = 30) {
  const all = messages.map(({ role, content }) => ({ role, content }));
  if (all.length <= max) return all;
  const recent = all.slice(-max);
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent;
}
