import test from "node:test";
import assert from "node:assert/strict";
import { prepareAction, requiresApproval } from "../lib/coaching/actions.js";

test("temporary workout changes are ready but expire through override scope", () => {
  const prepared = prepareAction({
    type: "temporary_exercise_swap",
    workoutId: "10000000-0000-4000-8000-000000000001",
    exerciseId: "bench",
    replacementExerciseId: "db-bench",
    reason: "Bench is occupied",
    scope: "today",
  });
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.mayApply, true);
  assert.equal(requiresApproval(prepared.action), false);
});

test("permanent exercise and set changes cannot apply before approval", () => {
  const exercise = prepareAction({
    type: "propose_permanent_exercise_swap",
    programmeExerciseId: "20000000-0000-4000-8000-000000000001",
    replacementExerciseId: "incline-db-press",
    reason: "User explicitly dislikes the current movement",
    scope: "permanent",
  });
  const sets = prepareAction({
    type: "propose_permanent_set_change",
    programmeExerciseId: "20000000-0000-4000-8000-000000000001",
    setCount: 2,
    reason: "Recovery pattern supports lower volume",
    scope: "permanent",
  });
  assert.equal(exercise.status, "pending_approval");
  assert.equal(sets.status, "pending_approval");
  assert.equal(exercise.mayApply, false);
  assert.equal(sets.mayApply, false);
});

test("unknown model actions are rejected by schema validation", () => {
  assert.throws(() => prepareAction({ type: "delete_programme", scope: "permanent" }));
});

