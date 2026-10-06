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

const week = [
  { name: "Push A", days: ["SAT"], exercises: [{ name: "Bench Press", sets: 4, reps: ["8-10", "8-10", "8-10", "8-10"] }, { name: "Cable Fly", sets: 3, reps: "12-15" }] },
  { name: "Pull A", days: ["SUN"], exercises: [{ name: "Row", sets: 3, reps: ["8-12", "8-12", "8-12"] }] },
  { name: "Legs", days: ["TUE"], exercises: [] },
  { name: "Full Body Pump & Conditioning", days: ["FRI"], exercises: [{ name: "Thrusters", sets: 3, reps: "12" }] },
];

test("a whole session can be removed; its days become rest days", async () => {
  const { planChangeSummary } = await import("../lib/coaching/plan-change.js");
  const change = { kind: "remove_session", sessionName: "Full Body Pump & Conditioning", reason: "Not wanted" };
  const updated = applyPlanChangeProposal(week, [change]);
  assert.deepEqual(updated.map((session) => session.name), ["Push A", "Pull A", "Legs"]);
  assert.equal(week.length, 4, "the plan passed in is not changed");
  assert.deepEqual(planChangeSummary(week, [change]), { lines: ["FRI: Full Body Pump & Conditioning → Rest"], unmatched: [], changed: true });
});

test("the Proposed change card lists each change before → after", async () => {
  const { planChangeSummary } = await import("../lib/coaching/plan-change.js");
  const summary = planChangeSummary(week, [
    { kind: "update_session_days", sessionName: "Legs", days: ["THU"] },
    { kind: "update_prescription", sessionName: "Push A", exerciseName: "Bench Press", sets: 3, reps: "8-10" },
    { kind: "replace_exercise", sessionName: "Push A", exerciseName: "Cable Fly", replacementName: "Pec Deck", sets: 2, reps: "12-15" },
    { kind: "rename_exercise", sessionName: "Pull A", exerciseName: "Row", replacementName: "Barbell Row" },
    { kind: "add_exercise", sessionName: "Pull A", replacementName: "Face Pull", sets: 3, reps: "15" },
    { kind: "remove_exercise", sessionName: "Full Body Pump & Conditioning", exerciseName: "Thrusters" },
    { kind: "remove_exercise", sessionName: "Arms", exerciseName: "Curl" },
  ]);
  assert.deepEqual(summary.lines, [
    "TUE: Legs → Rest",
    "THU: Rest → Legs",
    "Push A · Bench Press: 4 × 8-10 → 3 × 8-10",
    "Push A: Cable Fly 3 × 12-15 → Pec Deck 2 × 12-15",
    "Pull A: Row → Barbell Row (same exercise, history kept)",
    "Pull A: + Face Pull 3 × 15",
    "Full Body Pump & Conditioning: Thrusters 3 × 12 → removed",
  ]);
  assert.deepEqual(summary.unmatched, ["Arms: remove Curl"]);
  assert.equal(planChangeSummary(week, [{ kind: "remove_session", sessionName: "Arms" }]).changed, false, "nothing to save");
});

test("approving in words is recognised, so it can be pointed to the card", async () => {
  const { isApprovalReply } = await import("../lib/coaching/plan-change.js");
  for (const text of ["i approve", "I approve", "approve", "yes, save it", "go ahead", "ok do it", "confirm"]) assert.equal(isApprovalReply(text), true, text);
  for (const text of ["yes", "is it changed", "is this saved?", "i want full body removed fully", "save"]) assert.equal(isApprovalReply(text), false, text);
});

test("the coach's reply keeps every change the app can save and never hides a dropped one", async () => {
  const { readPlanChangeReply } = await import("../lib/coaching/plan-change-reply.js");
  const removal = readPlanChangeReply({ message: "I'd take Full Body out of Friday. Tap APPROVE & SAVE to save it.", recommendation: "targeted", changes: [{ kind: "remove_session", sessionName: "Full Body Pump & Conditioning" }] });
  assert.deepEqual(removal.changes, [{ kind: "remove_session", sessionName: "Full Body Pump & Conditioning" }]);
  // A change the app can't save is never described as if it were waiting.
  const unsupported = readPlanChangeReply({ message: "Friday session removed.", recommendation: "targeted", changes: [{ kind: "delete_day", day: "FRI" }] });
  assert.deepEqual(unsupported.changes, []);
  assert.match(unsupported.message, /^I couldn't turn that into a change the app can save, so nothing is waiting for your approval\./);
  assert.equal(unsupported.recommendation, "clarify");
  const partly = readPlanChangeReply({ message: "Two changes.", recommendation: "targeted", changes: [{ kind: "remove_session", sessionName: "Legs" }, { kind: "add_session", sessionName: "Arms" }] });
  assert.equal(partly.changes.length, 1);
  assert.match(partly.message, /One part of this couldn't be prepared as a change you can approve/);
  assert.deepEqual(readPlanChangeReply({ message: "Which days suit you?", recommendation: "clarify" }), { message: "Which days suit you?", recommendation: "clarify", changes: [] });
});

test("the workout coach's permanent changes are described before → after", async () => {
  const { coachActionChangeLines } = await import("../lib/coaching/ui-actions.js");
  const swap = { type: "propose_permanent_exercise_swap", scope: "permanent", payload: { programmeExerciseId: "Bench Press", replacementExerciseName: "Dumbbell Press" } };
  assert.deepEqual(coachActionChangeLines(week, swap), ["Push A: Bench Press → Dumbbell Press"]);
  assert.deepEqual(coachActionChangeLines(week, { type: "propose_permanent_set_change", payload: { programmeExerciseId: "Row", setCount: 2 } }), ["Pull A · Row: 3 sets → 2 sets"]);
  assert.deepEqual(coachActionChangeLines([], swap), ["Swap to Dumbbell Press from now on"]);
});
