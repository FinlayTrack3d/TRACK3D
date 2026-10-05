import test from "node:test";
import assert from "node:assert/strict";
import { calculateLoggedNutrition, inferNutritionStyle, mergeMealLibrary, prepareNutritionMeals, remainingNutritionTargets } from "../lib/nutrition-plan.js";

const targets = { calories: 2200, protein: 160, carbs: 250, fats: 65 };

test("hybrid plans preserve repeated meals and allocate the remainder to flexible slots", () => {
  const meals = [
    { name: "Breakfast", calories: 400, protein: 30, carbs: 50, fats: 10, repeatDaily: true },
    { name: "Final meal", calories: 300, protein: 25, carbs: 20, fats: 10, repeatDaily: true },
  ];
  const prepared = prepareNutritionMeals(meals, "hybrid", 5, targets);
  assert.equal(inferNutritionStyle(prepared), "hybrid");
  assert.equal(prepared.length, 5);
  assert.deepEqual(prepared.map(meal => meal.mealType), ["fixed", "flexible", "flexible", "flexible", "fixed"]);
  assert.deepEqual(prepared.filter(meal => meal.mealType === "flexible").map(meal => meal.calories), [500, 500, 500]);
  assert.equal(prepared.reduce((sum, meal) => sum + meal.calories, 0), targets.calories);
  assert.equal(prepared.reduce((sum, meal) => sum + meal.protein, 0), targets.protein);
});

test("macro-only plans create flexible slots that add up to the daily targets", () => {
  const prepared = prepareNutritionMeals([], "flexible", 4, targets);
  assert.equal(inferNutritionStyle(prepared), "flexible");
  assert.equal(prepared.length, 4);
  for (const key of ["calories", "protein", "carbs", "fats"]) assert.equal(prepared.reduce((sum, meal) => sum + meal[key], 0), targets[key]);
});

test("editing a hybrid plan preserves flexible slots between its repeated meals", () => {
  const existing = [
    { name: "Breakfast", mealType: "fixed", calories: 400, protein: 30, carbs: 50, fats: 10 },
    { name: "Flexible meal 2", mealType: "flexible" },
    { name: "Flexible meal 3", mealType: "flexible" },
    { name: "Flexible meal 4", mealType: "flexible" },
    { name: "Final meal", mealType: "fixed", calories: 300, protein: 25, carbs: 20, fats: 10 },
  ];
  const preparedAgain = prepareNutritionMeals(existing, "hybrid", 5, targets);
  assert.deepEqual(preparedAgain.map(meal => meal.mealType), ["fixed", "flexible", "flexible", "flexible", "fixed"]);
});

test("logged totals use planned macros for fixed meals and actual macros for flexible meals", () => {
  const meals = prepareNutritionMeals([{ name: "Breakfast", calories: 400, protein: 30, carbs: 50, fats: 10 }], "hybrid", 2, targets);
  const totals = calculateLoggedNutrition(meals, { 0: true, 1: { completed: true, calories: 650, protein: 42, carbs: 70, fats: 18 } }, 100);
  assert.deepEqual(totals, { calories: 1150, protein: 72, carbs: 120, fats: 28, completedMeals: 2 });
  assert.deepEqual(remainingNutritionTargets(targets, totals), { calories: 1050, protein: 88, carbs: 130, fats: 37 });
});

