// Nutrition setup: one goal list, the calorie and macro sum, activity levels,
// meal times from the user's wake-up time, and the allergy check that every
// meal builder (AI, tweaks, rest day, review) runs against.
//
// The numbers here (deficits, surpluses, protein per kg, fat share) are a
// starting point and should be checked by a qualified coach or dietitian.
import { HEIGHT_PROBLEM, ageFromDateOfBirth, heightInRange, sexLabel } from "./profile.js";
import { calorieFloor } from "./nutrition-safety.js";

export const NUTRITION_GOALS = [
  { id: "Lose fat", description: "Lose about 0.5% of your body weight a week" },
  { id: "Maintain", description: "Keep your weight steady" },
  { id: "Lean bulk", description: "Gain slowly with a small surplus, keeping fat gain low" },
  { id: "Bulk", description: "Gain faster with a bigger surplus" },
];

const GOAL_SETTINGS = {
  "Lose fat": { proteinPerKg: 2.2, fatShare: 0.25 },
  Maintain: { proteinPerKg: 1.8, fatShare: 0.3 },
  "Lean bulk": { proteinPerKg: 2.0, fatShare: 0.25, surplus: 250 },
  Bulk: { proteinPerKg: 1.8, fatShare: 0.25, surplus: 450 },
};

// Saved plans and the old AI questions used other names for the same goals.
export function normaliseNutritionGoal(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return null;
  if (/lean/.test(text)) return "Lean bulk";
  if (/cut|lose|loss|fat/.test(text)) return "Lose fat";
  if (/build muscle/.test(text)) return "Lean bulk";
  if (/bulk|gain/.test(text)) return "Bulk";
  if (/maintain|performance/.test(text)) return "Maintain";
  return null;
}

export const ACTIVITY_LEVELS = [
  { id: "Sedentary", factor: 1.2, description: "Desk job, under about 5,000 steps a day, little or no exercise" },
  { id: "Lightly active", factor: 1.375, description: "Some walking (about 5,000–8,000 steps) or 1–2 workouts a week" },
  { id: "Moderately active", factor: 1.55, description: "On your feet a lot (8,000–12,000 steps) or 3–5 workouts a week" },
  { id: "Very active", factor: 1.725, description: "Physical job, or hard training 6–7 days a week" },
];

// A starting suggestion from the training days in the user's split.
export function suggestActivityLevel(trainingDays) {
  const days = Number(trainingDays) || 0;
  if (days >= 6) return "Very active";
  if (days >= 3) return "Moderately active";
  if (days >= 1) return "Lightly active";
  return "Sedentary";
}

export const SEX_OPTIONS = ["Male", "Female", "Prefer not to say"];

// Returns the problem with the stats, or "" when they can be used.
export function setupStatsProblem({ weight, height, age, sex } = {}) {
  const w = Number(weight), h = Number(height), a = Number(age);
  if (!(w >= 30 && w <= 300)) return "Enter your weight in kg (30–300).";
  if (!heightInRange(h)) return HEIGHT_PROBLEM;
  if (age === null || age === undefined || age === "" || !(a >= 0)) return "Enter your date of birth.";
  if (!(a >= 16 && a <= 90)) return "The calorie sum is for ages 16–90. Under 16s should get targets from a GP or dietitian.";
  if (!SEX_OPTIONS.includes(sex)) return "Choose an option for sex, used in the calorie sum.";
  return "";
}

// Mifflin-St Jeor resting energy. "Prefer not to say" uses the average of
// the male (+5) and female (-161) results.
export function restingCalories({ weight, height, age, sex }) {
  const base = 10 * Number(weight) + 6.25 * Number(height) - 5 * Number(age);
  const adjust = sex === "Male" ? 5 : sex === "Female" ? -161 : -78;
  return Math.round(base + adjust);
}

export function calculateNutritionTargets(stats = {}) {
  if (setupStatsProblem(stats)) return null;
  const weight = Number(stats.weight);
  const goal = normaliseNutritionGoal(stats.goal) || "Maintain";
  const settings = GOAL_SETTINGS[goal];
  const activity = ACTIVITY_LEVELS.find(level => level.id === stats.activityLevel) || ACTIVITY_LEVELS[2];
  const bmr = restingCalories(stats);
  const tdee = Math.round(bmr * activity.factor);
  // Fat loss: about 0.5% of body weight a week (7,700 kcal per kg), at most
  // a quarter of maintenance. Gains use a fixed surplus.
  const adjustment = goal === "Lose fat"
    ? -Math.round(Math.min((weight * 0.005 * 7700) / 7, tdee * 0.25))
    : settings.surplus || 0;
  // Never set a target below resting energy or the daily minimum.
  const floor = Math.max(bmr, calorieFloor(stats.sex));
  const calories = Math.round(Math.max(floor, tdee + adjustment) / 10) * 10;
  const protein = Math.round(weight * settings.proteinPerKg);
  const fats = Math.round((calories * settings.fatShare) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fats * 9) / 4));
  return { calories, protein, carbs, fats, tdee, bmr, adjustment: calories - tdee, goal, activityLevel: activity.id };
}

