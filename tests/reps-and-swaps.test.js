import test from "node:test";
import assert from "node:assert/strict";
import { repTargets, splitRepTargets, targetFor } from "../lib/workout.js";
import { buildLoggedExercises, buildWorkoutReview, recoverWorkoutState, setsRepsSummary } from "../lib/fitness-session.js";
import { applyPlanChangeProposal } from "../lib/coaching/plan-change.js";
import { normaliseImportedFitnessPlan } from "../lib/plan-import.js";
import { calculateLoggedNutrition, isMealAnswered, mealSwap, swappedMealResult } from "../lib/nutrition-plan.js";

test("rep targets kept in one string are split per set, never shown whole as set 1", () => {
  assert.deepEqual(repTargets("6-8,6-8,8,10", 4), ["6-8", "6-8", "8", "10"]);
  assert.deepEqual(repTargets("6-8/6-8/8/10", 4), ["6-8", "6-8", "8", "10"]);
  // The whole list copied into every set (as a coach reply sometimes does).
  assert.deepEqual(repTargets(Array(4).fill("6-8,6-8,8,10"), 4), ["6-8", "6-8", "8", "10"]);
  assert.deepEqual(repTargets(["8", "8", "8"], 3), ["8", "8", "8"]);
  // The last target repeats; nothing given falls back to 8-12.
  assert.deepEqual(repTargets("12, 10, 8", 5), ["12", "10", "8", "8", "8"]);
  assert.deepEqual(repTargets("", 2), ["8-12", "8-12"]);
  // Text that is not a list of reps stays whole.
  assert.deepEqual(splitRepTargets("10 each side, then 8"), ["10 each side, then 8"]);
  assert.deepEqual(splitRepTargets("AMRAP, 30s"), ["AMRAP", "30s"]);
  assert.deepEqual(repTargets(["10/leg", "10/leg"], 2), ["10/leg", "10/leg"]);
  assert.deepEqual(splitRepTargets("12–15 / 8–10"), ["12–15", "8–10"]);
  assert.equal(targetFor({ reps: "6-8,6-8,8,10" }, 1), "6–8");
});

test("a workout and its review use each set's own target", () => {
  const session = { name: "Upper A", exercises: [{ name: "Bench Press", sets: 4, reps: "6-8,6-8,8,10" }] };
  const logged = buildLoggedExercises(session, { 0: [{ weight: 60, reps: 8 }, { weight: 60, reps: 7 }] });
  assert.deepEqual(logged[0].sets.map(set => set.repRange), ["6-8", "6-8"]);
  const review = buildWorkoutReview(session, { 0: [{ weight: 60, reps: 8 }] });
  assert.deepEqual(review.exercises[0].sets.map(set => set.targetReps), ["6-8", "6-8", "8", "10"]);
  const recovered = recoverWorkoutState({ id: "w", session_name: "Upper A", date: "2026-10-06", exercises: [{ name: "Bench Press", prescribed_sets: 4, prescribed_reps: "6-8,6-8,8,10", sets: [] }] }, null);
  assert.deepEqual(recovered.activeSession.exercises[0].reps, ["6-8", "6-8", "8", "10"]);
  assert.equal(setsRepsSummary({ sets: 4, reps: "6-8,6-8,8,10" }), "4 × 6–10");
});

test("coach plan changes and imported plans store one target per set", () => {
  const sessions = [{ name: "Upper A", exercises: [{ name: "Bench Press", sets: 3, reps: ["8-10", "8-10", "8-10"] }] }];
  const [changed] = applyPlanChangeProposal(sessions, [{ kind: "update_prescription", sessionName: "Upper A", exerciseName: "Bench Press", sets: 4, reps: "6-8,6-8,8,10" }]);
  assert.deepEqual(changed.exercises[0].reps, ["6-8", "6-8", "8", "10"]);
  const imported = normaliseImportedFitnessPlan({ sessions: [{ name: "Upper A", days: ["MON"], exercises: [{ name: "Bench Press", sets: null, reps: "6-8,6-8,8,10" }] }] });
  assert.equal(imported.sessions[0].exercises[0].sets, 4);
  assert.deepEqual(imported.sessions[0].exercises[0].reps, ["6-8", "6-8", "8", "10"]);
});

test("a swapped meal counts with what was eaten instead", () => {
  const meals = [{ name: "Lunch", calories: 700, protein: 45, carbs: 80, fats: 20 }, { name: "Dinner", calories: 800, protein: 50, carbs: 90, fats: 25 }];
  const fromLibrary = swappedMealResult({ name: "Protein Pancakes", calories: 450, protein: 35, carbs: 50, fats: 9 });
  assert.deepEqual(fromLibrary, { completed: true, swap: { name: "Protein Pancakes", calories: 450, protein: 35, carbs: 50, fats: 9 } });
  assert.equal(isMealAnswered(fromLibrary), true);
  const totals = calculateLoggedNutrition(meals, { 0: fromLibrary, 1: true });
  assert.deepEqual(totals, { calories: 1250, protein: 85, carbs: 140, fats: 34, completedMeals: 2 });
  // Made up on the spot with calories only: a rough protein/carbs/fat split.
  const ownMeal = swappedMealResult({ name: " Chicken wrap ", calories: "600", protein: "40", carbs: "", fats: "" });
  assert.deepEqual(ownMeal.swap, { name: "Chicken wrap", calories: 600, protein: 40, carbs: 68, fats: 27 });
  assert.equal(mealSwap(true), null);
  assert.equal(mealSwap({ completed: false, note: "skipped" }), null);
});
