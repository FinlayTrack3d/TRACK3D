import test from "node:test";
import assert from "node:assert/strict";
import { partitionRecentHistory, needsHistoricalRetrieval } from "../lib/coaching/context.js";
import { classifySafetyText, safetyDirective } from "../lib/coaching/safety.js";
import { buildCoachSystemInstructions } from "../lib/coaching/playbook.js";

test("14-day context excludes older records", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const result = partitionRecentHistory([
    { id: 1, occurred_at: "2026-09-20T12:00:00Z" },
    { id: 2, occurred_at: "2026-08-01T12:00:00Z" },
  ], now);
  assert.deepEqual(result.recent.map((x) => x.id), [1]);
  assert.deepEqual(result.older.map((x) => x.id), [2]);
});

test("historical questions trigger retrieval rather than guessing", () => {
  assert.equal(needsHistoricalRetrieval("What did I bench last year?"), true);
  assert.equal(needsHistoricalRetrieval("How was yesterday's workout?"), false);
});

test("pain language creates a stop directive and concerning symptoms escalate", () => {
  assert.deepEqual(classifySafetyText("This is difficult"), { hasPain: false, severity: "none" });
  assert.equal(safetyDirective("Sharp shoulder pain").kind, "safety_stop");
  assert.equal(classifySafetyText("Severe pain after a fall").severity, "concerning");
});

test("personality changes voice while safety and approval rules remain identical", () => {
  const strict = buildCoachSystemInstructions("strict");
  const supportive = buildCoachSystemInstructions("supportive");
  for (const instruction of [strict, supportive]) {
    assert.match(instruction, /Pain overrides progression/);
    assert.match(instruction, /require an explicit proposal followed by user approval/);
  }
  assert.notEqual(strict, supportive);
});


test("the workout coach sends this conversation's recent turns, not old messages", async () => {
  const { conversationTurns } = await import("../lib/coaching/context.js");
  const rows = [
    { role: "user", content: "current question", created_at: "5" },
    { role: "assistant", content: "answer 2", created_at: "4" },
    { role: "user", content: "question 2", created_at: "3" },
    { role: "assistant", content: "answer 1", created_at: "2" },
    { role: "user", content: "question 1", created_at: "1" },
  ];
  assert.deepEqual(conversationTurns(rows, "current question"), [
    { role: "user", content: "question 1" }, { role: "assistant", content: "answer 1" },
    { role: "user", content: "question 2" }, { role: "assistant", content: "answer 2" },
  ]);
  assert.deepEqual(conversationTurns([{ role: "assistant", content: "stop message" }], "next"), [], "never starts with the assistant");
  assert.ok(conversationTurns(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })).reverse(), "x").length <= 10);
});
