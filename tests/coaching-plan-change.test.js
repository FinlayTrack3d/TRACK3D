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

test("targeted prescription changes preserve the exercise and keep the approved plan", () => {
  const updated = applyPlanChangeProposal(plan, [{ kind: "update_prescription", sessionName: "Push", exerciseName: "Bench Press", sets: 4, reps: "6-8" }]);
  assert.equal(updated[0].exercises[0].name, "Bench Press");
  assert.equal(updated[0].exercises[0].sets, 4);
  assert.deepEqual(updated[0].exercises[0].reps, ["6-8", "6-8", "6-8", "6-8"]);
  assert.deepEqual(updated[0].approval, { approved: true });
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
  assert.deepEqual(updated[0].approval, { approved: true });
});

test("plan change requests are recognised so they go through approve-and-save", async () => {
  const { isPlanChangeRequest } = await import("../lib/coaching/plan-change.js");
  assert.equal(isPlanChangeRequest("Change one exercise from 4 sets to 3"), true);
  assert.equal(isPlanChangeRequest("Can I swap an exercise?"), true);
  assert.equal(isPlanChangeRequest("Move Pull A to Thursday"), true);
  assert.equal(isPlanChangeRequest("What should I train today?"), false);
  assert.equal(isPlanChangeRequest("How should I progress this week?"), false);
  // Questions about changes are answered, not routed to Change Plan.
  assert.equal(isPlanChangeRequest("Should I add a set to bench press?"), false);
  assert.equal(isPlanChangeRequest("Why did you reduce my reps on Row?"), false);
  assert.equal(isPlanChangeRequest("Would it be better to drop Friday's session?"), false);
  assert.equal(isPlanChangeRequest("Is it worth adding another leg day?"), false);
  // Requests, including politely phrased ones, still go to Change Plan.
  assert.equal(isPlanChangeRequest("Can you change Row from 3 sets to 4?"), true);
  assert.equal(isPlanChangeRequest("Could you move Pull A to Thursday?"), true);
  assert.equal(isPlanChangeRequest("Please swap the Leg Press exercise for Hack Squat"), true);
  assert.equal(isPlanChangeRequest("I want to drop one exercise from Push A"), true);
  assert.equal(isPlanChangeRequest("Dumbbell Bench Press change from 3 sets to 4 sets in upper a"), true);
});

test("the review's training questions are answered; rebuild and shorten requests still go to Change Plan", async () => {
  const { isPlanChangeRequest } = await import("../lib/coaching/plan-change.js");
  assert.equal(isPlanChangeRequest("how many hard sets per week am I getting for chest and back, how close to failure should I train, and when should I deload?"), false);
  assert.equal(isPlanChangeRequest("I think my plan needs a deload"), false);
  assert.equal(isPlanChangeRequest("Rebuild my plan for 3 days a week"), true);
  assert.equal(isPlanChangeRequest("Shorten Push A to 40 minutes"), true);
});
