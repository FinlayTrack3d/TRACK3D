// Day streaks worked out from dated history (YYYY-MM-DD keys in the user's
// home timezone). Today only adds to a streak: an unfinished today never
// breaks it, because the day is not over yet. Dates after today are ignored.

export function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Consecutive days ending yesterday, i.e. the streak carried into today.
export function streakBeforeToday(dateKeys, todayKey) {
  const done = new Set((dateKeys || []).filter(key => typeof key === "string" && key < todayKey));
  let streak = 0;
  let cursor = shiftDateKey(todayKey, -1);
  while (done.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

export function dayStreak(dateKeys, todayKey) {
  const doneToday = (dateKeys || []).includes(todayKey);
  return streakBeforeToday(dateKeys, todayKey) + (doneToday ? 1 : 0);
}

// Habits keep the streak carried into today separately, so ticking or
// unticking today updates the count without another database read.
export function habitStreak(habit) {
  return (Number(habit?.streakBeforeToday) || 0) + (habit?.done ? 1 : 0);
}

// A morning counts when its check-in was finished. Started-but-unfinished
// and skipped mornings do not count.
export function isCompletedMorning(entry) {
  return Boolean(entry?.date) && !entry.data?.inProgress && !entry.data?.routineSkipped;
}

// The streak counts a finished morning only when at least half the routine
// was done (5/10 or more), so a low-scoring check-in doesn't overstate it.
// A finished morning saved without a score still counts.
export const STREAK_MIN_MORNING_SCORE = 5;
export function countsForMorningStreak(entry) {
  if (!isCompletedMorning(entry)) return false;
  const score = entry.score === null || entry.score === undefined || entry.score === "" ? NaN : Number(entry.score);
  return !Number.isFinite(score) || score >= STREAK_MIN_MORNING_SCORE;
}

export function morningStreak(checkins, todayKey) {
  return dayStreak((checkins || []).filter(countsForMorningStreak).map(entry => entry.date), todayKey);
}
