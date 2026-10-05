import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_LIMITS, createMemoryRateLimiter, recentChatMessages, validateChatPayload } from "../lib/chat-limits.js";

const user = (content) => ({ role: "user", content });

test("valid chat payloads pass and are trimmed to role and content", () => {
  const result = validateChatPayload({ area: "dashboard", context: "data", messages: [{ ...user("Hi"), extra: 1 }], responseTokens: 6000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.messages, [user("Hi")]);
  assert.equal(result.value.maxTokens, 6000);
  assert.equal(validateChatPayload({ area: "dashboard", messages: [user("Hi")], responseTokens: 99999 }).value.maxTokens, 6000);
  assert.equal(validateChatPayload({ area: "dashboard", messages: [user("Hi")] }).value.maxTokens, 1000);
  assert.equal(validateChatPayload({ area: "dashboard", messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }] }).ok, true);
});

test("oversized or malformed payloads are rejected", () => {
  assert.equal(validateChatPayload({ messages: [user("x")] }).status, 400, "area is required");
  assert.equal(validateChatPayload({ area: "dashboard", messages: [] }).status, 400);
  assert.equal(validateChatPayload({ area: "dashboard", messages: [{ role: "system", content: "x" }] }).status, 400);
  assert.equal(validateChatPayload({ area: "dashboard", messages: [{ role: "user", content: [{ type: "image", source: {} }] }] }).status, 400);
  assert.equal(validateChatPayload({ area: "dashboard", messages: [user("x")], context: { evil: true } }).status, 400);
  const tooMany = Array.from({ length: CHAT_LIMITS.maxMessages + 1 }, (_, i) => (i % 2 ? { role: "assistant", content: "a" } : user("u")));
  assert.equal(validateChatPayload({ area: "dashboard", messages: tooMany }).status, 413);
  const tooLong = validateChatPayload({ area: "dashboard", context: "s".repeat(10), messages: [user("x".repeat(CHAT_LIMITS.maxInputChars))] });
  assert.equal(tooLong.status, 413);
  assert.match(tooLong.error, /too long/);
});

test("the per-instance limiter allows a burst up to the minute limit", () => {
  let clock = 0;
  const check = createMemoryRateLimiter({ perMinute: 3, perDay: 5, now: () => clock });
  assert.equal(check("a").ok, true); assert.equal(check("a").ok, true); assert.equal(check("a").ok, true);
  assert.equal(check("a").ok, false);
  assert.equal(check("b").ok, true, "other users are unaffected");
  clock = 61_000;
  assert.equal(check("a").ok, true); assert.equal(check("a").ok, true);
  const daily = check("a");
  assert.equal(daily.ok, false);
  assert.match(daily.error, /Daily/);
  clock = 86_400_000 + 62_000;
  assert.equal(check("a").ok, true);
});

test("long chats keep only recent turns, starting with the user", () => {
  const short = [{ role: "assistant", content: "feedback" }, user("q")];
  assert.deepEqual(recentChatMessages(short), short, "short chats are unchanged");
  const long = Array.from({ length: 35 }, (_, i) => (i % 2 ? { role: "assistant", content: `a${i}` } : user(`u${i}`)));
  const recent = recentChatMessages(long, 30);
  assert.equal(recent[0].role, "user");
  assert.ok(recent.length <= 30);
  assert.equal(recent.at(-1).content, "u34");
});