// ── Meal times ──────────────────────────────────────────────────────────────
// Targets worked out again from the user's profile, when they differ from
// the saved plan by more than 5% (for example a plan made before the profile
// was complete). The weight and choices the plan was set up with are kept;
// without a known weight there is nothing to suggest. Returns
// { targets, stats } or null.
export function targetUpdateSuggestion({ plan, profile, weight = null, activityLevel = null, todayKey } = {}) {
  const current = Number(plan?.daily_calories) || 0;
  if (!current || !profile?.heightCm || !profile?.dateOfBirth || !profile?.sex) return null;
  const setup = plan.setup || {};
  const stats = {
    weight: Number(setup.weight) || Number(weight) || null,
    height: profile.heightCm,
    age: ageFromDateOfBirth(profile.dateOfBirth, todayKey),
    sex: sexLabel(profile.sex),
    activityLevel: ACTIVITY_LEVELS.some(level => level.id === setup.activityLevel) ? setup.activityLevel : activityLevel || ACTIVITY_LEVELS[2].id,
    goal: normaliseNutritionGoal(setup.goal || plan.goal) || "Maintain",
  };
  const targets = calculateNutritionTargets(stats);
  if (!targets || Math.abs(targets.calories - current) / current <= 0.05) return null;
  return { targets, stats };
}

