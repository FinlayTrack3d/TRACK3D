// Calories and macros of common foods, per 100 g (or 100 ml), from typical
// UK label values (carbs exclude fibre). Rice, pasta, noodles, couscous,
// quinoa and oats are weighed dry, unless the name says cooked. Meal
// numbers are worked out from these in code rather than taken from the AI,
// and portions are scaled in code to reach a target.

// [match, kcal, protein, carbs, fat, grams per item (for "2 eggs")]
// More specific matches come first.
const FOODS = [
  [/cooked (white |basmati |jasmine )?rice|rice,? cooked|boiled rice/, 130, 2.7, 28, 0.3],
  [/cooked brown rice|brown rice,? cooked/, 123, 2.7, 26, 1],
  [/cooked pasta|pasta,? cooked/, 158, 5.8, 31, 0.9],
  [/brown rice/, 360, 7.5, 76, 2.7],
  [/rice noodle/, 360, 6, 80, 0.6],
  [/egg noodle|noodle/, 380, 13, 72, 3],
  [/rice cake/, 387, 8, 81, 2.8, 8],
  [/rice/, 350, 7, 78, 0.6],
  [/pasta|spaghetti|penne|fusilli|macaroni/, 355, 12.5, 71, 1.5],
  [/couscous/, 376, 13, 72, 2],
  [/quinoa/, 368, 14, 57, 6],
  [/granola/, 450, 10, 60, 18],
  [/oat/, 375, 13, 60, 8],
  [/bagel/, 255, 10, 48, 1.6, 85],
  [/wrap|tortilla/, 290, 9, 46, 6.5, 60],
  [/pitta|pita/, 260, 9, 52, 1.3, 60],
  [/sourdough/, 250, 9, 49, 1.5, 40],
  [/wholegrain bread|wholemeal bread|brown bread|seeded bread/, 245, 10, 42, 3, 40],
  [/bread|toast/, 265, 9, 49, 3.2, 40],
  [/sweet potato/, 86, 1.6, 20, 0.1],
  [/potato/, 75, 1.8, 16, 0.1],
  [/egg white/, 52, 11, 0.7, 0.2],
  [/egg/, 143, 12.6, 0.7, 9.9, 50],
  [/whey|protein powder|protein shake powder/, 400, 78, 8, 6, 30],
  [/greek yog(h)?urt.*(full|whole)|full.fat greek/, 133, 5, 5, 10],
  [/greek yog(h)?urt|skyr/, 57, 10, 3.6, 0.2],
  [/yog(h)?urt/, 75, 5, 7, 3],
  [/cottage cheese/, 80, 11, 3.5, 2.5],
  [/cheddar|cheese/, 416, 25, 0.1, 35],
  [/mozzarella/, 250, 18, 2, 19],
  [/feta/, 265, 14, 1, 22],
  [/skimmed milk|skim milk/, 35, 3.5, 5, 0.1],
  [/semi.skimmed/, 47, 3.5, 4.8, 1.7],
  [/oat milk/, 46, 0.3, 6.5, 1.5],
  [/almond milk/, 13, 0.4, 0.1, 1.1],
  [/milk/, 64, 3.4, 4.7, 3.6],
  [/peanut butter|almond butter|nut butter/, 600, 25, 13, 50, 15],
  [/butter(?! bean)/, 717, 0.9, 0.1, 81],
  [/olive oil|oil/, 884, 0, 0, 100],
  [/chicken thigh/, 145, 19, 0, 8],
  [/chicken/, 106, 24, 0, 1.4],
  [/turkey mince/, 140, 20, 0, 7],
  [/turkey/, 105, 24, 0, 1],
  [/(5%|lean).*mince|mince.*(5%|lean)/, 124, 21, 0, 4.5],
  [/mince/, 200, 19, 0, 13.5],
  [/sirloin|rump|steak/, 160, 22, 0, 8],
  [/beef/, 160, 22, 0, 8],
  [/pork loin|pork chop/, 140, 22, 0, 6],
  [/bacon/, 167, 16, 0, 11, 25],
  [/ham/, 110, 18, 1, 4],
  [/sausage/, 250, 13, 6, 19, 60],
  [/salmon/, 208, 20, 0, 13],
  [/cod|haddock|white fish|basa|pollock/, 80, 18, 0, 0.7],
  [/tuna/, 109, 25, 0, 1],
  [/prawn|shrimp/, 70, 16, 0, 1],
  [/tofu/, 120, 13, 2, 7],
  [/chickpea/, 120, 7, 16, 2.5],
  [/kidney bean|black bean|mixed bean|baked bean/, 100, 6.5, 14, 0.6],
  [/lentil/, 116, 9, 17, 0.4],
  [/hummus|houmous/, 300, 7, 10, 25],
  [/avocado/, 160, 2, 2, 15, 150],
  [/banana/, 89, 1.1, 23, 0.3, 120],
  [/apple/, 52, 0.3, 12, 0.2, 150],
  [/blueberr/, 57, 0.7, 12, 0.3],
  [/strawberr/, 32, 0.7, 7, 0.3],
  [/berr/, 45, 1, 9, 0.3],
  [/pineapple/, 50, 0.5, 12, 0.1],
  [/orange/, 47, 0.9, 9, 0.1, 160],
  [/honey/, 304, 0.3, 82, 0],
  [/jam/, 250, 0.4, 60, 0.1],
  [/mixed nut|almond|cashew|walnut|nut/, 610, 20, 10, 54],
  [/dark chocolate|chocolate/, 550, 6, 50, 33],
  [/broccoli/, 34, 2.8, 4, 0.4],
  [/spinach/, 23, 2.9, 1.4, 0.4],
  [/asparagus/, 20, 2.2, 1.9, 0.1],
  [/green bean/, 31, 1.8, 4.5, 0.2],
  [/carrot/, 41, 0.9, 8, 0.2],
  [/pepper/, 31, 1, 5, 0.3],
  [/onion/, 40, 1.1, 8, 0.1],
  [/tomato sauce|passata|pasta sauce|marinara/, 45, 1.5, 7, 1],
  [/tomato/, 18, 0.9, 3, 0.2],
  [/mushroom/, 22, 3.1, 0.5, 0.3],
  [/cucumber/, 15, 0.7, 2.6, 0.1],
  [/salad|lettuce|leaves|rocket/, 17, 1.3, 2, 0.3],
  [/mixed veg|stir.fry veg|vegetable/, 40, 2, 6, 0.4],
  [/pea/, 81, 5.4, 10, 0.4],
  [/sweetcorn|corn/, 86, 3.3, 15, 1.4],
  [/soy sauce/, 60, 8, 6, 0.1],
];

