const MACRO_KEYS = ["calories", "protein", "carbs", "fats"];

const number = value => Math.max(0, Number(value) || 0);

export function isFlexibleMeal(meal) {
  return meal?.mealType === "flexible";
}

export function inferNutritionStyle(meals = []) {
  if (!meals.length) return "hybrid";
  const flexibleCount = meals.filter(isFlexibleMeal).length;
  if (flexibleCount === meals.length) return "flexible";
  if (flexibleCount === 0) return "fixed";
  return "hybrid";
}

function allocate(total, count, index) {
  if (!count) return 0;
  const base = Math.floor(number(total) / count);
  return index === count - 1 ? number(total) - base * (count - 1) : base;
}

export function prepareNutritionMeals(meals = [], style = "hybrid", mealsPerDay = 4, targets = {}) {
  const desiredCount = Math.max(1, Number(mealsPerDay) || 4);
  const sourceMeals = meals.filter(meal => meal && !isFlexibleMeal(meal));

  if (style === "fixed") {
    return sourceMeals.map(meal => ({ ...meal, mealType: "fixed", repeatDaily: true }));
  }

  if (style === "flexible") {
    return Array.from({ length: desiredCount }, (_, index) => ({
      name: `Flexible meal ${index + 1}`,
      mealType: "flexible",
      repeatDaily: false,
      ingredients: [],
      ...Object.fromEntries(MACRO_KEYS.map(key => [key, allocate(targets[key], desiredCount, index)])),
    }));
  }

  const slots = meals.filter(Boolean).map(meal => isFlexibleMeal(meal)
    ? { ...meal, mealType: "flexible", repeatDaily: false, ingredients: [] }
    : meal.repeatDaily === false
      ? { name: "Flexible meal", exampleName: meal.exampleName || meal.name, mealType: "flexible", repeatDaily: false, ingredients: [] }
      : { ...meal, mealType: "fixed", repeatDaily: true });
  while (slots.length < desiredCount) {
    const flexibleSlot = { name: "Flexible meal", mealType: "flexible", repeatDaily: false, ingredients: [] };
    // With two anchor meals, keep the second one at the end of the day and
    // place the flexible slots between them (for example breakfast + meal 5).
    if (slots.length >= 2) slots.splice(slots.length - 1, 0, flexibleSlot);
    else slots.push(flexibleSlot);
  }

  const fixedTotals = Object.fromEntries(MACRO_KEYS.map(key => [key, slots.filter(meal => !isFlexibleMeal(meal)).reduce((sum, meal) => sum + number(meal[key]), 0)]));
  const flexibleMeals = slots.filter(isFlexibleMeal);
  let flexibleIndex = 0;
  return slots.map((meal, index) => {
    if (!isFlexibleMeal(meal)) return meal;
    const currentFlexibleIndex = flexibleIndex++;
    return {
      ...meal,
      name: `Flexible meal ${index + 1}`,
      ...Object.fromEntries(MACRO_KEYS.map(key => [key, allocate(Math.max(0, number(targets[key]) - fixedTotals[key]), flexibleMeals.length, currentFlexibleIndex)])),
    };
  });
}

export function calculateLoggedNutrition(meals = [], mealResults = {}, offPlanCalories = 0) {
  const totals = { calories: number(offPlanCalories), protein: 0, carbs: 0, fats: 0, completedMeals: 0 };
  meals.forEach((meal, index) => {
    const result = mealResults[index];
    const completed = result === true || result?.completed === true;
    if (!completed) return;
    totals.completedMeals += 1;
    MACRO_KEYS.forEach(key => {
      totals[key] += number(isFlexibleMeal(meal) && typeof result === "object" ? result[key] : meal[key]);
    });
  });
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value)]));
}

export function remainingNutritionTargets(targets = {}, logged = {}) {
  return Object.fromEntries(MACRO_KEYS.map(key => [key, Math.max(0, Math.round(number(targets[key]) - number(logged[key])))]));
}

export function mergeMealLibrary(library = [], meals = []) {
  const next = library.filter(meal => meal?.name);
  meals.filter(meal => meal?.name && !isFlexibleMeal(meal)).forEach(meal => {
    const normalizedName = meal.name.trim().toLowerCase();
    const existingIndex = next.findIndex(item => item.name?.trim().toLowerCase() === normalizedName);
    const libraryMeal = { ...meal, mealType: "fixed", repeatDaily: true };
    if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...libraryMeal, id: next[existingIndex].id || meal.id };
    else next.push(libraryMeal);
  });
  return next;
}

