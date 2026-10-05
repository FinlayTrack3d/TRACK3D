import test from "node:test";
import assert from "node:assert/strict";
import { addExtraFood, addOffPlanMacros, calculateLoggedNutrition, dayTargets, offPlanNutrition, remainingNutritionTargets, restDayCalories, roughMacros } from "../lib/nutrition-plan.js";
import { setupStatsProblem, targetUpdateSuggestion } from "../lib/nutrition-setup.js";
import { missingProfileFields, profileProblem } from "../lib/profile.js";
import { buildWeeklyMetrics, nutritionDayOnTarget } from "../lib/weekly-report.js";
import { activityLogRow, activityOfLog, activitySession, activitySummary, sessionPlannedMinutes, summariseWorkoutForCoach } from "../lib/fitness-session.js";
import { calorieScore, dailyScore } from "../lib/daily-score.js";
import { linkedHabitIds } from "../lib/habit-links.js";

const plan = { daily_calories: 2381, protein_target: 115, carbs_target: 300, fats_target: 80, meals: [{ name: "A", calories: 1875, protein: 144 }], rest_day_meals: [{ name: "R", calories: 1530, protein: 110 }] };

test("rest days with their own meals get a lighter target", () => {
  assert.equal(restDayCalories(2381), 2100, "about 12% lighter, in the 2,050–2,150 range");
  assert.deepEqual(dayTargets(plan, true), { calories: 2381, protein: 115, carbs: 300, fats: 80, restDay: false });
  const rest = dayTargets(plan, false);
  assert.equal(rest.calories, 2100);
  assert.equal(rest.protein, 115, "same protein");
  assert.equal(rest.fats, 80);
  assert.equal(rest.carbs, 230, "the difference comes from carbs");
  assert.equal(rest.restDay, true);
  // Rest days that eat the training day meals keep the training target.
  assert.equal(dayTargets({ ...plan, rest_day_meals: [] }, false).calories, 2381);
  // A rest day is judged against its own target.
  assert.equal(nutritionDayOnTarget({ is_training_day: false, total_calories: 2080, total_protein: 115 }, plan), true);
  assert.equal(nutritionDayOnTarget({ is_training_day: true, total_calories: 2080, total_protein: 115 }, plan), false);
});

test("off-plan calories always come with protein, carbs and fat", () => {
  assert.deepEqual(roughMacros(1000), { protein: 38, carbs: 113, fats: 44 });
  // Calories typed in with no figures: a rough split.
  const typed = offPlanNutrition(1000, null);
  assert.equal(typed.roughCalories, 1000);
  assert.equal(Math.round(typed.carbs), 113);
  // Figures from an estimate cover their calories; the rest is rough.
  const mixed = offPlanNutrition(1500, { calories: 1000, protein: 40, carbs: 100, fats: 50 });
  assert.equal(mixed.roughCalories, 500);
  assert.equal(Math.round(mixed.protein), 40 + 19);
  // Older figures without calories covered everything.
  assert.equal(offPlanNutrition(400, { protein: 30, carbs: 50, fats: 10 }).roughCalories, 0);
  // Calories lowered afterwards scale the figures down.
  assert.equal(Math.round(offPlanNutrition(500, { calories: 1000, protein: 40, carbs: 100, fats: 50 }).protein), 20);
  // Off-plan calories cleared: older figures left behind count for nothing.
  assert.deepEqual(offPlanNutrition(0, { protein: 30, carbs: 50, fats: 10 }), { calories: 0, protein: 0, carbs: 0, fats: 0, roughCalories: 0 });
  assert.equal(calculateLoggedNutrition([], { _off_plan: { protein: 30, carbs: 50, fats: 10 } }, 0).protein, 0);
  // The reported case: 0 kcal left can't leave 264 g of carbs.
  const logged = calculateLoggedNutrition([{ name: "A", calories: 1300, protein: 85, carbs: 140, fats: 40 }], { 0: true }, 2420);
  assert.equal(logged.carbs, 140 + 272);
  assert.deepEqual(remainingNutritionTargets({ calories: 2381, protein: 115, carbs: 300, fats: 80 }, logged), { calories: 0, protein: 0, carbs: 0, fats: 0 });
});

