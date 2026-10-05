import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAbsent, checkBeginnerJargon, checkMentions, checkNoBlame, checkNoDiagnosis, checkNoInternalTerms,
  checkNumbersFromData, checkPainRespected, checkPraiseHasEvidence, checkTonesDiffer,
} from "../lib/coaching/eval-checks.js";

// The failing replies quoted in the coach review must be caught.
test("the review's bad replies fail their checks", () => {
  assert.equal(checkNoBlame("…or you've just confirmed that quitting is your new pattern.").length, 1);
  assert.equal(checkPainRespected("Drop to 16kg or 18kg and finish the workout as prescribed: 4 × 10.", { movement: "shoulder press", area: "shoulder" }).length, 1);
  assert.equal(checkPainRespected("Try a plank instead — it avoids the shoulder completely.", { movement: "shoulder press", area: "shoulder" }).length, 1);
  assert.equal(checkNoDiagnosis("That sounds like potential nerve involvement, so rest it.").length, 1);
  assert.equal(checkNoInternalTerms("I need a programme_exercise_id to do it.").length, 1);
  assert.equal(checkBeginnerJargon("That set was in the stimulus zone.").length, 1);
  assert.equal(checkPraiseHasEvidence("Strong training volume of 2180 kg this week.").length, 1);
  assert.equal(checkMentions("Aim for 140–156 g of protein a day.", /\b115\s?g\b/, "quote the app's 115 g target").length, 1);
});

test("good replies pass", () => {
  assert.deepEqual(checkNoBlame("Two solid sets in already — take 2.5 kg off for the last one."), []);
  assert.deepEqual(checkPainRespected("Stop the shoulder press for today. Do leg press instead — it should keep load off your shoulder; stop if it hurts, and see a physio if it continues.", { movement: "shoulder press", area: "shoulder" }), []);
  assert.deepEqual(checkNoDiagnosis("I can't say what's causing it — get it checked by a physio if it keeps hurting."), []);
  assert.deepEqual(checkBeginnerJargon("Stop each set with about 2 reps left in the tank."), []);
  assert.deepEqual(checkBeginnerJargon("Aim for RIR 2, which means you could have done 2 more reps."), []);
  assert.deepEqual(checkPraiseHasEvidence("Great work — 5 kg more on bench than last Push A."), []);
  assert.deepEqual(checkMentions("Your app target is 115 g a day.", /\b115\s?g\b/, "quote the target"), []);
  assert.deepEqual(checkAbsent("Your total doesn't include the pizza yet.", /under target/i, "calls the day under target"), []);
});

test("numbers must come from the data", () => {
  assert.deepEqual(checkNumbersFromData("You lifted 80 kg for 6 on bench.", [80, 6]), []);
  assert.match(checkNumbersFromData("You lifted 85 kg.", [80])[0], /85/);
});

test("identical or near-identical tones are flagged", () => {
  assert.equal(checkTonesDiffer({ strict: "Drop 2.5 kg.", balanced: "Drop 2.5 kg.", supportive: "Nice work so far — drop 2.5 kg for the last set." }).length, 1);
  assert.deepEqual(checkTonesDiffer({ strict: "Below target. Drop 2.5 kg and finish the set.", balanced: "You missed the 8–10 range, so the weight is heavy today; take 2.5 kg off.", supportive: "Two good sets done — take 2.5 kg off and give the last one a go." }), []);
});
