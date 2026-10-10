// Account achievements: badges worked out from the user's own history, so
// nothing extra is stored and existing users get credit for what they have
// already done. Each badge says when it was earned (the day the target was
// first reached) or how far there is to go.
import { activityOfLog, isActivitySession, workoutPersonalBests } from "./fitness-session.js";
import { countsForMorningStreak, shiftDateKey } from "./streaks.js";
import { nutritionDayOnTarget, weekStartOf } from "./weekly-report.js";

export const ACHIEVEMENT_CATEGORIES = [
  { id: "consistency", label: "Consistency" },
  { id: "strength", label: "Strength" },
  { id: "morning", label: "Mornings" },
  { id: "habits", label: "Habits" },
  { id: "nutrition", label: "Nutrition" },
];

// Lift milestones: matched by exercise name, barbell versions only.
const LIFTS = {
  bench: { label: "Bench Press", match: /bench press/, exclude: /incline|decline|dumbbell|\bdb\b|close.?grip|machine|smith|floor/ },
  squat: { label: "Squat", match: /squat/, exclude: /goblet|split|bulgarian|hack|front|jump|sumo|smith|box|pistol|belt|zercher|dumbbell|\bdb\b|kettlebell|leg press|wall|overhead/ },
  deadlift: { label: "Deadlift", match: /deadlift/, exclude: /romanian|\brdl\b|stiff|single.?leg|dumbbell|\bdb\b|trap|hex|kettlebell|deficit|snatch/ },
};

const BADGES = [
  { id: "first-workout", category: "consistency", icon: "🏁", title: "First Session", description: "Finish your first workout.", kind: "workouts", target: 1 },
  { id: "workouts-10", category: "consistency", icon: "💪", title: "Getting Going", description: "Finish 10 workouts.", kind: "workouts", target: 10 },
  { id: "workouts-25", category: "consistency", icon: "🔥", title: "Regular", description: "Finish 25 workouts.", kind: "workouts", target: 25 },
  { id: "workouts-50", category: "consistency", icon: "⚡", title: "Dedicated", description: "Finish 50 workouts.", kind: "workouts", target: 50 },
  { id: "workouts-100", category: "consistency", icon: "💯", title: "Century", description: "Finish 100 workouts.", kind: "workouts", target: 100 },
  { id: "weeks-4", category: "consistency", icon: "📅", title: "Four Weeks Strong", description: "Train in 4 weeks in a row.", kind: "weeks", target: 4 },
  { id: "weeks-12", category: "consistency", icon: "🗓️", title: "Twelve-Week Streak", description: "Train in 12 weeks in a row.", kind: "weeks", target: 12 },
  { id: "perfect-week", category: "consistency", icon: "🏆", title: "Perfect Week", description: "Do every planned session in a week without missing a set.", kind: "perfectWeeks", target: 1 },
  { id: "perfect-weeks-4", category: "consistency", icon: "👑", title: "Perfect Month", description: "Have 4 perfect training weeks.", kind: "perfectWeeks", target: 4 },
  { id: "bench-60", category: "strength", icon: "🏋️", title: "Plate Bench", description: "Bench press 60 kg.", kind: "lift", lift: "bench", target: 60 },
  { id: "bench-100", category: "strength", icon: "🥇", title: "Triple-Digit Bench", description: "Bench press 100 kg.", kind: "lift", lift: "bench", target: 100 },
  { id: "squat-100", category: "strength", icon: "🦵", title: "Two-Plate Squat", description: "Squat 100 kg.", kind: "lift", lift: "squat", target: 100 },
  { id: "squat-140", category: "strength", icon: "🥇", title: "Three-Plate Squat", description: "Squat 140 kg.", kind: "lift", lift: "squat", target: 140 },
  { id: "deadlift-140", category: "strength", icon: "🏗️", title: "Three-Plate Deadlift", description: "Deadlift 140 kg.", kind: "lift", lift: "deadlift", target: 140 },
  { id: "deadlift-180", category: "strength", icon: "🥇", title: "Four-Plate Deadlift", description: "Deadlift 180 kg.", kind: "lift", lift: "deadlift", target: 180 },
  { id: "pbs-10", category: "strength", icon: "📈", title: "PB Hunter", description: "Set 10 personal bests.", kind: "pbs", target: 10 },
  { id: "volume-10k", category: "strength", icon: "🧱", title: "10 Tonnes", description: "Lift 10,000 kg in total.", kind: "volume", target: 10_000 },
  { id: "volume-100k", category: "strength", icon: "🚛", title: "100 Tonnes", description: "Lift 100,000 kg in total.", kind: "volume", target: 100_000 },
  { id: "volume-1m", category: "strength", icon: "🌍", title: "Million Club", description: "Lift 1,000,000 kg in total.", kind: "volume", target: 1_000_000 },
  { id: "morning-first", category: "morning", icon: "🌅", title: "Early Riser", description: "Complete a morning routine (at least 5/10).", kind: "mornings", target: 1 },
  { id: "morning-streak-7", category: "morning", icon: "☀️", title: "Week of Mornings", description: "A 7-day morning streak.", kind: "morningStreak", target: 7 },
  { id: "morning-streak-30", category: "morning", icon: "🌞", title: "Morning Machine", description: "A 30-day morning streak.", kind: "morningStreak", target: 30 },
  { id: "habit-streak-7", category: "habits", icon: "✅", title: "Habit Former", description: "Keep a habit going 7 days in a row.", kind: "habitStreak", target: 7 },
  { id: "habit-streak-30", category: "habits", icon: "🔒", title: "Locked In", description: "Keep a habit going 30 days in a row.", kind: "habitStreak", target: 30 },
  { id: "nutrition-7", category: "nutrition", icon: "🥗", title: "Food Logger", description: "Log your food on 7 days.", kind: "nutritionDays", target: 7 },
  { id: "nutrition-week", category: "nutrition", icon: "🎯", title: "Dialled In", description: "Hit your calorie and protein targets on 5 days in one week.", kind: "onTargetWeek", target: 5 },
];
export const ACHIEVEMENT_COUNT = BADGES.length;

