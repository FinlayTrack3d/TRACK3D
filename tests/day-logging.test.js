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
