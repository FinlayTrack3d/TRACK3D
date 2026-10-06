import test from "node:test";
import assert from "node:assert/strict";
import { prepareAction } from "../lib/coaching/actions.js";
import { applyPlanChangeToWorkout, planOutline } from "../lib/coaching/plan-change.js";
import { coachProposal, proposalsOverlap } from "../lib/coaching/ui-actions.js";

// The in-workout coach proposes saved-plan changes by name (the plans have
// no programme ids), shown in the same Proposed change card as Change Plan.
const plan = [
  { name: "Push A", days: ["MON"], exercises: [
    { name: "Bench Press", sets: 4, reps: ["8-10", "8-10", "8-10", "8-10"] },
    { name: "Shoulder Press", sets: 3, reps: ["10", "10", "10"] },
    { name: "Cable Fly", sets: 3, reps: ["12-15", "12-15", "12-15"] },
  ] },
  { name: "Full Body Pump", days: ["FRI"], exercises: [{ name: "Thrusters", sets: 3, reps: ["12", "12", "12"] }] },
];

test("a plan change by name waits for approval; changes the app can't apply are left out", () => {
  const prepared = prepareAction({ type: "propose_plan_change", reason: "Shoulder friendly", changes: [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Cable Fly" }] });
  assert.equal(prepared.status, "pending_approval");
  assert.equal(prepared.mayApply, false);
  assert.equal(prepared.action.scope, "permanent");
  assert.equal(prepared.droppedChanges, 0);
  const partly = prepareAction({ type: "propose_plan_change", scope: "permanent", changes: [{ kind: "remove_session", sessionName: "Full Body Pump" }, { kind: "add_session", sessionName: "Arms" }] });
  assert.deepEqual(partly.action.changes, [{ kind: "remove_session", sessionName: "Full Body Pump" }]);
  assert.equal(partly.droppedChanges, 1);
  assert.throws(() => prepareAction({ type: "propose_plan_change", changes: [{ kind: "add_session", sessionName: "Arms" }] }));
  assert.throws(() => prepareAction({ type: "propose_plan_change", changes: [] }));
});

test("the card shows each change before → after, and says when nothing in the plan matches", () => {
  const card = coachProposal(plan, { type: "propose_plan_change", payload: { reason: "Less pressing", changes: [
    { kind: "remove_session", sessionName: "Full Body Pump" },
    { kind: "update_prescription", sessionName: "Push A", exerciseName: "Bench Press", sets: 3 },
    { kind: "remove_exercise", sessionName: "Push A", exerciseName: "Dips" },
  ] } });
  assert.deepEqual(card.lines, ["FRI: Full Body Pump → Rest", "Push A · Bench Press: 4 × 8-10 → 3 × 8-10"]);
  assert.deepEqual(card.notes, ["Less pressing", "Not in your plan, so left out: Push A: remove Dips."]);
  assert.equal(card.changed, true);
  const nothing = coachProposal(plan, { type: "propose_plan_change", payload: { changes: [{ kind: "remove_exercise", sessionName: "Legs", exerciseName: "Squat" }] } });
  assert.equal(nothing.changed, false);
  assert.deepEqual(nothing.lines, ["Legs: remove Squat"]);
});

test("a newer proposal replaces a waiting one only when it changes the same thing", () => {
  const bench = (sets) => ({ type: "propose_plan_change", payload: { changes: [{ kind: "update_prescription", sessionName: "Push A", exerciseName: "Bench Press", sets }] } });
  assert.equal(proposalsOverlap(bench(3), { type: "propose_plan_change", payload: { changes: [{ kind: "update_prescription", sessionName: "push a", exerciseName: "bench press", sets: 2 }] } }), true);
  assert.equal(proposalsOverlap(bench(3), { type: "propose_plan_change", payload: { changes: [{ kind: "remove_session", sessionName: "Push A" }] } }), true);
  assert.equal(proposalsOverlap(bench(3), { type: "propose_plan_change", payload: { changes: [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Cable Fly" }] } }), false);
  assert.equal(proposalsOverlap(bench(3), { type: "propose_plan_change", payload: { changes: [{ kind: "update_session_days", sessionName: "Push A", days: ["TUE"] }] } }), false);
});

test("the coach sees every session by name, with days and prescriptions", () => {
  assert.deepEqual(planOutline(plan)[1], { name: "Full Body Pump", days: ["FRI"], exercises: [{ name: "Thrusters", prescription: "3 × 12" }] });
});

// Today's workout: Push A, on Shoulder Press with Bench Press done.
const inWorkout = () => ({
  workout: { name: "Push A", exercises: structuredClone(plan[0].exercises) },
  exerciseIdx: 1,
  setProgress: { 0: 4, 1: 1 },
  completedSets: { 0: [1, 2, 3, 4].map((setNum) => ({ weight: "60", reps: "8", setNum })), 1: [{ weight: "30", reps: "10", setNum: 1 }] },
  currentInputs: { 1: { weight: "32.5" }, 2: { reps: "14" } },
});

test("approving a removal takes an exercise not started yet out of today's workout", () => {
  const state = inWorkout();
  const next = applyPlanChangeToWorkout({ ...state, exerciseIdx: 2 }, [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Shoulder Press" }]);
  // Shoulder Press has a logged set, so it stays today.
  assert.equal(next.changed, false);
  assert.deepEqual(next.notes, ["Shoulder Press stays in today's workout because you've logged sets on it."]);

  const removed = applyPlanChangeToWorkout(state, [{ kind: "remove_exercise", sessionName: "push a", exerciseName: "cable fly" }]);
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.workout.exercises.map((exercise) => exercise.name), ["Bench Press", "Shoulder Press"]);
  assert.equal(removed.exerciseIdx, 1);
  assert.deepEqual(removed.completedSets, state.completedSets);
  assert.deepEqual(removed.currentInputs, { 1: { weight: "32.5" } });
});

test("removing an exercise before the current one moves logged sets and progress with their exercises", () => {
  const state = { ...inWorkout(), exerciseIdx: 2, setProgress: { 1: 1, 2: 0 }, completedSets: { 1: [{ weight: "30", reps: "10", setNum: 1 }] }, currentInputs: { 2: { reps: "14" } } };
  const next = applyPlanChangeToWorkout(state, [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Bench Press" }]);
  assert.deepEqual(next.workout.exercises.map((exercise) => exercise.name), ["Shoulder Press", "Cable Fly"]);
  assert.equal(next.exerciseIdx, 1, "still on Cable Fly");
  assert.deepEqual(next.completedSets, { 0: [{ weight: "30", reps: "10", setNum: 1 }] });
  assert.deepEqual(next.setProgress, { 0: 1, 1: 0 });
  assert.deepEqual(next.currentInputs, { 1: { reps: "14" } });
});

test("removing the exercise you're on moves to the next one; a workout keeps at least one exercise", () => {
  const state = { workout: { name: "Push A", exercises: structuredClone(plan[0].exercises) }, exerciseIdx: 1, setProgress: {}, completedSets: {}, currentInputs: {} };
  const next = applyPlanChangeToWorkout(state, [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Shoulder Press" }]);
  assert.equal(next.workout.exercises[next.exerciseIdx].name, "Cable Fly");
  const last = applyPlanChangeToWorkout({ ...state, exerciseIdx: 2 }, [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Cable Fly" }]);
  assert.equal(last.workout.exercises[last.exerciseIdx].name, "Shoulder Press");
  const single = { workout: { name: "Push A", exercises: [plan[0].exercises[0]] }, exerciseIdx: 0, setProgress: {}, completedSets: {}, currentInputs: {} };
  assert.equal(applyPlanChangeToWorkout(single, [{ kind: "remove_exercise", sessionName: "Push A", exerciseName: "Bench Press" }]).workout.exercises.length, 1);
});

test("fewer sets never drops below the sets already logged today", () => {
  const next = applyPlanChangeToWorkout(inWorkout(), [
    { kind: "update_prescription", sessionName: "Push A", exerciseName: "Bench Press", sets: 3 },
    { kind: "update_prescription", sessionName: "Push A", exerciseName: "Cable Fly", sets: 2, reps: "15" },
  ]);
  assert.equal(next.workout.exercises[0].sets, 4);
  assert.deepEqual(next.workout.exercises[0].reps, ["8-10", "8-10", "8-10", "8-10"]);
  assert.equal(next.workout.exercises[2].sets, 2);
  assert.deepEqual(next.workout.exercises[2].reps, ["15", "15"]);
});

test("a replacement applies today only before its first set; renames keep the logged sets", () => {
  const state = inWorkout();
  const replaced = applyPlanChangeToWorkout(state, [{ kind: "replace_exercise", sessionName: "Push A", exerciseName: "Cable Fly", replacementName: "Pec Deck" }]);
  assert.equal(replaced.workout.exercises[2].name, "Pec Deck");
  assert.deepEqual(replaced.currentInputs, { 1: { weight: "32.5" } }, "numbers typed for Cable Fly don't carry over");
  const started = applyPlanChangeToWorkout(state, [{ kind: "replace_exercise", sessionName: "Push A", exerciseName: "Bench Press", replacementName: "Dumbbell Press" }]);
  assert.equal(started.workout.exercises[0].name, "Bench Press");
  assert.match(started.notes[0], /Bench Press stays in today's workout/);
  const renamed = applyPlanChangeToWorkout(state, [{ kind: "rename_exercise", sessionName: "Push A", exerciseName: "Bench Press", replacementName: "Barbell Bench Press" }]);
  assert.equal(renamed.workout.exercises[0].name, "Barbell Bench Press");
  assert.deepEqual(renamed.workout.exercises[0].historyAliases, ["Bench Press"]);
  assert.equal(renamed.completedSets[0].length, 4);
});

test("an added exercise goes at the end; other sessions and removing today's session leave the workout as it is", () => {
  const added = applyPlanChangeToWorkout(inWorkout(), [{ kind: "add_exercise", sessionName: "Push A", replacementName: "Lateral Raise", sets: 3, reps: "15" }]);
  assert.deepEqual(added.workout.exercises.at(-1), { name: "Lateral Raise", sets: 3, reps: ["15", "15", "15"], tempo: "3-0-1-0" });
  assert.equal(added.exerciseIdx, 1);
  const elsewhere = applyPlanChangeToWorkout(inWorkout(), [{ kind: "remove_session", sessionName: "Full Body Pump" }, { kind: "update_session_days", sessionName: "Push A", days: ["TUE"] }]);
  assert.equal(elsewhere.changed, false);
  assert.deepEqual(elsewhere.notes, []);
  const today = applyPlanChangeToWorkout(inWorkout(), [{ kind: "remove_session", sessionName: "Push A" }]);
  assert.equal(today.changed, false);
  assert.deepEqual(today.notes, ["Today's Push A carries on as it is."]);
});
