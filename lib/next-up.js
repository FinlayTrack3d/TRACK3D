// The dashboard's "Next up" list: what is due now, in the order of the day
// (morning check-in, workout, next meal, habits, end-of-day check-in),
// depending on the time. The dashboard turns each item into one tap.

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function nextUpItems({ hour = 12, morning = {}, workout = {}, meals = [], habits = [], endOfDayDone = false } = {}) {
  const items = [];
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
    .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : 0) || a.index - b.index)[0];
  if (nextMeal) {
    items.push({ id: "meal", mealIndex: nextMeal.index, title: nextMeal.name, detail: nextMeal.time ? `Next meal · ${nextMeal.time}` : "Next meal", action: "✓ ATE IT" });
  }
  const habitsLeft = (habits || []).filter(habit => !habit.done);
  if (habitsLeft.length) {
    items.push({ id: "habit", habitId: habitsLeft[0].id, title: habitsLeft[0].name, detail: `Habit · ${plural(habitsLeft.length, "habit")} left today`, action: "✓ DONE" });
  }
  if (!endOfDayDone && hour >= 18) {
    items.push({ id: "endOfDay", title: "End-of-day check-in", detail: "Close out your day", action: "START →" });
  }
  return items;
}