const toMinutes = time => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const toTime = minutes => {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

// First meal an hour after waking, last about 13 hours after waking, the
// rest spread evenly between, on the quarter hour.
export function mealTimeSlots(wakeTime, count) {
  const wake = toMinutes(wakeTime);
  const total = Math.max(0, Number(count) || 0);
  if (wake === null || !total) return [];
  const first = wake + 60;
  const last = wake + 13 * 60;
  if (total === 1) return [toTime(first)];
  const step = (last - first) / (total - 1);
  return Array.from({ length: total }, (_, index) => toTime(Math.round((first + step * index) / 15) * 15));
}

// Gives meals times that fit the user's day, in order. A time the user typed
// themselves (manualTime) is kept.
export function applyMealTimes(meals = [], wakeTime) {
  const slots = mealTimeSlots(wakeTime, meals.length);
  if (!slots.length) return meals;
  const wake = toMinutes(wakeTime);
  // Order by the meal's original time relative to waking; untimed meals go last, in order.
  const sortKey = meal => {
    const minutes = toMinutes(meal.baseTime || meal.time);
    return minutes === null ? null : (minutes - wake + 1440) % 1440;
  };
  const ordered = meals.map((meal, index) => ({ meal, index, key: sortKey(meal) }))
    .sort((a, b) => (a.key ?? 10000 + a.index) - (b.key ?? 10000 + b.index) || a.index - b.index);
  return ordered.map(({ meal }, position) => (meal.manualTime
    ? meal
    : { ...meal, baseTime: meal.baseTime || meal.time || slots[position], time: slots[position] }));
}

// ── Allergies ───────────────────────────────────────────────────────────────
const ALLERGEN_GROUPS = [
  { match: /lactose|dairy|milk|cheese|casein|whey/, terms: ["milk", "cheese", "yoghurt", "yogurt", "whey", "butter", "cream", "cottage cheese", "feta", "mozzarella", "parmesan", "cheddar", "halloumi", "skyr", "quark", "kefir", "ghee", "casein", "paneer", "custard", "ice cream"] },
  { match: /gluten|wheat|coeliac|celiac/, terms: ["bread", "pasta", "wheat", "flour", "wrap", "bagel", "couscous", "barley", "rye", "tortilla", "noodle", "toast", "granola", "cereal", "cracker", "sourdough", "pitta", "pita", "spaghetti", "seitan", "beer", "oats", "porridge", "muffin", "pancake", "crumpet", "biscuit"] },
  { match: /peanut|groundnut/, terms: ["peanut", "groundnut", "satay"] },
  { match: /tree nut|\bnuts?\b/, terms: ["nut", "almond", "cashew", "walnut", "hazelnut", "pecan", "pistachio", "macadamia", "marzipan", "praline", "nut butter"] },
  { match: /\beggs?\b/, terms: ["egg", "omelette", "frittata", "mayonnaise", "mayo", "meringue", "quiche"] },
  { match: /shellfish|crustacean|prawn|shrimp/, terms: ["prawn", "shrimp", "crab", "lobster", "mussel", "scallop", "oyster", "clam", "squid", "shellfish"] },
  { match: /\bfish\b|seafood/, terms: ["fish", "salmon", "tuna", "cod", "haddock", "mackerel", "sardine", "anchovy", "trout", "sea bass", "tilapia", "pollock", "basa"] },
  { match: /\bsoy|soya/, terms: ["soy", "soya", "tofu", "edamame", "tempeh", "miso"] },
  { match: /sesame/, terms: ["sesame", "tahini", "hummus", "houmous"] },
];
const NO_ALLERGY = /^(none|no|nope|nothing|n\/a|na|-|no allergies|none known|not that i know of)$/i;

export function parseAllergies(text) {
  return String(text || "")
    .split(/,|;|\/|\n|\band\b|&/i)
    .map(item => item.trim().toLowerCase().replace(/\s*(allergy|allergic|intolerance|intolerant)\s*/g, " ").trim())
    .filter(item => item && !NO_ALLERGY.test(item))
    .filter((item, index, all) => all.indexOf(item) === index);
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function allergyTerms(allergy) {
  const own = allergy.replace(/s$/, "");
  const groups = ALLERGEN_GROUPS.filter(group => group.match.test(allergy));
  return [...new Set([own, ...groups.flatMap(group => group.terms)])].filter(Boolean);
}

// Text that names a food which is safe despite containing an allergen word.
function safeText(text, allergy) {
  let cleaned = text.toLowerCase();
  cleaned = cleaned.replace(new RegExp(`\\b${escape(allergy.replace(/s$/, ""))}s?[- ]free\\s+[a-z]+`, "g"), " ");
  if (/lactose|dairy|milk|cheese|casein|whey/.test(allergy)) cleaned = cleaned.replace(/\b(almond|oat|soy|soya|coconut|rice|cashew|hemp)\s+(milk|yoghurt|yogurt|cream)\b/g, " ").replace(/\b(peanut|almond|cashew|nut|seed|cocoa|apple)\s+butter\b/g, " ").replace(/\bcream of tartar\b/g, " ");
  if (/gluten|wheat|coeliac|celiac/.test(allergy)) cleaned = cleaned.replace(/\b(rice|corn|gluten[- ]free|buckwheat)\s+(noodles?|pasta|bread|wraps?|tortillas?|crackers?|cakes?)\b/g, " ").replace(/\brice\s+cakes?\b/g, " ");
  if (/\bnuts?\b|tree nut/.test(allergy)) cleaned = cleaned.replace(/\b(coconut|nutmeg|butternut|nutritional yeast)\b/g, " ");
  return cleaned;
}

export function mealText(meal) {
  return [meal?.name, meal?.exampleName, ...(meal?.ingredients || []).map(item => item?.name)].filter(Boolean).join(" · ");
}

// Every meal that names a food the user listed as an allergy.
export function mealAllergyConflicts(meals = [], allergies = []) {
  const list = Array.isArray(allergies) ? allergies : parseAllergies(allergies);
  if (!list.length) return [];
  const conflicts = [];
  meals.forEach((meal, index) => {
    const raw = mealText(meal);
    if (!raw) return;
    list.forEach(allergy => {
      const text = safeText(raw, allergy);
      const term = allergyTerms(allergy).find(word => new RegExp(`\\b${escape(word)}(s|es)?\\b`, "i").test(text));
      if (term) conflicts.push({ index, meal: meal.name, allergy, term });
    });
  });
  return conflicts;
}

export function allergyConflictText(conflicts = []) {
  return conflicts.map(item => `${item.meal} (${item.term} — ${item.allergy})`).join("; ");
}

// The hard rule every meal-building prompt carries.
export function allergyRule(allergies = []) {
  const list = Array.isArray(allergies) ? allergies : parseAllergies(allergies);
  return list.length
    ? `ALLERGIES — the user is allergic or intolerant to: ${list.join(", ")}. Never include these or any food that contains them, in any meal or ingredient. If a requested change would add one, leave it out and say nothing else.`
    : "Allergies: none reported.";
}

// ── AI questions ────────────────────────────────────────────────────────────
// Goal, meals per day and training days come from the setup itself, so the
// AI questions only ask what changes the food. Allergies are asked first.
export const AI_NUTRITION_QUESTIONS = [
  { id: "allergies", q: "Any food allergies or intolerances?", type: "text", placeholder: "e.g. peanuts, lactose — or none", required: true, quick: "NO ALLERGIES" },
  { id: "diet_type", q: "Any dietary preference?", type: "choice", options: ["No restrictions", "Vegetarian", "Vegan", "Pescatarian", "Halal", "Low carb"] },
  { id: "disliked_foods", q: "Any foods you dislike or want to avoid?", type: "text", placeholder: "e.g. mushrooms, olives — or none" },
  { id: "favourite_foods", q: "Any foods you love and want included?", type: "text", placeholder: "e.g. chicken, rice, oats" },
  { id: "cooking_time", q: "How much time can you spend cooking per day?", type: "choice", options: ["Minimal (quick meals)", "About 30 minutes", "About an hour", "I enjoy cooking"] },
  { id: "budget", q: "Roughly what is your weekly food budget?", type: "choice", options: ["Under £50", "£50–100", "£100+"], optional: true },
];

export function preferencesText(answers = {}) {
  return AI_NUTRITION_QUESTIONS
    .filter(question => question.id !== "allergies" && String(answers[question.id] || "").trim())
    .map(question => `${question.q} ${String(answers[question.id]).trim()}`)
    .join("\n");
}
