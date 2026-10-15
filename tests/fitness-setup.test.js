import test from "node:test";
import assert from "node:assert/strict";
import { trainingDaysAnswer } from "../lib/coaching/questionnaire.js";
import { EXERCISE_LIBRARY, canonicalExerciseName } from "../lib/exercise-swaps.js";
import { sessionNameSuggestions } from "../lib/starter-plans.js";

test("the days question: ticked days give the count, flexible needs one, a mismatch is caught", () => {
  assert.deepEqual(trainingDaysAnswer({ preferred_days: ["MON", "WED", "FRI"] }).count, 3);
  assert.equal(trainingDaysAnswer({ preferred_days: ["FLEXIBLE"] }).complete, false);
  assert.equal(trainingDaysAnswer({ preferred_days: ["FLEXIBLE"], days_per_week: "4 days" }).count, 4);
  const mismatch = trainingDaysAnswer({ preferred_days: ["MON", "WED"], days_said: "3 days" });
  assert.deepEqual(mismatch.mismatch, { picked: 2, said: 3 });
  assert.equal(mismatch.complete, false);
  assert.equal(trainingDaysAnswer({ preferred_days: ["MON", "WED", "FRI"], days_said: "3" }).complete, true);
  assert.equal(trainingDaysAnswer({}).complete, false);
});

test("exercise names: one spelling per exercise, and suggested session names", () => {
  assert.ok(EXERCISE_LIBRARY.includes("Barbell Bench Press"));
  assert.equal(canonicalExerciseName("barbell bench  press"), "Barbell Bench Press");
  assert.equal(canonicalExerciseName("Bench press", ["Bench Press"]), "Bench Press");
  assert.equal(canonicalExerciseName("pull up"), "Pull-Up");
  assert.equal(canonicalExerciseName("Zercher Squat"), "Zercher Squat");
  assert.deepEqual(sessionNameSuggestions(4), ["Upper A", "Lower A", "Upper B", "Lower B"]);
  assert.deepEqual(sessionNameSuggestions(7).at(-1), "Session 7");
});
