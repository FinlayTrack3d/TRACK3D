// Weekly Report metrics, worked out from data TRACK3D already stores:
// workout_logs (with the PB flag saved on each set), workout_splits,
// habits + habit_completions, morning_checkins, nutrition_logs and
// nutrition_plans. A metric is null when its data does not exist, so the
// report never shows an invented number.
import { workoutPersonalBests } from "./fitness-session.js";
import { dayStreak, isCompletedMorning, morningStreak, shiftDateKey } from "./streaks.js";

const dayOfWeek = (dateKey) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();

export function weekStartOf(dateKey) {
  return shiftDateKey(dateKey, -((dayOfWeek(dateKey) + 6) % 7));
}

// The week the report covers: the current week on a Sunday (its last day),
// otherwise the last completed Monday-to-Sunday week. offset steps back
// whole weeks from there.
export function reportWeek(todayKey, offset = 0) {
  const latestStart = dayOfWeek(todayKey) === 0 ? weekStartOf(todayKey) : shiftDateKey(weekStartOf(todayKey), -7);
  const start = shiftDateKey(latestStart, -7 * offset);
  const end = shiftDateKey(start, 6);
  return { start, end, inProgress: end >= todayKey };
}

const inRange = (dateKey, start, end) => typeof dateKey === "string" && dateKey >= start && dateKey <= end;
const isRealWorkout = (log) => !log.in_progress && (Number(log.total_volume) > 0 || (Number(log.duration_mins) || 0) >= 2);

function daysBetween(start, end) {
  if (end < start) return [];
  const days = [];
  for (let key = start; key <= end; key = shiftDateKey(key, 1)) days.push(key);
  return days;
}

