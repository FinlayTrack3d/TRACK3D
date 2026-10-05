import test from "node:test";
import assert from "node:assert/strict";
import { mealsForDay, nutritionLogFields } from "../lib/nutrition-plan.js";
import { setsRepsSummary } from "../lib/fitness-session.js";
import { isNewWeeklyReport } from "../lib/weekly-report.js";

const training = [{ name: "Oats", calories: 500, protein: 30 }, { name: "Chicken & Rice", calories: 700, protein: 50 }];
const rest = [{ name: "Eggs", calories: 400, protein: 30 }];

test("rest days with no rest day plan use the training day meals", () => {
  // Saved plans store rest_day_meals as [] when rest days are the same.
  assert.deepEqual(mealsForDay({ meals: training, rest_day_meals: [] }, "2026-10-05", false), training);
  assert.deepEqual(mealsForDay({ meals: training, rest_day_meals: null }, "2026-10-05", false), training);
  assert.deepEqual(mealsForDay({ meals: training, rest_day_meals: rest }, "2026-10-05", false), rest);
  assert.deepEqual(mealsForDay({ meals: training, rest_day_meals: rest }, "2026-10-05", true), training);
  assert.deepEqual(mealsForDay({ meals: training, rest_day_meals: rest, weekly_meal_plan: { "2026-10-05": rest } }, "2026-10-05", true), rest, "a dated plan wins");
  assert.deepEqual(mealsForDay(null, "2026-10-05", true), []);
});

test("log fields add up ticked meals and keep the review flag separate", () => {
  const fields = nutritionLogFields({ meals: training, results: { 0: true, 1: { completed: false, note: "skipped" }, _review_complete: true }, reviewComplete: false, isTrainingDay: true });
  assert.equal(fields.total_calories, 500);
  assert.equal(fields.total_protein, 30);
  assert.deepEqual(fields.meals_completed, { 0: true, 1: { completed: false, note: "skipped" }, _review_complete: false });
  assert.equal(fields.is_training_day, true);
  assert.equal(nutritionLogFields({ meals: training, results: { 0: true, 1: true }, offPlanCalories: 300 }).total_calories, 1500);
});

test("session preview shows sets × reps, not every set", () => {
  assert.equal(setsRepsSummary({ sets: 3, reps: ["8-10", "8-10", "8-10"] }), "3 × 8–10");
  assert.equal(setsRepsSummary({ sets: 4, reps: ["12", "10", "8", "6"] }), "4 × 6–12");
  assert.equal(setsRepsSummary({ sets: 3, reps: ["8-10", "6-8", "6-8"] }), "3 × 6–10");
  assert.equal(setsRepsSummary({ sets: 3, reps: "8-12" }), "3 × 8–12");
  assert.equal(setsRepsSummary({ sets: "4", reps: "10/8/6/6" }), "4 × 6–10");
  assert.equal(setsRepsSummary({ sets: 3, reps: ["AMRAP", "AMRAP", "AMRAP"] }), "3 × AMRAP");
  assert.equal(setsRepsSummary({ sets: 2, reps: ["10", "AMRAP"] }), "2 sets · varied reps");
  assert.equal(setsRepsSummary({ sets: 3 }), "3 sets");
  assert.equal(setsRepsSummary({ reps: "12" }), "1 × 12");
  assert.equal(setsRepsSummary({}), "");
  assert.equal(setsRepsSummary({ sets: 3, reps: ["30s", "30s", "30s"] }), "3 × 30s");
});

test("a finished week's report is new until opened", () => {
  const week = { start: "2026-09-28", end: "2026-10-04", inProgress: false };
  const metrics = { hasData: true };
  assert.equal(isNewWeeklyReport({ week, metrics }), true);
  assert.equal(isNewWeeklyReport({ week, metrics, hasStoredReport: true }), false, "opened on another device");
  assert.equal(isNewWeeklyReport({ week, metrics, seenWeekStart: "2026-09-28" }), false, "opened here");
  assert.equal(isNewWeeklyReport({ week, metrics, seenWeekStart: "2026-09-21" }), true, "last week's seen mark doesn't count");
  assert.equal(isNewWeeklyReport({ week: { ...week, inProgress: true }, metrics }), false, "the week is not over");
  assert.equal(isNewWeeklyReport({ week, metrics: { hasData: false } }), false, "nothing to report");
});

import { addOffPlanMacros, calculateLoggedNutrition, mealPlanGapText, mealPlanTargetCheck, remainingNutritionTargets, sumFoodEstimate } from "../lib/nutrition-plan.js";

test("off-plan food counts towards protein, carbs and fat when they are known", () => {
  const meals = [{ name: "A", calories: 500, protein: 40, carbs: 50, fats: 15 }];
  const estimate = sumFoodEstimate([{ name: "Pizza", calories_low: 1800, calories_high: 2400, protein_low: 70, protein_high: 90, carbs_low: 200, carbs_high: 260, fat_low: 70, fat_high: 90 }]);
  assert.equal(estimate.caloriesMid, 2100);
  assert.equal(estimate.proteinMid, 80);
  assert.equal(estimate.carbsMid, 230);
  assert.equal(estimate.fatsMid, 80);
  const results = addOffPlanMacros({ 0: true }, estimate);
  const logged = calculateLoggedNutrition(meals, results, 2100);
  assert.deepEqual([logged.calories, logged.protein, logged.carbs, logged.fats], [2600, 120, 280, 95]);
  // No off-plan calories: the macros are not counted.
  assert.equal(calculateLoggedNutrition(meals, results, 0).protein, 40);
});

test("remaining protein, carbs and fat never exceed what the calories left allow", () => {
  // The reported case: 0 kcal left but 264 g carbs and 13 g fat still showing.
  const targets = { calories: 2383, protein: 115, carbs: 303, fats: 79 };
  const left = remainingNutritionTargets(targets, { calories: 3430, protein: 90, carbs: 39, fats: 66 });
  assert.deepEqual(left, { calories: 0, protein: 0, carbs: 0, fats: 0 });
  const some = remainingNutritionTargets(targets, { calories: 2183, protein: 60, carbs: 100, fats: 40 });
  assert.equal(some.calories, 200);
  assert.equal(some.carbs, 50, "200 kcal left allows at most 50 g carbs");
  assert.equal(some.fats, 22);
  assert.equal(some.protein, 50);
  // Without a calorie target nothing is capped.
  assert.equal(remainingNutritionTargets({ protein: 115 }, { protein: 15 }).protein, 100);
});

test("a plan that misses its targets is described plainly", () => {
  const meals = [{ calories: 500, protein: 40 }, { calories: 600, protein: 36 }, { calories: 375, protein: 30 }, { calories: 400, protein: 38 }];
  const targets = { calories: 2381, protein: 115 };
  const text = mealPlanGapText(mealPlanTargetCheck(meals, targets), targets);
  assert.equal(text, "These meals add up to 1,875 kcal and 144 g protein: 506 kcal under and 29 g protein over your targets of 2,381 kcal and 115 g protein.");
  assert.equal(mealPlanGapText(mealPlanTargetCheck([{ calories: 2381, protein: 115 }], targets), targets), "");
});