const UNIT_GRAMS = { g: 1, gram: 1, grams: 1, kg: 1000, ml: 1, l: 1000, tbsp: 15, tablespoon: 15, tsp: 5, teaspoon: 5, scoop: 30, cup: 240 };
const ITEM_UNITS = /^(|x|item|items|each|whole|unit|units|piece|pieces|slice|slices|egg|eggs|large|medium|small)$/;

const foodFor = name => {
  const text = String(name || "").toLowerCase();
  const row = FOODS.find(([match]) => match.test(text));
  return row ? { kcal: row[1], protein: row[2], carbs: row[3], fat: row[4], itemGrams: row[5] || null } : null;
};

// Grams for an ingredient ({ name, weight, unit }), or null when the unit
// can't be turned into grams.
function gramsOf(ingredient, food) {
  const amount = Number(ingredient?.weight ?? ingredient?.amount);
  if (!(amount > 0)) return null;
  const unit = String(ingredient?.unit ?? "").toLowerCase().trim().replace(/\.$/, "");
  // No unit: a small number of something counted in items ("2 eggs") is
  // items; otherwise grams.
  if (!unit) return food?.itemGrams && amount <= 12 ? amount * food.itemGrams : amount;
  if (UNIT_GRAMS[unit]) return amount * UNIT_GRAMS[unit];
  if (ITEM_UNITS.test(unit) && food?.itemGrams) return amount * food.itemGrams;
  return null;
}