const realWorkout = (log) => !log?.in_progress && (Number(log?.total_volume) > 0 || (Number(log?.duration_mins) || 0) >= 2);
const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at || "").localeCompare(String(b.created_at || ""));

// The date a running total first reaches each target, and the total itself.
function reached(steps, target) {
  let total = 0;
  for (const { date, amount } of steps) {
    total += amount;
    if (total >= target) return { earnedOn: date, current: total };
  }
  return { earnedOn: null, current: total };
}

// Longest run of consecutive keys (days or weeks), and the date each run
// length was first reached. `step` moves one key to the next.
function runMilestones(keys, step) {
  const sorted = [...new Set(keys)].sort();
  const firstReached = new Map(); // length -> key it was first reached on
  let run = 0;
  let best = 0;
  sorted.forEach((key, index) => {
    run = index > 0 && step(sorted[index - 1]) === key ? run + 1 : 1;
    best = Math.max(best, run);
    if (!firstReached.has(run)) firstReached.set(run, key);
  });
  return { best, firstReached };
}

export function computeAchievements({ workouts = [], checkins = [], habitCompletions = [], nutritionLogs = [], nutritionPlan = null, sessions = [], planStartKey = null } = {}) {
  const lifting = workouts.filter((log) => realWorkout(log) && !activityOfLog(log)).sort(byDate);

  // Weeks with at least one workout, Monday to Sunday.
  const weekKeys = lifting.map((log) => weekStartOf(log.date));
  const weeks = runMilestones(weekKeys, (key) => shiftDateKey(key, 7));

  // Perfect weeks under the current plan: every planned session done and no
  // planned set missed (from the sets each workout saved as prescribed).
  const plannedPerWeek = new Set((sessions || []).filter((session) => !isActivitySession(session))
    .flatMap((session) => (session.days || []).map((day) => String(day).toUpperCase().slice(0, 3)))).size;
  const planWeek = planStartKey ? weekStartOf(planStartKey) : null;
  const perfectWeekDates = [];
  if (plannedPerWeek) {
    const grouped = new Map();
    lifting.forEach((log) => grouped.set(weekStartOf(log.date), [...(grouped.get(weekStartOf(log.date)) || []), log]));
    [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([week, logs]) => {
      if (planWeek && week < planWeek) return;
      const gaps = logs.flatMap((log) => (log.exercises || []).filter((exercise) => Number(exercise?.prescribed_sets) > 0)
        .map((exercise) => Math.max(0, Number(exercise.prescribed_sets) - (Array.isArray(exercise.sets) ? exercise.sets.length : 0))));
      if (logs.length >= plannedPerWeek && gaps.length && gaps.every((gap) => gap === 0)) perfectWeekDates.push(logs.at(-1).date);
    });
  }

  // Heaviest set so far on each main lift, in date order.
  const liftSets = Object.fromEntries(Object.keys(LIFTS).map((lift) => [lift, []]));
  lifting.forEach((log) => (log.exercises || []).forEach((exercise) => {
    const name = String(exercise?.name || "").toLowerCase();
    const lift = Object.keys(LIFTS).find((key) => LIFTS[key].match.test(name) && !LIFTS[key].exclude.test(name));
    if (!lift) return;
    (exercise.sets || []).forEach((set) => {
      const weight = Number(set?.weight);
      if (Number(set?.reps) >= 1 && Number.isFinite(weight) && weight > 0) liftSets[lift].push({ date: log.date, weight });
    });
  }));

  const pbSteps = lifting.map((log) => ({ date: log.date, amount: workoutPersonalBests(log.exercises || []).length }));
  const volumeSteps = lifting.map((log) => ({ date: log.date, amount: Number(log.total_volume) || 0 }));

  const goodMornings = (checkins || []).filter(countsForMorningStreak).map((entry) => entry.date).sort();
  const mornings = runMilestones(goodMornings, (key) => shiftDateKey(key, 1));

  // The best run across all habits, and when each length was first reached.
  const habitRuns = new Map();
  (habitCompletions || []).filter((row) => row?.date && row.done !== false).forEach((row) => {
    const id = String(row.habit_id);
    habitRuns.set(id, [...(habitRuns.get(id) || []), row.date]);
  });
  const habitStreaks = [...habitRuns.values()].map((dates) => runMilestones(dates, (key) => shiftDateKey(key, 1)));
  const habitBest = Math.max(0, ...habitStreaks.map((run) => run.best));
  const habitReached = (length) => habitStreaks.map((run) => run.firstReached.get(length)).filter(Boolean).sort()[0] || null;

  const loggedDays = [...new Set((nutritionLogs || []).filter((log) => Number(log?.total_calories) > 0).map((log) => log.date))].sort();
  const onTargetByWeek = new Map();
  if (nutritionPlan) {
    (nutritionLogs || []).filter((log) => Number(log?.total_calories) > 0 && nutritionDayOnTarget(log, nutritionPlan)).map((log) => log.date).sort()
      .forEach((date) => onTargetByWeek.set(weekStartOf(date), [...(onTargetByWeek.get(weekStartOf(date)) || []), date]));
  }

  const evaluate = (badge) => {
    switch (badge.kind) {
      case "workouts": return { earnedOn: lifting[badge.target - 1]?.date || null, current: lifting.length };
      case "weeks": {
        // Earned with the first workout of the week that completed the run.
        const week = weeks.firstReached.get(badge.target);
        return { earnedOn: week ? lifting.find((log) => weekStartOf(log.date) === week).date : null, current: weeks.best };
      }
      case "perfectWeeks": return { earnedOn: perfectWeekDates[badge.target - 1] || null, current: perfectWeekDates.length };
      case "lift": {
        const sets = liftSets[badge.lift];
        return { earnedOn: sets.find((set) => set.weight >= badge.target)?.date || null, current: Math.max(0, ...sets.map((set) => set.weight)) };
      }
      case "pbs": return reached(pbSteps, badge.target);
      case "volume": return reached(volumeSteps, badge.target);
      case "mornings": return { earnedOn: goodMornings[badge.target - 1] || null, current: goodMornings.length };
      case "morningStreak": return { earnedOn: mornings.firstReached.get(badge.target) || null, current: mornings.best };
      case "habitStreak": return { earnedOn: habitReached(badge.target), current: habitBest };
      case "nutritionDays": return { earnedOn: loggedDays[badge.target - 1] || null, current: loggedDays.length };
      case "onTargetWeek": {
        const weeksDone = [...onTargetByWeek.values()].filter((dates) => dates.length >= badge.target).map((dates) => dates[badge.target - 1]).sort();
        return { earnedOn: weeksDone[0] || null, current: Math.max(0, ...[...onTargetByWeek.values()].map((dates) => dates.length)) };
      }
      default: return { earnedOn: null, current: 0 };
    }
  };

  return BADGES.map((badge) => {
    const { earnedOn, current } = evaluate(badge);
    const { kind: _kind, lift: _lift, target, ...shown } = badge;
    return { ...shown, earned: Boolean(earnedOn), earnedOn, progress: { current: Math.min(Math.round(current * 10) / 10, target), target, unit: badge.kind === "lift" || badge.kind === "volume" ? "kg" : "" } };
  });
}

// Badges earned that this device hasn't shown yet. seen: ids already shown,
// or null the first time (then nothing is "new": earlier badges are summed up
// once instead of each being announced).
export function unseenAchievements(achievements = [], seen = null) {
  if (!Array.isArray(seen)) return [];
  return achievements.filter((badge) => badge.earned && !seen.includes(badge.id));
}
