import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProgression, inferIncrement, detectPersonalBest } from "../lib/coaching/progression.js";

const sets = (...reps) => reps.map((value) => ({ reps: value }));

test("Week 1 calibration handles heavy, suitable, light, and extreme attempts", () => {
  assert.equal(evaluateProgression({ week: 1, repRange: "8-10", sets: sets(6) }).decision, "calibrate_down");
  assert.equal(evaluateProgression({ week: 1, repRange: "8-10", sets: sets(9) }).decision, "calibrated");
  assert.equal(evaluateProgression({ week: 1, repRange: "8-10", sets: sets(12) }).decision, "calibrate_up");
  assert.equal(evaluateProgression({ week: 1, repRange: "8-10", sets: sets(15) }).decision, "calibrate_up_large");
});

test("straight sets progress together only after the exercise earns it", () => {
  const result = evaluateProgression({ repRange: "8-10", currentWeight: 80, sets: sets(10, 10, 10), equipmentHistory: [75, 77.5, 80] });
  assert.equal(result.decision, "progress");
  assert.equal(result.nextWeight, 82.5);
  assert.equal(evaluateProgression({ repRange: "8-10", currentWeight: 80, sets: sets(10, 9, 8) }).decision, "hold");
});

test("repeated overshoot checks rest and execution before progressing", () => {
  const input = { repRange: "8-10", currentWeight: 80, sets: sets(13, 11, 9), repeatedOvershoot: true };
  assert.equal(evaluateProgression(input).decision, "check_execution");
  assert.equal(evaluateProgression({ ...input, restAppropriate: true, executionAppropriate: true }).decision, "progress_pattern");
});

test("newly progressed straight sets are not reversed after one ordinary exposure", () => {
  const result = evaluateProgression({ repRange: "8-10", currentWeight: 82.5, sets: sets(9, 8, 7), previousExposure: { decision: "progress" } });
  assert.equal(result.decision, "hold_new_load");
});

test("large relative equipment jumps require review", () => {
  assert.equal(inferIncrement({ currentWeight: 10, equipmentHistory: [10, 12] }).largeRelativeJump, true);
  assert.equal(evaluateProgression({ repRange: "8-10", currentWeight: 10, sets: sets(10, 10, 10), equipmentHistory: [10, 12] }).decision, "review_large_jump");
});

test("plateau produces a target before suggesting programme change", () => {
  const result = evaluateProgression({ repRange: "8-10", currentWeight: 30, sets: sets(9, 9, 9), consecutiveStalledExposures: 3 });
  assert.equal(result.decision, "plateau_target");
  assert.match(result.cue, /30 × 10/);
});

test("pain always overrides progression", () => {
  const result = evaluateProgression({ repRange: "8-10", currentWeight: 80, sets: sets(10, 10, 10), pain: true });
  assert.equal(result.decision, "safety_stop");
  assert.equal(result.nextWeight, null);
});

test("top and back-off tracks progress independently only when deliberate", () => {
  const results = evaluateProgression({ prescriptionType: "top_backoff", tracks: [
    { id: "top", repRange: "5-6", currentWeight: 100, sets: sets(6) },
    { id: "backoff", repRange: "8-10", currentWeight: 80, sets: sets(9, 8) },
  ] });
  assert.equal(results[0].decision, "progress");
  assert.equal(results[1].decision, "hold");
});

test("PB detection does not reward total-volume gaming", () => {
  assert.equal(detectPersonalBest({ weight: 82.5, reps: 7 }, [{ weight: 80, reps: 10 }]).type, "weight_pb");
  assert.equal(detectPersonalBest({ weight: 80, reps: 11 }, [{ weight: 80, reps: 10 }]).type, "rep_pb");
  assert.equal(detectPersonalBest({ weight: 70, reps: 10 }, [{ weight: 80, reps: 8 }]), null);
});


test("an uneven set pattern only asks for a rest and form check after repeated overshoot", () => {
  // The app does not record repeated overshoot yet, so a single uneven
  // workout holds the load instead of showing CHECK REST & FORM.
  const result = evaluateProgression({ repRange: "8-10", currentWeight: 80, sets: sets(13, 11, 9) });
  assert.equal(result.decision, "hold");
  assert.notEqual(result.cue, "CHECK REST & FORM");
});

test("each set is judged against its own rep range", () => {
  // 6-8, 6-8, 8-10 and a 6-rep back-off set: all at the top of their own range.
  const result = evaluateProgression({ repRange: "6-8", repRanges: ["6-8", "6-8", "8-10", "6"], currentWeight: 60, sets: sets(8, 8, 10, 6) });
  assert.equal(result.decision, "progress");
  assert.equal(result.nextWeight, 62.5);
  assert.equal(evaluateProgression({ repRange: "6-8", repRanges: ["6-8", "6-8", "8-10", "6"], currentWeight: 60, sets: sets(8, 8, 9, 6) }).decision, "hold");
  assert.equal(evaluateProgression({ repRange: "6-8", currentWeight: 60, sets: sets(8, 8, 10, 6) }).decision, "hold", "one range for all sets, as before");
});

test("a warm-up next to the working weight isn't taken as the weight step", () => {
  assert.equal(inferIncrement({ currentWeight: 42.5, equipmentHistory: [20, 42.5] }).increment, 2.5);
  assert.equal(inferIncrement({ currentWeight: 50, equipmentHistory: [40, 45, 50] }).increment, 5);
  assert.equal(inferIncrement({ currentWeight: 42.5, equipmentHistory: [40, 42.5, 45] }).increment, 2.5);
});
