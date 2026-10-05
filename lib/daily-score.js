// The dashboard's daily score (0–100): the average of the parts that apply
// today (habits, morning routine, calories, workout), each 0 to 1.

// Calories count up to the target. Up to 10% over still counts as on
// target; past that the part goes down again, so eating well over the
// target never scores as a full day.
export function calorieScore(eaten, goal) {
  const target = Number(goal) || 0;
  if (!target) return null;
  const ratio = Math.max(0, Number(eaten) || 0) / target;
  if (ratio <= 1) return ratio;
  if (ratio <= 1.1) return 1;
  return Math.max(0, 1 - (ratio - 1.1) * 2);
}

export function dailyScore({
  habitsDone = 0, habitsTotal = 0,
  hasRoutine = false, morningDone = false, morningScore = null,
  caloriesEaten = 0, calorieGoal = 0,
  workoutScheduled = false, workoutDone = false,
} = {}) {
  const parts = [];
  if (habitsTotal > 0) parts.push({ key: "habits", label: "Habits", value: habitsDone / habitsTotal, text: `${habitsDone}/${habitsTotal}` });
  if (hasRoutine || morningDone) {
    const score = Number(morningScore) || 10;
    parts.push({ key: "morning", label: "Morning", value: morningDone ? Math.min(score / 10, 1) : 0, text: morningDone ? `${score}/10` : "not done" });
  }
  const calories = calorieScore(caloriesEaten, calorieGoal);
  if (calories !== null) {
    const percent = Math.round(((Number(caloriesEaten) || 0) / Number(calorieGoal)) * 100);
    parts.push({ key: "calories", label: "Calories", value: calories, text: percent > 110 ? `${percent - 100}% over target` : `${percent}% of target` });
  }
  if (workoutScheduled) parts.push({ key: "workout", label: "Workout", value: workoutDone ? 1 : 0, text: workoutDone ? "done" : "to do" });
  const score = parts.length ? Math.round((parts.reduce((sum, part) => sum + part.value, 0) / parts.length) * 100) : 0;
  return { score, parts };
}