// { calories, protein, carbs, fats, known } for one ingredient.
export function ingredientMacros(ingredient) {
  const food = foodFor(ingredient?.name);
  const grams = food ? gramsOf(ingredient, food) : null;
  if (!food || grams === null) return { calories: 0, protein: 0, carbs: 0, fats: 0, known: false };
  const per = grams / 100;
  return { calories: food.kcal * per, protein: food.protein * per, carbs: food.carbs * per, fats: food.fat * per, known: true };
}

const round = value => Math.round(value);

// A meal's numbers from its ingredients. unknown: ingredients not in the
// table (their numbers can't be checked). complete: every ingredient known.
export function mealMacrosFromIngredients(meal = {}) {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  const totals = { calories: 0, protein: 0, carbs: 0, fats: 0 };
  const unknown = [];
  ingredients.forEach(ingredient => {
    const macros = ingredientMacros(ingredient);
    if (!macros.known) { unknown.push(String(ingredient?.name || "ingredient")); return; }
    Object.keys(totals).forEach(key => { totals[key] += macros[key]; });
  });
  return { calories: round(totals.calories), protein: round(totals.protein), carbs: round(totals.carbs), fats: round(totals.fats), unknown, complete: ingredients.length > 0 && !unknown.length };
}

// The meal with its numbers worked out from its ingredients when every
// ingredient is known; otherwise as given, with the unknown ones listed.
export function withIngredientMacros(meal = {}) {
  const worked = mealMacrosFromIngredients(meal);
  if (!worked.complete) return { ...meal, uncheckedIngredients: worked.unknown };
  const { uncheckedIngredients: _old, ...rest } = meal;
  return { ...rest, calories: worked.calories, protein: worked.protein, carbs: worked.carbs, fats: worked.fats };
}

// A sensible amount after scaling: whole items to the half, grams and ml
// to the nearest 5 (the nearest 1 under 20).
function roundAmount(value, unit) {
  const lower = String(unit || "g").toLowerCase();
  if (UNIT_GRAMS[lower] === undefined) return Math.max(0.5, Math.round(value * 2) / 2);
  if (value < 20) return Math.max(1, Math.round(value));
  return Math.round(value / 5) * 5;
}

// Every portion scaled by the same factor so the meals add up to the
// calorie target. Meals without ingredients have their numbers scaled.
export function scaleMealsToCalories(meals = [], targetCalories = 0) {
  const list = Array.isArray(meals) ? meals : [];
  const total = list.reduce((sum, meal) => sum + (Number(meal?.calories) || 0), 0);
  const target = Number(targetCalories) || 0;
  if (!(total > 0) || !(target > 0)) return list;
  const factor = target / total;
  return list.map(meal => {
    if (Array.isArray(meal.ingredients) && meal.ingredients.length) {
      const scaled = { ...meal, ingredients: meal.ingredients.map(ingredient => ({ ...ingredient, weight: roundAmount((Number(ingredient.weight) || 0) * factor, ingredient.unit) })) };
      const worked = mealMacrosFromIngredients(scaled);
      if (worked.complete) return { ...scaled, calories: worked.calories, protein: worked.protein, carbs: worked.carbs, fats: worked.fats };
      return { ...scaled, calories: round((Number(meal.calories) || 0) * factor), protein: round((Number(meal.protein) || 0) * factor), carbs: round((Number(meal.carbs) || 0) * factor), fats: round((Number(meal.fats) || 0) * factor) };
    }
    return { ...meal, calories: round((Number(meal.calories) || 0) * factor), protein: round((Number(meal.protein) || 0) * factor), carbs: round((Number(meal.carbs) || 0) * factor), fats: round((Number(meal.fats) || 0) * factor) };
  });
}
