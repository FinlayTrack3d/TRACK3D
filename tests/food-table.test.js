import test from "node:test";
import assert from "node:assert/strict";
import { ingredientMacros, mealMacrosFromIngredients, scaleMealsToCalories, withIngredientMacros } from "../lib/food-table.js";

test("meal numbers are worked out from the ingredients", () => {
  // Eggs on Toast: listed as 380 kcal, the ingredients add up to about 490.
  const eggs = mealMacrosFromIngredients({ ingredients: [{ name: "Eggs", weight: 150, unit: "g" }, { name: "Wholegrain bread", weight: 80, unit: "g" }, { name: "Butter", weight: 10, unit: "g" }] });
  assert.ok(eggs.calories >= 470 && eggs.calories <= 510, `eggs on toast ${eggs.calories}`);
  assert.equal(eggs.complete, true);
  // The breakfast from the test: about 780 kcal and 50 g protein, not 580 / 40.
  const oats = mealMacrosFromIngredients({ ingredients: [
    { name: "Oats", weight: 80, unit: "g" }, { name: "Whole milk", weight: 250, unit: "ml" }, { name: "Banana", weight: 120, unit: "g" },
    { name: "Whey protein", weight: 30, unit: "g" }, { name: "Peanut butter", weight: 15, unit: "g" },
  ] });
  assert.ok(oats.calories >= 740 && oats.calories <= 800, `oats ${oats.calories}`);
  assert.ok(oats.protein >= 45 && oats.protein <= 55, `oats protein ${oats.protein}`);
  // Items: 2 eggs, 1 scoop.
  assert.equal(Math.round(ingredientMacros({ name: "Eggs", weight: 2, unit: "" }).calories), 143);
  assert.equal(Math.round(ingredientMacros({ name: "Whey", weight: 1, unit: "scoop" }).protein), 23);
  // Cooked rice is not dry rice.
  assert.ok(ingredientMacros({ name: "Cooked basmati rice", weight: 100, unit: "g" }).calories < 150);
  // Unknown foods are listed, and the meal keeps the numbers it was given.
  const dragon = withIngredientMacros({ name: "Snack", calories: 200, ingredients: [{ name: "Dragon fruit chips", weight: 30, unit: "g" }] });
  assert.equal(dragon.calories, 200);
  assert.deepEqual(dragon.uncheckedIngredients, ["Dragon fruit chips"]);
});

test("portions scale to the calorie target", () => {
  const meals = [
    withIngredientMacros({ name: "Chicken & Rice", ingredients: [{ name: "Chicken breast", weight: 200, unit: "g" }, { name: "White rice", weight: 100, unit: "g" }] }),
    { name: "Snack", calories: 200, protein: 10, carbs: 20, fats: 8 },
  ];
  const before = meals.reduce((sum, meal) => sum + meal.calories, 0);
  const scaled = scaleMealsToCalories(meals, before * 1.3);
  const after = scaled.reduce((sum, meal) => sum + meal.calories, 0);
  assert.ok(Math.abs(after - before * 1.3) / (before * 1.3) < 0.03, `scaled to ${after}`);
  assert.equal(scaled[0].ingredients[0].weight, 260);
  assert.equal(scaled[1].calories, 260);
});
