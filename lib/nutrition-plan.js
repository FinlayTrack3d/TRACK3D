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
