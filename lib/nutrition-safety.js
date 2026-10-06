// Calorie safety limits. No calorie target or meal plan in TRACK3D can go
// below a daily minimum: 1,200 kcal for women, 1,500 for men and 1,350 when
// sex isn't given (between the two). These are the usual lowest intakes for
// dieting without medical supervision, and the target calculator already
// uses them as its floor. Change CALORIE_FLOOR to change them everywhere.
export const CALORIE_FLOOR = Object.freeze({ female: 1200, male: 1500, unknown: 1350 });

// A planned loss faster than this share of body weight a week gets a warning.
export const MAX_WEEKLY_LOSS_PERCENT = 1;
export const KCAL_PER_KG = 7700;

// Where to get help with eating worries (UK).
export const EATING_SUPPORT_TEXT = "If food or weight is feeling hard to manage, talk to your GP or Beat (beateatingdisorders.org.uk).";

const kcal = value => Math.round(Number(value) || 0).toLocaleString("en-GB");

// Takes the profile id ("female") or the setup label ("Female").
const sexKey = sex => {
  const value = String(sex || "").trim().toLowerCase();
  return value === "female" || value === "male" ? value : "unknown";
};

export const calorieFloor = sex => CALORIE_FLOOR[sexKey(sex)];

const floorWho = sex => {
  const key = sexKey(sex);
  if (key === "female") return "for women";
  if (key === "male") return "for men";
  return `when sex isn't given (${kcal(CALORIE_FLOOR.female)} for women, ${kcal(CALORIE_FLOOR.male)} for men)`;
};

// Why a daily calorie target can't be used, or "" when it can. An empty
// field ("") is not judged yet; a target of 0 is below the minimum.
export function calorieTargetProblem(calories, sex) {
  if (calories === "" || calories === null || calories === undefined) return "";
  const value = Number(calories) || 0;
  const floor = calorieFloor(sex);
  if (value >= floor) return "";
  return `${kcal(value)} kcal a day is below TRACK3D's minimum of ${kcal(floor)} kcal ${floorWho(sex)}. Eating this little without medical supervision risks losing muscle, low energy and missing nutrients. Raise it to at least ${kcal(floor)} kcal. If a doctor or dietitian has given you a lower target, follow their plan outside the app.`;
}

export const mealPlanCalories = meals => Math.round((meals || []).reduce((total, meal) => total + (Number(meal?.calories) || 0), 0));

// Why a day of meals can't be saved, or "" when it can. label names the meals
// ("Your training day meals").
export function mealPlanFloorProblem(meals, sex, label = "These meals") {
  if (!meals?.length) return "";
  const total = mealPlanCalories(meals);
  const floor = calorieFloor(sex);
  if (total >= floor) return "";
  return `${label} add up to ${kcal(total)} kcal, below the minimum of ${kcal(floor)} kcal a day ${floorWho(sex)}. Add food or bigger portions to reach at least ${kcal(floor)} kcal.`;
}

// The planned loss from eating `calories` a day against `maintenance`, as kg
// and % of body weight a week, or null when it can't be worked out or there
// is no deficit.
export function plannedWeeklyLoss({ calories, maintenance, weight } = {}) {
  const intake = Number(calories), tdee = Number(maintenance), kg = Number(weight);
  if (!(intake > 0 && tdee > 0 && kg > 0) || intake >= tdee) return null;
  const kgPerWeek = ((tdee - intake) * 7) / KCAL_PER_KG;
  return { kgPerWeek, percent: (kgPerWeek / kg) * 100 };
}

// A warning when the planned loss is more than 1% of body weight a week, or "".
export function weeklyLossWarning({ calories, maintenance, weight, estimated = false } = {}) {
  const loss = plannedWeeklyLoss({ calories, maintenance, weight });
  if (!loss || loss.percent <= MAX_WEEKLY_LOSS_PERCENT) return "";
  return `At ${kcal(calories)} kcal a day you'd lose about ${loss.kgPerWeek.toFixed(1)} kg a week, ${loss.percent.toFixed(1)}% of your body weight (${estimated ? "estimated " : ""}maintenance is about ${kcal(maintenance)} kcal). Losing more than ${MAX_WEEKLY_LOSS_PERCENT}% a week risks muscle loss, low energy and rebound eating; about 0.5–1% a week is a safer pace.`;
}
