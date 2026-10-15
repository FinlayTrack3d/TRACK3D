// The dashboard's "Next up" list: what is due now, in the order of the day
// (morning check-in, workout, next meal, habits, end-of-day check-in),
// depending on the time. The dashboard turns each item into one tap.
// time: "HH:MM" now (defaults to the start of `hour`). endOfDayDue: false
// until something is set up, so a brand-new account is never asked to close
// out a day it had nothing planned in.

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// A meal stays "next" until this long after its planned time, then it is
// left to LOG AS YOU GO: at 22:50 breakfast at 07:30 is not next.
export const MEAL_GRACE_MINUTES = 60;
const minutesOf = time => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export function nextUpItems({ hour = 12, time = null, morning = {}, workout = {}, meals = [], habits = [], endOfDayDone = false, endOfDayDue = true } = {}) {
  const items = [];
  const now = minutesOf(time) ?? hour * 60;
  if (workout.inProgressName) {
    items.push({ id: "workout", title: workout.inProgressName, detail: "Workout in progress", action: "CONTINUE →" });
  }
  // The morning check-in is due until midday, or until a started one is finished.
  if (morning.hasRoutine && !morning.done && (morning.inProgress || hour < 12)) {
    items.push({ id: "morning", title: morning.inProgress ? "Finish your morning" : "Morning check-in", detail: morning.inProgress ? "Started, not finished" : morning.wakeTime ? `Planned wake-up ${morning.wakeTime}` : "Start your routine", action: morning.inProgress ? "FINISH →" : "START →" });
  }
  if (!workout.inProgressName && workout.scheduledName && !workout.done) {
    items.push(workout.scheduledActivity
      ? { id: "workout", title: workout.scheduledName, detail: "Today's activity", action: "LOG IT →" }
      : { id: "workout", title: workout.scheduledName, detail: "Today's workout", action: "START WORKOUT →" });
  }
  const nextMeal = [...meals]
    .map((meal, index) => ({ ...meal, index: meal.index ?? index }))
    .filter(meal => !meal.logged)
    .filter(meal => minutesOf(meal.time) === null || minutesOf(meal.time) + MEAL_GRACE_MINUTES >= now)
    .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : 0) || a.index - b.index)[0];
  if (nextMeal) {
    items.push({ id: "meal", mealIndex: nextMeal.index, title: nextMeal.name, detail: nextMeal.time ? `Next meal · ${nextMeal.time}` : "Next meal", action: "✓ ATE IT" });
  }
  const habitsLeft = (habits || []).filter(habit => !habit.done);
  if (habitsLeft.length) {
    items.push({ id: "habit", habitId: habitsLeft[0].id, title: habitsLeft[0].name, detail: `Habit · ${plural(habitsLeft.length, "habit")} left today`, action: "✓ DONE" });
  }
  if (endOfDayDue && !endOfDayDone && hour >= 18) {
    items.push({ id: "endOfDay", title: "End-of-day check-in", detail: "Close out your day", action: "START →" });
  }
  return items;
}