test("meal library merges repeat meals by name without duplicating them", () => {
  const merged = mergeMealLibrary([{ id: "breakfast", name: "Breakfast", calories: 350 }], [
    { name: "breakfast", calories: 400, protein: 30 },
    { name: "Flexible meal 2", mealType: "flexible", calories: 500 },
    { name: "Final meal", calories: 300, protein: 25 },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "breakfast");
  assert.equal(merged[0].calories, 400);
  assert.equal(merged[1].name, "Final meal");
});

test("countCompletedMeals handles every saved shape", async () => {
  const { countCompletedMeals } = await import("../lib/nutrition-plan.js");
  assert.equal(countCompletedMeals({ 0: true, 1: { completed: false, note: "pizza" }, 2: { completed: true, calories: 500 }, _review_complete: true }), 2);
  assert.equal(countCompletedMeals([true, false, { done: true }, null]), 2);
  assert.equal(countCompletedMeals({}), 0);
  assert.equal(countCompletedMeals(null), 0);
  assert.equal(countCompletedMeals(undefined), 0);
  assert.equal(countCompletedMeals("bad"), 0);
  assert.equal(countCompletedMeals({ _review_complete: true }), 0, "bookkeeping keys are not meals");
});

test("the day review skips meals already logged", async () => {
  const { isMealAnswered, nextReviewStep } = await import("../lib/nutrition-plan.js");
  const meals = [{ name: "Breakfast" }, { name: "Lunch" }, { name: "Dinner" }, { name: "Snack" }];
  const results = { 0: true, 1: { completed: true }, 2: { completed: false, note: "large pepperoni pizza and two beers" } };
  assert.equal(isMealAnswered(results[2]), true);
  assert.equal(isMealAnswered(undefined), false);
  assert.equal(nextReviewStep(meals, results, -1, true), 3, "starts at the only unanswered meal");
  assert.equal(nextReviewStep(meals, results, 3, true), 4, "then the off-plan step");
  assert.equal(nextReviewStep(meals, results, -1, false), 0, "editing walks every meal");
});

test("unlogged food is listed instead of calling the day under target", async () => {
  const { unloggedFood } = await import("../lib/nutrition-plan.js");
  const meals = [{ name: "Breakfast" }, { name: "Lunch" }, { name: "Dinner" }, { name: "Snack" }];
  const results = { 0: true, 1: true, 2: { completed: false, note: "large pepperoni pizza and two beers" }, 3: { completed: false, note: "Skipped" } };
  assert.deepEqual(unloggedFood(meals, results, "", 0), [{ meal: "Dinner", food: "large pepperoni pizza and two beers" }]);
  assert.deepEqual(unloggedFood(meals, results, "crisps", 250).length, 1, "off-plan food with calories is already counted");
  assert.equal(unloggedFood(meals, { 0: true }, "", 0).length, 0);
});

test("food estimates are added up in code, as ranges", async () => {
  const { sumFoodEstimate } = await import("../lib/nutrition-plan.js");
  const estimate = sumFoodEstimate([
    { name: "Large pepperoni pizza", amount: "1 large (whole)", calories_low: 1800, calories_high: 2400, protein_low: 70, protein_high: 95 },
    { name: "Beer", amount: "2 pints", calories_low: 360, calories_high: 480, protein_low: 2, protein_high: 4 },
  ]);
  assert.equal(estimate.caloriesLow, 2160);
  assert.equal(estimate.caloriesHigh, 2880);
  assert.equal(estimate.proteinLow, 72);
  assert.equal(estimate.proteinHigh, 99);
  assert.equal(estimate.caloriesMid, 2520);
});

test("an AI meal plan is checked against its own targets", async () => {
  const { mealPlanTargetCheck } = await import("../lib/nutrition-plan.js");
  const targets = { calories: 2381, protein: 115, carbs: 303, fats: 79 };
  const off = mealPlanTargetCheck([{ calories: 1000, protein: 70 }, { calories: 875, protein: 74 }], targets);
  assert.equal(off.ok, false);
  assert.deepEqual(off.totals.calories, 1875);
  assert.match(off.problems.join(" "), /calories 1875 vs target 2381/);
  assert.match(off.problems.join(" "), /protein 144 g vs target 115 g/);
  assert.equal(mealPlanTargetCheck([{ calories: 1200, protein: 60 }, { calories: 1150, protein: 58 }], targets).ok, true);
});

test("a saved log lists food eaten without calories", async () => {
  const { unloggedFoodFromLog } = await import("../lib/nutrition-plan.js");
  assert.deepEqual(unloggedFoodFromLog({ meals_completed: { 0: true, 1: true, 2: { completed: false, note: "large pepperoni pizza and two beers" }, 3: { completed: false, note: "Skipped" }, _review_complete: true }, off_plan_food: "", off_plan_calories: null }), ["large pepperoni pizza and two beers"]);
  assert.deepEqual(unloggedFoodFromLog({ meals_completed: {}, off_plan_food: "crisps", off_plan_calories: 0 }), ["crisps"]);
  assert.deepEqual(unloggedFoodFromLog({ meals_completed: {}, off_plan_food: "crisps", off_plan_calories: 200 }), []);
  assert.deepEqual(unloggedFoodFromLog(null), []);
});

test("an estimate added to off-plan food covers the meal note it came from", async () => {
  const { unloggedFood } = await import("../lib/nutrition-plan.js");
  const meals = [{ name: "Dinner" }];
  const results = { 0: { completed: false, note: "large pepperoni pizza and two beers" } };
  assert.equal(unloggedFood(meals, results, "large pepperoni pizza and two beers", 2520).length, 0);
  assert.equal(unloggedFood(meals, results, "large pepperoni pizza and two beers", 0).length, 2, "without calories both are still unlogged");
});