test("log something else adds food with figures, rough where blank", () => {
  // A quick add with all figures.
  const banana = addExtraFood({ food: "", calories: 0, results: {} }, { name: "Banana", calories: 105, protein: 1, carbs: 27, fats: 0 });
  assert.equal(banana.food, "Banana");
  assert.equal(banana.calories, 105);
  assert.deepEqual(banana.results._off_plan, { calories: 105, protein: 1, carbs: 27, fats: 0 });
  // Calories only: no figures stored, the rough split applies when added up.
  const takeaway = addExtraFood(banana, { name: "Takeaway", calories: 900 });
  assert.equal(takeaway.food, "Banana; Takeaway");
  assert.equal(takeaway.calories, 1005);
  assert.deepEqual(takeaway.results._off_plan, { calories: 105, protein: 1, carbs: 27, fats: 0 });
  assert.equal(offPlanNutrition(takeaway.calories, takeaway.results._off_plan).roughCalories, 900);
  // Some figures given: the blanks come from the rough split of that food.
  const shake = addExtraFood({ food: "", calories: 0, results: {} }, { name: "Shake", calories: 400, protein: "40" });
  assert.deepEqual(shake.results._off_plan, { calories: 400, protein: 40, carbs: 45, fats: 18 });
  // Older figures without calories keep covering only what came before.
  const older = addExtraFood({ food: "toast", calories: 400, results: { _off_plan: { protein: 30, carbs: 50, fats: 10 } } }, { name: "Crisps", calories: 170 });
  assert.equal(older.results._off_plan.calories, 400);
  assert.equal(offPlanNutrition(older.calories, older.results._off_plan).roughCalories, 170);
  // An estimate's middle values.
  assert.deepEqual(addOffPlanMacros({}, { caloriesMid: 2520, proteinMid: 86, carbsMid: 263, fatsMid: 80 }, 0)._off_plan, { calories: 2520, protein: 86, carbs: 263, fats: 80 });
});

test("a complete profile suggests new targets when the plan is out of date", () => {
  const profile = { heightCm: 178, dateOfBirth: "1995-01-01", sex: "male" };
  const old = { daily_calories: 2381, protein_target: 115, goal: "Maintain", setup: { weight: 82, activityLevel: "Moderately active", goal: "Maintain" } };
  const suggestion = targetUpdateSuggestion({ plan: old, profile, todayKey: "2026-10-05" });
  assert.ok(suggestion);
  assert.ok(suggestion.targets.calories > 2600, `recalculated ${suggestion.targets.calories}`);
  assert.equal(suggestion.stats.height, 178);
  // Close enough: nothing to suggest.
  assert.equal(targetUpdateSuggestion({ plan: { ...old, daily_calories: suggestion.targets.calories }, profile, todayKey: "2026-10-05" }), null);
  // An incomplete profile or no known weight: nothing to suggest.
  assert.equal(targetUpdateSuggestion({ plan: old, profile: { heightCm: 178 }, todayKey: "2026-10-05" }), null);
  assert.equal(targetUpdateSuggestion({ plan: { ...old, setup: {} }, profile, todayKey: "2026-10-05" }), null);
  assert.ok(targetUpdateSuggestion({ plan: { ...old, setup: {} }, profile, weight: "82", todayKey: "2026-10-05" }), "last weigh-in used");
});

test("the profile can be saved a part at a time, with one height range", () => {
  const today = "2026-10-05";
  assert.equal(profileProblem({ experienceLevel: "advanced" }, today, { partial: true }), "", "training experience on its own");
  assert.equal(profileProblem({ heightCm: "178" }, today, { partial: true }), "");
  assert.match(profileProblem({ heightCm: "60" }, today, { partial: true }), /100–250/);
  assert.match(profileProblem({ dateOfBirth: "2030-01-01" }, today, { partial: true }), /date of birth/);
  assert.deepEqual(missingProfileFields({ heightCm: "178", experienceLevel: "beginner" }), ["date of birth", "sex"]);
  // The nutrition setup uses the same range as the profile.
  assert.equal(setupStatsProblem({ weight: 80, height: 110, age: 30, sex: "Male" }), "");
  assert.match(setupStatsProblem({ weight: 80, height: 260, age: 30, sex: "Male" }), /100–250/);
});