function longestRun(dateKeys) {
  const sorted = [...new Set(dateKeys)].sort();
  let best = 0;
  let run = 0;
  sorted.forEach((key, index) => {
    run = index > 0 && shiftDateKey(sorted[index - 1], 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

// Same rule the Nutrition screen uses for an on-target day.
export function nutritionDayOnTarget(log, plan) {
  const calorieTarget = Number(plan?.daily_calories) || 0;
  const proteinTarget = Number(plan?.protein_target) || 0;
  const caloriesOnTarget = calorieTarget ? Math.abs((Number(log.total_calories) || 0) - calorieTarget) / calorieTarget <= 0.1 : true;
  const proteinOnTarget = proteinTarget ? (Number(log.total_protein) || 0) >= proteinTarget * 0.9 : true;
  return caloriesOnTarget && proteinOnTarget;
}

function workoutMetrics(logs, sessions, start, end) {
  const week = logs.filter((log) => isRealWorkout(log) && inRange(log.date, start, end));
  const previousStart = shiftDateKey(start, -7);
  const previousEnd = shiftDateKey(start, -1);
  const previous = logs.filter((log) => isRealWorkout(log) && inRange(log.date, previousStart, previousEnd));
  const planned = new Set((sessions || []).flatMap((session) => (session.days || []).map((day) => String(day).toUpperCase()))).size;
  if (!week.length && !planned) return null;
  const volume = Math.round(week.reduce((total, log) => total + (Number(log.total_volume) || 0), 0));
  const previousVolume = Math.round(previous.reduce((total, log) => total + (Number(log.total_volume) || 0), 0));
  const personalBests = week.flatMap((log) => workoutPersonalBests(log.exercises || []).map((pb) => ({ ...pb, date: log.date })));
  return {
    completed: week.length,
    planned: planned || null,
    volume,
    previousVolume: previous.length ? previousVolume : null,
    volumeChangePct: previous.length && previousVolume > 0 ? Math.round(((volume - previousVolume) / previousVolume) * 100) : null,
    previousCompleted: previous.length,
    minutes: week.reduce((total, log) => total + (Number(log.duration_mins) || 0), 0),
    personalBests,
  };
}

function habitMetrics(habits, completions, start, end, todayKey) {
  if (!habits?.length) return null;
  const lastDay = end < todayKey ? end : todayKey;
  const datesByHabit = new Map();
  (completions || []).forEach((row) => {
    const id = String(row.habit_id);
    datesByHabit.set(id, [...(datesByHabit.get(id) || []), row.date]);
  });
  let possible = 0;
  let done = 0;
  let currentStreak = 0;
  let currentStreakHabit = null;
  let bestStreak = 0;
  habits.forEach((habit) => {
    const created = String(habit.created_at || "").slice(0, 10);
    const from = created && created > start ? created : start;
    const days = daysBetween(from, lastDay);
    const dates = (datesByHabit.get(String(habit.id)) || []).filter((key) => key <= todayKey);
    possible += days.length;
    done += days.filter((key) => dates.includes(key)).length;
    const streak = dayStreak(dates, todayKey);
    if (streak > currentStreak) { currentStreak = streak; currentStreakHabit = habit.name; }
    bestStreak = Math.max(bestStreak, longestRun(dates));
  });
  return {
    completionPct: possible ? Math.round((done / possible) * 100) : null,
    done,
    possible,
    currentStreak,
    currentStreakHabit,
    bestStreak,
  };
}

function morningMetrics(checkins, hasRoutine, start, end, todayKey) {
  if (!hasRoutine && !(checkins || []).length) return null;
  const days = daysBetween(start, end < todayKey ? end : todayKey).length;
  const week = (checkins || []).filter((entry) => inRange(entry.date, start, end) && isCompletedMorning(entry));
  const scores = week.map((entry) => Number(entry.score)).filter((score) => Number.isFinite(score) && score > 0);
  return {
    completed: week.length,
    days,
    averageScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    currentStreak: morningStreak(checkins, todayKey),
  };
}

function bodyWeightMetrics(checkins, start, end) {
  const weighIns = (checkins || [])
    .filter((entry) => inRange(entry.date, start, end) && Number(entry.data?.weight) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length < 2) return null;
  const first = Number(weighIns[0].data.weight);
  const last = Number(weighIns.at(-1).data.weight);
  return { first, last, change: Math.round((last - first) * 10) / 10, weighIns: weighIns.length };
}

function nutritionMetrics(logs, plan, start, end, todayKey) {
  const week = (logs || []).filter((log) => inRange(log.date, start, end));
  if (!plan && !week.length) return null;
  const days = daysBetween(start, end < todayKey ? end : todayKey).length;
  const hasTargets = Boolean(Number(plan?.daily_calories) || Number(plan?.protein_target));
  const average = (key) => (week.length ? Math.round(week.reduce((total, log) => total + (Number(log[key]) || 0), 0) / week.length) : null);
  return {
    loggedDays: week.length,
    days,
    onTargetDays: hasTargets ? week.filter((log) => nutritionDayOnTarget(log, plan)).length : null,
    averageCalories: average("total_calories"),
    averageProtein: average("total_protein"),
    calorieTarget: Number(plan?.daily_calories) || null,
    proteinTarget: Number(plan?.protein_target) || null,
  };
}

export function buildWeeklyMetrics({ week, todayKey, workoutLogs = [], sessions = [], habits = [], habitCompletions = [], checkins = [], hasMorningRoutine = false, nutritionLogs = [], nutritionPlan = null }) {
  const { start, end } = week;
  const metrics = {
    week,
    workouts: workoutMetrics(workoutLogs, sessions, start, end),
    habits: habitMetrics(habits, habitCompletions, start, end, todayKey),
    morning: morningMetrics(checkins, hasMorningRoutine, start, end, todayKey),
    bodyWeight: bodyWeightMetrics(checkins, start, end),
    nutrition: nutritionMetrics(nutritionLogs, nutritionPlan, start, end, todayKey),
  };
  metrics.hasData = Boolean(
    metrics.workouts?.completed || metrics.habits?.done || metrics.morning?.completed || metrics.nutrition?.loggedDays,
  );
  return metrics;
}

// Plain facts for the coach summary, so the AI only describes numbers that exist.
export function weeklyFactsForCoach(metrics) {
  const lines = [];
  const { workouts, habits, morning, bodyWeight, nutrition } = metrics;
  if (workouts) {
    lines.push(`Workouts completed: ${workouts.completed}${workouts.planned ? ` of ${workouts.planned} planned` : ""}`);
    if (workouts.completed) lines.push(`Training volume: ${workouts.volume} kg over ${workouts.minutes} minutes`);
    if (workouts.volumeChangePct !== null) lines.push(`Volume vs previous week: ${workouts.volumeChangePct > 0 ? "+" : ""}${workouts.volumeChangePct}%`);
    if (workouts.completed && workouts.previousVolume === null) lines.push("This is the first tracked week of training: it is the baseline, so there is nothing to compare it with yet");
    if (workouts.completed && workouts.minutes < workouts.completed * 5) lines.push(`Logged training time looks implausibly short (${workouts.minutes} min for ${workouts.completed} workout${workouts.completed === 1 ? "" : "s"}), so do not rely on it`);
    if (workouts.personalBests.length) lines.push(`New personal bests: ${workouts.personalBests.map((pb) => `${pb.exercise} ${pb.weight}kg x ${pb.reps} (${pb.label})`).join("; ")}`);
  }
  if (habits?.completionPct !== null && habits) lines.push(`Habit completion: ${habits.completionPct}% (${habits.done}/${habits.possible}); longest current habit streak ${habits.currentStreak} days`);
  if (morning) lines.push(`Morning routines completed: ${morning.completed} of ${morning.days}${morning.averageScore !== null ? `, average score ${morning.averageScore}/10` : ""}; current morning streak ${morning.currentStreak} days`);
  if (bodyWeight) lines.push(`Body weight: ${bodyWeight.first} kg to ${bodyWeight.last} kg (${bodyWeight.change > 0 ? "+" : ""}${bodyWeight.change} kg)`);
  if (nutrition) {
    lines.push(`Nutrition logged on ${nutrition.loggedDays} of ${nutrition.days} days${nutrition.onTargetDays !== null ? `, on target on ${nutrition.onTargetDays}` : ""}`);
    if (nutrition.averageCalories !== null) lines.push(`Average intake: ${nutrition.averageCalories} kcal, ${nutrition.averageProtein} g protein${nutrition.calorieTarget ? ` (targets ${nutrition.calorieTarget} kcal / ${nutrition.proteinTarget || "?"} g)` : ""}`);
  }
  return lines;
}

// The coach summary is stored in weekly_reports.patterns as labelled text,
// so no new column is needed and the row stays readable on its own.
const SUMMARY_LABELS = [["biggestWin", "BIGGEST WIN"], ["focus", "FOCUS FOR NEXT WEEK"], ["verdict", "COACH'S VERDICT"]];

export function formatCoachSummary(summary) {
  return SUMMARY_LABELS.map(([key, label]) => `${label}: ${String(summary?.[key] || "").trim()}`).join("\n\n");
}

export function parseCoachSummary(text) {
  if (!text || !String(text).includes("BIGGEST WIN:")) return null;
  const result = {};
  SUMMARY_LABELS.forEach(([key, label], index) => {
    const startAt = text.indexOf(`${label}:`);
    if (startAt < 0) return;
    const next = SUMMARY_LABELS.slice(index + 1).map(([, nextLabel]) => text.indexOf(`${nextLabel}:`)).filter((value) => value > startAt);
    result[key] = text.slice(startAt + label.length + 1, next.length ? Math.min(...next) : undefined).trim();
  });
  return result.biggestWin || result.focus || result.verdict ? result : null;
}

// A finished week's report is "new" until it has been opened: there is data
// to report, no saved report for that week, and it was not marked as seen.
export function isNewWeeklyReport({ week, metrics, hasStoredReport = false, seenWeekStart = null } = {}) {
  return Boolean(week && !week.inProgress && metrics?.hasData && !hasStoredReport && seenWeekStart !== week.start);
}
