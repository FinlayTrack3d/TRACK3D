import test from "node:test";
import assert from "node:assert/strict";
import { activePainDirective, activePainReports, bodyAreaOf, classifySafetyText, safetyDirective, SAFETY_MESSAGES } from "../lib/coaching/safety.js";

test("pain reports are recognised", () => {
  assert.equal(classifySafetyText("Sharp pain in my left shoulder on that last rep.").severity, "pain");
  assert.equal(classifySafetyText("My knee hurts on squats").hasPain, true);
  assert.equal(classifySafetyText("I think I tweaked my back").hasPain, true);
});

test("negated phrases and normal soreness are not pain reports", () => {
  for (const text of [
    "what can I do instead for chest today that won't hurt it?",
    "Is there an alternative that doesn't hurt?",
    "No pain at all today",
    "Felt pain-free on presses",
    "Legs have DOMS from Monday",
    "Sore in a good way after yesterday",
    "just a bit sore, nothing else",
  ]) assert.equal(classifySafetyText(text).hasPain, false, text);
  assert.equal(classifySafetyText("It doesn't hurt now but my elbow hurts on curls").hasPain, true, "a real report alongside a negation still counts");
});

test("red flags are concerning and say to get medical help promptly", () => {
  for (const text of ["I have chest pain", "I feel faint", "numbness down my arm", "tingling in my fingers", "I can't bear weight on it", "I heard a pop and it's getting worse"]) {
    assert.equal(classifySafetyText(text).severity, "concerning", text);
  }
  assert.match(safetyDirective("I have chest pain").message, /medical help promptly/);
  assert.match(SAFETY_MESSAGES.concerning, /999/);
});

test("the first stop message says when to see a professional and offers to adapt", () => {
  const stop = safetyDirective("Sharp pain in my left shoulder on that last rep.");
  assert.equal(stop.kind, "safety_stop");
  assert.equal(stop.bodyArea, "shoulder");
  assert.match(stop.message, /physio or doctor/);
  assert.match(stop.message, /sharp, getting worse, or still there/);
  assert.match(stop.message, /adapt the rest of today/);
  assert.doesNotMatch(stop.message, /strain|tendon|nerve|impingement/i, "no diagnosis");
});

test("pain stays active for 48 hours unless resolved", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const reports = [
    { report: "shoulder", status: "active", reported_at: "2026-10-05T11:00:00Z" },
    { report: "old knee", status: "active", reported_at: "2026-10-02T11:00:00Z" },
    { report: "fixed back", status: "resolved", reported_at: "2026-10-05T10:00:00Z" },
  ];
  assert.deepEqual(activePainReports(reports, now).map((report) => report.report), ["shoulder"]);
  assert.equal(bodyAreaOf("pain in my lower back"), "lower back");
});

test("the active-pain directive forbids loading the painful area", () => {
  const directive = activePainDirective([{ report: "Sharp pain in my left shoulder on that last rep.", body_area: "shoulder", exercise_key: "Dumbbell Shoulder Press" }]);
  assert.match(directive, /^ACTIVE PAIN/);
  assert.match(directive, /shoulder, during Dumbbell Shoulder Press/);
  assert.match(directive, /Never say to finish it "as prescribed"/);
  assert.match(directive, /temporary_exercise_swap/);
  assert.match(directive, /physio or doctor/);
  assert.match(directive, /Never diagnose/);
  assert.equal(activePainDirective([]), "");
});