test("missed sessions only count from the day the current plan started", () => {
  const sessions = [{ name: "Upper", days: ["MON"] }, { name: "Lower", days: ["THU"] }];
  const week = { start: "2026-09-28", end: "2026-10-04", inProgress: false };
  const before = buildWeeklyMetrics({ week, todayKey: "2026-10-05", sessions, planStartKey: "2026-10-05", workoutLogs: [{ date: "2026-09-29", total_volume: 1000, duration_mins: 40 }] });
  assert.equal(before.workouts.planned, null, "a different plan was active that week");
  assert.equal(before.workouts.missed, null);
  assert.equal(before.workouts.completed, 1);
  const midWeek = buildWeeklyMetrics({ week, todayKey: "2026-10-05", sessions, planStartKey: "2026-09-30", workoutLogs: [] });
  assert.equal(midWeek.workouts.planned, 1, "only Thursday was under this plan");
  assert.equal(midWeek.workouts.missed, 1);
  const whole = buildWeeklyMetrics({ week, todayKey: "2026-10-05", sessions, planStartKey: "2026-09-01", workoutLogs: [{ date: "2026-09-28", total_volume: 1000, duration_mins: 40 }] });
  assert.equal(whole.workouts.planned, 2);
  assert.equal(whole.workouts.missed, 1);
  // This week so far: today's session can still happen.
  const current = buildWeeklyMetrics({ week: { start: "2026-10-05", end: "2026-10-11", inProgress: true }, todayKey: "2026-10-05", sessions, planStartKey: "2026-09-01", workoutLogs: [] });
  assert.equal(current.workouts.missed, 0);
});

test("one session length everywhere", () => {
  assert.equal(sessionPlannedMinutes({ duration_mins: 30, exercises: [{ sets: 4 }, { sets: 6 }] }), 30, "the saved length wins");
  assert.equal(sessionPlannedMinutes({ exercises: [{ sets: 4 }, { sets: 6 }] }), 35);
  assert.equal(sessionPlannedMinutes({ exercises: [] }), 0);
});

test("activities are logged with a duration and an effort", () => {
  const row = activityLogRow({ userId: "u", date: "2026-10-05", type: "run", minutes: "45", effort: "hard", distanceKm: "5.0" });
  assert.equal(row.session_name, "Run");
  assert.equal(row.duration_mins, 45);
  assert.equal(row.total_volume, 0);
  assert.equal(row.in_progress, false);
  assert.deepEqual(activityOfLog(row), { name: "Run", type: "run", effort: "hard", distanceKm: 5, notes: "" });
  assert.equal(activitySummary(row), "45 min · Hard · 5 km");
  assert.match(summariseWorkoutForCoach(row), /- Run: 45 min · Hard · 5 km/);
  assert.equal(activityOfLog({ exercises: [{ name: "Bench", sets: [] }] }), null);
  const planned = activitySession({ type: "hyrox", days: ["saturday"], minutes: 60 });
  assert.deepEqual(planned, { name: "HYROX", kind: "activity", activityType: "hyrox", days: ["SAT"], duration_mins: 60, exercises: [], approval: { approved: true } });
  assert.equal(sessionPlannedMinutes(planned), 60);
});

test("the daily score shows its parts and doesn't reward eating well over target", () => {
  assert.equal(calorieScore(1000, 2000), 0.5);
  assert.equal(calorieScore(2150, 2000), 1, "up to 10% over is on target");
  assert.ok(calorieScore(2600, 2000) < calorieScore(2300, 2000), "further over scores lower");
  const { score, parts } = dailyScore({ habitsDone: 1, habitsTotal: 2, hasRoutine: true, morningDone: true, morningScore: 8, caloriesEaten: 2000, calorieGoal: 2000, workoutScheduled: true, workoutDone: false });
  assert.equal(score, Math.round(((0.5 + 0.8 + 1 + 0) / 4) * 100));
  assert.deepEqual(parts.map(part => `${part.label} ${part.text}`), ["Habits 1/2", "Morning 8/10", "Calories 100% of target", "Workout to do"]);
  // Parts that aren't set up don't count against the day.
  assert.equal(dailyScore({ caloriesEaten: 1000, calorieGoal: 2000 }).score, 50);
  assert.equal(dailyScore({}).score, 0);
});

test("a morning task ticks the habit that is the same thing", () => {
  const habits = [{ id: 1, name: "Stretch or move", done: false }, { id: 2, name: "Read for 10 minutes", done: false }, { id: 3, name: "Go for a walk", done: true }];
  assert.deepEqual(linkedHabitIds("Stretch / Mobility", habits), [1]);
  assert.deepEqual(linkedHabitIds("Read", habits), [2]);
  assert.deepEqual(linkedHabitIds("Go for a walk", habits), [], "already done");
  assert.deepEqual(linkedHabitIds("Brush teeth", habits), []);
});
