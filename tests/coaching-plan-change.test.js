import test from "node:test";
import assert from "node:assert/strict";
import { applyPlanChangeProposal, exerciseMatchesHistory } from "../lib/coaching/plan-change.js";

const plan = [{
  name: "Push",
  approval: { approved: true },
  exercises: [
    { name: "Bench Press", sets: 3, reps: ["8-10", "8-10", "8-10"], tempo: "3-0-1-0" },
    { name: "Cable Fly", sets: 3, reps: ["10-12", "10-12", "10-12"] },
  ],
}];

test("targeted prescription changes preserve the exercise and invalidate plan approval", () => {
  const updated = applyPlanChangeProposal(plan, [{ kind: "update_prescription", sessionName: "Push", exerciseName: "Bench Press", sets: 4, reps: "6-8" }]);
  assert.equal(updated[0].exercises[0].name, "Bench Press");
  assert.equal(updated[0].exercises[0].sets, 4);
  assert.deepEqual(updated[0].exercises[0].reps, ["6-8", "6-8", "6-8", "6-8"]);
  assert.equal(updated[0].approval, null);
  assert.equal(plan[0].exercises[0].sets, 3);
});

test("a label-only rename carries the old name as a history alias", () => {
  const updated = applyPlanChangeProposal(plan, [{ kind: "rename_exercise", sessionName: "Push", exerciseName: "Bench Press", replacementName: "Barbell Bench Press" }]);
  assert.equal(exerciseMatchesHistory(updated[0].exercises[0], "Bench Press"), true);
  assert.equal(exerciseMatchesHistory(updated[0].exercises[0], "Barbell Bench Press"), true);
});

test("replacing one exercise does not merge the old movement's performance history", () => {
  const updated = applyPlanChangeProposal(plan, [{ kind: "replace_exercise", sessionName: "Push", exerciseName: "Cable Fly", replacementName: "Pec Deck", sets: 2, reps: "12-15" }]);
  assert.equal(updated[0].exercises[1].name, "Pec Deck");
  assert.equal(exerciseMatchesHistory(updated[0].exercises[1], "Cable Fly"), false);
  assert.deepEqual(updated[0].exercises[1].reps, ["12-15", "12-15"]);
});

test("the coach can move a session without rebuilding its exercises", () => {
  const updated = applyPlanChangeProposal(plan, [{ kind: "update_session_days", sessionName: "Push", days: ["TUE", "SAT"], reason: "Availability changed" }]);
  assert.deepEqual(updated[0].days, ["TUE", "SAT"]);
  assert.deepEqual(updated[0].exercises, plan[0].exercises);
  assert.equal(updated[0].approval, null);
});