// Number of meals marked done in nutrition_logs.meals_completed, which may be
// an array, or an object keyed by meal index with bookkeeping keys such as
// _review_complete. A meal is done when its value is true or an object with
// completed (or done) set to true.
export function countCompletedMeals(mealsCompleted) {
  if (!mealsCompleted || typeof mealsCompleted !== "object") return 0;
  const values = Array.isArray(mealsCompleted)
    ? mealsCompleted
    : Object.entries(mealsCompleted).filter(([key]) => !key.startsWith("_")).map(([, value]) => value);
  return values.filter((value) => value === true || (value && typeof value === "object" && (value.completed === true || value.done === true))).length;
}

// A meal counts as answered once it is ticked, skipped, noted or given numbers.
export function isMealAnswered(result) {
  if (result === true) return true;
  if (!result || typeof result !== "object") return false;
  return result.completed === true || Boolean(String(result.note || "").trim()) || Number(result.calories) > 0;
}

// The next review step after `current`: with skipAnswered, meals already
// answered (for example in LOG AS YOU GO) are skipped. meals.length is the
// off-plan step.
export function nextReviewStep(meals = [], results = {}, current = -1, skipAnswered = false) {
  for (let index = current + 1; index < meals.length; index += 1) {
    if (!skipAnswered || !isMealAnswered(results[index])) return index;
  }
  return Math.max(current + 1, meals.length);
}

// Food the user ate but did not give calories for: off-plan food without
// calories and notes on meals that were replaced (not just skipped).
export function unloggedFood(meals = [], results = {}, offPlanFood = "", offPlanCalories = 0) {
  const items = [];
  const offPlanText = String(offPlanFood || "").toLowerCase();
  const offPlanCounted = Number(offPlanCalories) > 0;
  meals.forEach((meal, index) => {
    const result = results[index];
    const note = result && typeof result === "object" && result.completed !== true ? String(result.note || "").trim() : "";
    // A note already copied into off-plan food that has calories is counted.
    const covered = offPlanCounted && note && offPlanText.includes(note.toLowerCase());
    if (note && !covered && !/^skipped$/i.test(note) && !(Number(result.calories) > 0)) items.push({ meal: meal?.name || `Meal ${index + 1}`, food: note });
  });
  if (String(offPlanFood || "").trim() && !(Number(offPlanCalories) > 0)) items.push({ meal: "Off plan", food: String(offPlanFood).trim() });
  return items;
}

// Adds up an estimate the coach returned item by item, so the totals are
// arithmetic rather than the model's own sums. Ranges stay ranges.
export function sumFoodEstimate(items = []) {
  const valid = (Array.isArray(items) ? items : []).filter((item) => item && item.name);
  const total = (key) => Math.round(valid.reduce((sum, item) => sum + (Number(item[key]) || 0), 0));
  return {
    items: valid.map((item) => ({ name: String(item.name), amount: String(item.amount || ""), caloriesLow: Math.round(Number(item.calories_low) || 0), caloriesHigh: Math.round(Number(item.calories_high) || 0), proteinLow: Math.round(Number(item.protein_low) || 0), proteinHigh: Math.round(Number(item.protein_high) || 0) })),
    caloriesLow: total("calories_low"),
    caloriesHigh: total("calories_high"),
    proteinLow: total("protein_low"),
    proteinHigh: total("protein_high"),
    caloriesMid: Math.round((total("calories_low") + total("calories_high")) / 2),
  };
}

// Totals of an AI-built meal plan compared with its targets: calories must
// be within 5% and protein within 10%.
export function mealPlanTargetCheck(meals = [], targets = {}) {
  const totals = { calories: 0, protein: 0, carbs: 0, fats: 0 };
  (meals || []).forEach((meal) => Object.keys(totals).forEach((key) => { totals[key] += Number(meal?.[key]) || 0; }));
  Object.keys(totals).forEach((key) => { totals[key] = Math.round(totals[key]); });
  const off = (key, tolerance) => {
    const target = Number(targets[key]) || 0;
    return target > 0 && Math.abs(totals[key] - target) / target > tolerance;
  };
  const problems = [];
  if (off("calories", 0.05)) problems.push(`calories ${totals.calories} vs target ${targets.calories}`);
  if (off("protein", 0.1)) problems.push(`protein ${totals.protein} g vs target ${targets.protein} g`);
  return { ok: problems.length === 0, totals, problems };
}

// Unlogged food from a saved nutrition_logs row (meal names are not stored
// with it): replaced-meal notes and off-plan food without calories.
export function unloggedFoodFromLog(log) {
  if (!log) return [];
  const results = log.meals_completed && typeof log.meals_completed === "object" ? log.meals_completed : {};
  const entries = Array.isArray(results) ? results.map((value, index) => [index, value]) : Object.entries(results).filter(([key]) => !key.startsWith("_"));
  const meals = [];
  const byIndex = {};
  entries.forEach(([key, value], position) => { meals.push({ name: `Meal ${Number(key) + 1 || position + 1}` }); byIndex[meals.length - 1] = value; });
  return unloggedFood(meals, byIndex, log.off_plan_food, log.off_plan_calories).map((item) => item.food);
}
