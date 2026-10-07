import test from "node:test";
import assert from "node:assert/strict";
import { settledWorkoutDuration, weeklyWorkoutProgress, workoutDurationMins } from "../lib/fitness-session.js";
import { exerciseMatchesHistory, sameExerciseName } from "../lib/coaching/plan-change.js";
import { buildWeeklyMetrics, formatCoachSummary, parseCoachSummary, weeklyFactsForCoach, weeklyFactsKey } from "../lib/weekly-report.js";

const start = Date.parse("2026-10-05T12:00:00Z");
const at = minutes => new Date(start + minutes * 60000).toISOString();
const rowSets = times => [{ name: "Bench Press", sets: times.map(time => ({ weight: 60, reps: 8, ...(time === null ? {} : { at: at(time) }) })) }];

test("a workout left open ends at its last set, not when it was closed", () => {
  // Finished a few minutes after the last set: the real length.
  assert.equal(workoutDurationMins({ startedAt: start, now: start + 43 * 60000, exercises: rowSets([10, 25, 40]) }), 43);
  // Two sets, then left open for hours: ends two minutes after the last set.
  assert.equal(workoutDurationMins({ startedAt: start, now: start + 345 * 60000, exercises: rowSets([5, 12]) }), 14);
  // Sets from before set times existed: capped (at least 45 min, about 6 a set + 20).
  assert.equal(workoutDurationMins({ startedAt: start, now: start + 345 * 60000, exercises: rowSets([null, null]) }), 45);
});

test("saved workouts show a settled length; activities keep theirs", () => {
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 345, exercises: rowSets([null, null]) }), 45);
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 345, exercises: rowSets([5, 12]) }), 14);
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 45, exercises: rowSets([10, 25, 40]) }), 45);
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 41, exercises: rowSets([null, null]) }), 41);
  assert.equal(settledWorkoutDuration({ duration_mins: 45, exercises: [{ name: "Run", activity: { type: "run" }, sets: [] }] }), 45);
  // Saved without any sets: nothing to judge it by, so it keeps its time.
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 50, exercises: [] }), 50);
});

test("a workout with sets logged never shows as 0 minutes", () => {
  // Three sets logged within a minute were entered after the workout: about 3 minutes a set.
  assert.equal(workoutDurationMins({ startedAt: start, now: start + 40000, exercises: rowSets([0, 0, 0]) }), 9);
  // A minute or more a set is real timing, and is kept.
  assert.equal(workoutDurationMins({ startedAt: start, now: start + 4 * 60000, exercises: rowSets([1, 2, 3]) }), 4);
  // No start time: estimated from the sets.
  assert.equal(workoutDurationMins({ startedAt: null, exercises: rowSets([0, 0]) }), 6);
  // Saved as 0 or 1 minutes with lifting logged: shown, and counted in the weekly report, at about 3 minutes a set.
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 0, exercises: rowSets([0, 0, 0, 0]) }), 12);
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 1, exercises: rowSets([null, null]) }), 6);
  // No sets: nothing to estimate from.
  assert.equal(workoutDurationMins({ startedAt: start, now: start + 20000, exercises: [] }), 0);
  assert.equal(settledWorkoutDuration({ created_at: at(0), duration_mins: 0, exercises: [] }), 0);
});

test("exercise history carries across names that differ only by equipment or plural", () => {
  assert.equal(exerciseMatchesHistory({ name: "Goblet Squat" }, "Dumbbell Goblet Squat"), true);
  assert.equal(sameExerciseName("DB Goblet Squats", "Goblet Squat"), true);
  assert.equal(sameExerciseName("Bench Presses", "Bench Press"), true);
  // Different equipment, or a different movement, is not the same exercise.
  assert.equal(sameExerciseName("Barbell Row", "Dumbbell Row"), false);
  assert.equal(sameExerciseName("Bench Press", "Incline Bench Press"), false);
  assert.equal(sameExerciseName("Squat", "Front Squat"), false);
});

const week = { start: "2026-09-28", end: "2026-10-04", inProgress: false };
const run = { date: "2026-09-30", session_name: "Run", total_volume: 0, duration_mins: 45, exercises: [{ name: "Run", activity: { type: "run", effort: "hard" }, sets: [] }] };

test("a run is counted as an activity, not a workout", () => {
  const metrics = buildWeeklyMetrics({
    week, todayKey: "2026-10-07",
    workoutLogs: [run, { date: "2026-09-29", total_volume: 4000, duration_mins: 50, exercises: [] }, { date: "2026-10-01", total_volume: 4200, duration_mins: 48, exercises: [] }],
    sessions: [{ name: "Upper A", days: ["TUE"] }, { name: "Lower A", days: ["THU"] }, { name: "Run", kind: "activity", activityType: "run", days: ["WED"] }],
  });
  assert.equal(metrics.workouts.completed, 2);
  assert.equal(metrics.workouts.planned, 2);
  assert.equal(metrics.workouts.activities, 1);
  assert.equal(metrics.workouts.activityMinutes, 45);
  assert.match(weeklyFactsForCoach(metrics).join("\n"), /Other activities \(not weight training, not counted as workouts\): 1 \(Run\), 45 minutes/);
  const progress = weeklyWorkoutProgress([{ ...run, date: "2026-10-06" }, { id: 1, date: "2026-10-05", total_volume: 4000, duration_mins: 50, exercises: [] }], "2026-10-07", [], null, { countCurrent: false });
  assert.deepEqual(progress, { completed: 1, planned: 0, activities: 1 });
});

test("a past week's streaks are as they stood at the end of that week", () => {
  const metrics = buildWeeklyMetrics({
    week, todayKey: "2026-10-07",
    habits: [{ id: "h", name: "Read for 10 minutes", created_at: "2026-09-01T00:00:00Z" }],
    // Only this week's ticks: the streak at the end of last week was 0.
    habitCompletions: ["2026-10-05", "2026-10-06", "2026-10-07"].map(date => ({ habit_id: "h", date })),
    hasMorningRoutine: true,
    checkins: [{ date: "2026-10-03", score: 8, data: {} }, { date: "2026-10-04", score: 8, data: {} }, { date: "2026-10-05", score: 8, data: {} }, { date: "2026-10-06", score: 8, data: {} }],
  });
  assert.equal(metrics.habits.currentStreak, 0);
  assert.equal(metrics.morning.currentStreak, 2);
  assert.match(weeklyFactsForCoach(metrics).join("\n"), /morning streak at the end of the week 2 days/);
});

test("a coach summary written from other numbers is recognised as out of date", () => {
  const before = buildWeeklyMetrics({ week, todayKey: "2026-10-07", workoutLogs: [run], sessions: [{ name: "Upper A", days: ["TUE", "THU"] }] });
  const after = buildWeeklyMetrics({ week, todayKey: "2026-10-07", workoutLogs: [run], sessions: [] });
  assert.notEqual(weeklyFactsKey(before), weeklyFactsKey(after));
  assert.equal(weeklyFactsKey(after), weeklyFactsKey(buildWeeklyMetrics({ week, todayKey: "2026-10-07", workoutLogs: [run], sessions: [] })));
  const summary = { biggestWin: "A hard run.", focus: "Lift twice.", verdict: "Solid." };
  const stored = formatCoachSummary(summary, weeklyFactsKey(after));
  assert.deepEqual(parseCoachSummary(stored), { ...summary, factsKey: weeklyFactsKey(after) });
  // Written before summaries kept their facts: no key, so it is rewritten.
  assert.equal(parseCoachSummary(formatCoachSummary(summary)).factsKey, undefined);
});
