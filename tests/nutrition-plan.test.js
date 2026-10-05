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
