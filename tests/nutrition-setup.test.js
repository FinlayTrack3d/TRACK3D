import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_NUTRITION_QUESTIONS, allergyRule, applyMealTimes, calculateNutritionTargets, mealAllergyConflicts, mealTimeSlots,
  normaliseNutritionGoal, parseAllergies, preferencesText, setupStatsProblem, suggestActivityLevel,
} from "../lib/nutrition-setup.js";

const stats = { weight: 80, height: 180, age: 30, sex: "Male", activityLevel: "Moderately active" };

test("targets use height, age and sex", () => {
  const male = calculateNutritionTargets({ ...stats, goal: "Maintain" });
  // Mifflin-St Jeor: 800 + 1125 - 150 + 5 = 1780; x1.55 = 2759
  assert.equal(male.bmr, 1780);
  assert.equal(male.tdee, 2759);
  assert.equal(male.calories, 2760);
  const female = calculateNutritionTargets({ ...stats, sex: "Female", goal: "Maintain" });
  assert.ok(female.calories < male.calories - 200);
  const older = calculateNutritionTargets({ ...stats, age: 60, goal: "Maintain" });
  assert.ok(older.calories < male.calories);
  const shorter = calculateNutritionTargets({ ...stats, height: 160, goal: "Maintain" });
  assert.ok(shorter.calories < male.calories);
});

test("a cut is based on body weight, not a flat 20%", () => {
  const cut = calculateNutritionTargets({ ...stats, goal: "Lose fat" });
  // 0.5% of 80 kg a week = 0.4 kg = 3,080 kcal a week = 440 a day
  assert.ok(Math.abs(cut.adjustment + 440) <= 5, `deficit ${cut.adjustment}`);
  assert.equal(cut.calories, Math.round((2759 - 440) / 10) * 10);
  assert.equal(cut.protein, 176);
  const light = calculateNutritionTargets({ weight: 55, height: 160, age: 30, sex: "Female", activityLevel: "Sedentary", goal: "Lose fat" });
  assert.ok(light.calories >= light.bmr, "never below resting energy");
  assert.ok(light.carbs >= 0);
});

test("stats are validated", () => {
  assert.match(setupStatsProblem({ ...stats, height: "" }), /height/);
  assert.match(setupStatsProblem({ ...stats, age: 14 }), /16/);
  assert.match(setupStatsProblem({ ...stats, sex: "" }), /sex/);
  assert.equal(setupStatsProblem(stats), "");
  assert.equal(calculateNutritionTargets({ ...stats, weight: "" }), null);
});

test("old goal names map to the one list", () => {
  assert.equal(normaliseNutritionGoal("Cut (lose fat)"), "Lose fat");
  assert.equal(normaliseNutritionGoal("Lose body fat"), "Lose fat");
  assert.equal(normaliseNutritionGoal("Maintain weight"), "Maintain");
  assert.equal(normaliseNutritionGoal("maintain"), "Maintain");
  assert.equal(normaliseNutritionGoal("Build muscle"), "Lean bulk");
  assert.equal(normaliseNutritionGoal("Lean bulk"), "Lean bulk");
  assert.equal(normaliseNutritionGoal("Bulk"), "Bulk");
  assert.equal(normaliseNutritionGoal(""), null);
});

test("activity is suggested from training days", () => {
  assert.equal(suggestActivityLevel(0), "Sedentary");
  assert.equal(suggestActivityLevel(2), "Lightly active");
  assert.equal(suggestActivityLevel(4), "Moderately active");
  assert.equal(suggestActivityLevel(6), "Very active");
});

test("meal times follow the wake-up time", () => {
  assert.deepEqual(mealTimeSlots("05:30", 4), ["06:30", "10:30", "14:30", "18:30"]);
  assert.deepEqual(mealTimeSlots("08:00", 3), ["09:00", "15:00", "21:00"]);
  assert.deepEqual(mealTimeSlots("", 3), []);
  const meals = [{ name: "Dinner", time: "19:00" }, { name: "Breakfast", time: "08:00" }, { name: "Lunch", time: "13:00" }];
  const timed = applyMealTimes(meals, "05:30");
  assert.deepEqual(timed.map(m => [m.name, m.time]), [["Breakfast", "06:30"], ["Lunch", "12:30"], ["Dinner", "18:30"]]);
  assert.ok(timed.every(m => m.time !== "08:00" || m.name !== "Breakfast"));
  const manual = applyMealTimes([{ name: "Shake", time: "11:00", manualTime: true }, { name: "Breakfast", time: "08:00" }], "05:30");
  assert.equal(manual.find(m => m.name === "Shake").time, "11:00");
});

test("allergies are parsed and enforced", () => {
  assert.deepEqual(parseAllergies("None"), []);
  assert.deepEqual(parseAllergies("Peanuts, lactose and gluten"), ["peanuts", "lactose", "gluten"]);
  const meals = [
    { name: "Greek Yoghurt Bowl", ingredients: [{ name: "Greek yoghurt" }, { name: "Granola" }] },
    { name: "Rice Cakes & PB", ingredients: [{ name: "Rice cakes" }, { name: "Peanut butter" }] },
    { name: "Oat porridge", ingredients: [{ name: "Oat milk" }, { name: "Blueberries" }] },
    { name: "Chicken stir fry", ingredients: [{ name: "Chicken breast" }, { name: "Rice noodles" }, { name: "Coconut milk" }] },
  ];
  const lactose = mealAllergyConflicts(meals, ["lactose"]);
  assert.deepEqual(lactose.map(c => c.meal), ["Greek Yoghurt Bowl"], "peanut butter, oat and coconut milk are not dairy");
  const peanut = mealAllergyConflicts(meals, "peanuts");
  assert.deepEqual(peanut.map(c => c.meal), ["Rice Cakes & PB"]);
  const gluten = mealAllergyConflicts(meals, ["gluten"]);
  assert.deepEqual(gluten.map(c => c.meal).sort(), ["Greek Yoghurt Bowl", "Oat porridge"], "granola and oats flagged, rice noodles and rice cakes not");
  assert.deepEqual(mealAllergyConflicts([{ name: "Lactose-free milk shake", ingredients: [{ name: "Lactose-free milk" }] }], ["lactose"]), []);
  assert.deepEqual(mealAllergyConflicts([{ name: "Thai curry", ingredients: [{ name: "Coconut" }, { name: "Butternut squash" }] }], ["nuts"]), []);
  assert.equal(mealAllergyConflicts([{ name: "Salmon & rice" }], ["fish"]).length, 1);
  assert.match(allergyRule(["peanuts"]), /Never include these/);
  assert.match(allergyRule("none"), /none reported/);
});

test("five questions plus optional budget, allergies first", () => {
  const required = AI_NUTRITION_QUESTIONS.filter(q => !q.optional);
  assert.equal(required.length, 5);
  assert.equal(AI_NUTRITION_QUESTIONS[0].id, "allergies");
  assert.deepEqual(AI_NUTRITION_QUESTIONS.filter(q => q.optional).map(q => q.id), ["budget"]);
  for (const removed of ["goal", "meals_per_day", "training_days", "experience"]) assert.ok(!AI_NUTRITION_QUESTIONS.some(q => q.id === removed));
  assert.equal(preferencesText({ goal: "Bulk", diet_type: "Vegan", allergies: "nuts" }), "Any dietary preference? Vegan");
});
