import test from "node:test";
import assert from "node:assert/strict";
import { readCoachAnswer } from "../lib/coaching/coach-answer.js";

test("full JSON, with or without text around it", () => {
  assert.equal(readCoachAnswer('{"message":"Do 3 × 8 at 80 kg.","insights":[]}').answer.message, "Do 3 × 8 at 80 kg.");
  const wrapped = readCoachAnswer('Here is my answer:\n```json\n{"message":"RIR 1–2 on the last set.","actions":[]}\n```');
  assert.equal(wrapped.complete, true);
  assert.equal(wrapped.answer.message, "RIR 1–2 on the last set.");
});

test("a cut-off reply keeps its message instead of an error", () => {
  const cut = readCoachAnswer('{"message":"For hypertrophy aim for 10–20 hard sets per muscle a week.","insights":[{"kind":"progress","text":"Bench up 5');
  assert.equal(cut.complete, false);
  assert.equal(cut.answer.message, "For hypertrophy aim for 10–20 hard sets per muscle a week.");
});

test("plain text instead of JSON is used as the message", () => {
  assert.equal(readCoachAnswer("Take 90 seconds, then the next set.").answer.message, "Take 90 seconds, then the next set.");
  assert.equal(readCoachAnswer("").answer, null);
  assert.equal(readCoachAnswer('{"insights":[]}').answer, null);
});
