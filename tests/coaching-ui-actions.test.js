import test from "node:test";
import assert from "node:assert/strict";
import { applyCoachActionToWorkout, applyCoachActionToProgramme } from "../lib/coaching/ui-actions.js";

const workout = { id: "w1", exercises: [{ id: "bench", name: "Bench Press", sets: 3 }, { id: "row", name: "Row", sets: 3 }] };

test("temporary action updates today's workout without rewriting the programme", () => {
  const action = { id: "a1", type: "temporary_exercise_swap", scope: "today", payload: { exerciseId: "bench", replacementExerciseId: "db-bench", replacementExerciseName: "Dumbbell Bench" } };
  const updated = applyCoachActionToWorkout(workout, action);
  assert.equal(updated.exercises[0].name, "Dumbbell Bench");
  assert.equal(updated.exercises[0].temporary, true);
  assert.equal(workout.exercises[0].name, "Bench Press");
});

test("permanent set action updates the programme only after the approved event", () => {
  const sessions = [{ name: "Push", exercises: [{ programme_exercise_id: "pe1", name: "Bench Press", sets: 3 }] }];
  const updated = applyCoachActionToProgramme(sessions, { type: "propose_permanent_set_change", scope: "permanent", payload: { programmeExerciseId: "pe1", setCount: 2 } });
  assert.equal(updated[0].exercises[0].sets, 2);
  assert.equal(sessions[0].exercises[0].sets, 3);
});

test("temporary reorder follows the structured action order", () => {
  const updated = applyCoachActionToWorkout(workout, { id: "a2", type: "temporary_reorder", payload: { exerciseIds: ["row", "bench"] } });
  assert.deepEqual(updated.exercises.map((exercise) => exercise.id), ["row", "bench"]);
});

