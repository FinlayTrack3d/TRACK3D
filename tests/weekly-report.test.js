import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyMetrics, formatCoachSummary, parseCoachSummary, reportWeek, weeklyFactsForCoach } from "../lib/weekly-report.js";

const pb = { type: "weight_pb", label: "Weight PB" };

test("the report covers last completed week, or this week on a Sunday", () => {
  assert.deepEqual(reportWeek("2026-10-07"), { start: "2026-09-28", end: "2026-10-04", inProgress: false });
  assert.deepEqual(reportWeek("2026-10-05"), { start: "2026-09-28", end: "2026-10-04", inProgress: false });
  assert.deepEqual(reportWeek("2026-10-11"), { start: "2026-10-05", end: "2026-10-11", inProgress: true });
  assert.deepEqual(reportWeek("2026-10-07", 1), { start: "2026-09-21", end: "2026-09-27", inProgress: false });
});

const week = { start: "2026-09-28", end: "2026-10-04", inProgress: false };
const todayKey = "2026-10-07";

test("a full week produces real numbers and comparisons", () => {
  const metrics = buildWeeklyMetrics({
    week, todayKey,
    workoutLogs: [
      { date: "2026-09-29", total_volume: 5000, duration_mins: 50, exercises: [{ name: "Bench Press", sets: [{ weight: "80", reps: "6", personalBest: pb }] }] },
      { date: "2026-10-01", total_volume: 5500, duration_mins: 55, exercises: [] },
      { date: "2026-10-02", total_volume: 0, duration_mins: 1, exercises: [] },
      { date: "2026-09-22", total_volume: 10000, duration_mins: 100, exercises: [] },
    ],
    sessions: [{ name: "Push", days: ["MON", "THU"] }, { name: "Pull", days: ["TUE"] }],
    habits: [{ id: "h1", name: "Water", created_at: "2026-01-01T00:00:00Z" }, { id: "h2", name: "Read", created_at: "2026-10-03T09:00:00Z" }],
    habitCompletions: [
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map((date) => ({ habit_id: "h1", date })),
      { habit_id: "h2", date: "2026-10-03" },
    ],
    checkins: [
      { date: "2026-09-28", score: 8, data: { weight: "80.4" } },
      { date: "2026-09-29", score: 6, data: { inProgress: true } },
      { date: "2026-10-03", score: 7, data: { weight: "79.6" } },
      { date: "2026-10-06", score: 9, data: {} },
    ],
    hasMorningRoutine: true,
    nutritionLogs: [{ date: "2026-09-28", total_calories: 2500, total_protein: 180 }, { date: "2026-09-29", total_calories: 3200, total_protein: 120 }],
    nutritionPlan: { daily_calories: 2500, protein_target: 180 },
  });
  assert.equal(metrics.hasData, true);
  assert.equal(metrics.workouts.completed, 2);
  assert.equal(metrics.workouts.planned, 3);
  assert.equal(metrics.workouts.volume, 10500);
  assert.equal(metrics.workouts.volumeChangePct, 5);
  assert.equal(metrics.workouts.personalBests.length, 1);
  assert.equal(metrics.habits.possible, 9); // 7 days of Water + 2 days of Read (created Saturday)
  assert.equal(metrics.habits.done, 8);
  assert.equal(metrics.habits.completionPct, 89);
  assert.equal(metrics.habits.currentStreak, 9);
  assert.equal(metrics.habits.currentStreakHabit, "Water");
  assert.equal(metrics.morning.completed, 2);
  assert.equal(metrics.morning.days, 7);
  assert.equal(metrics.morning.averageScore, 7.5);
  assert.deepEqual(metrics.bodyWeight, { first: 80.4, last: 79.6, change: -0.8, weighIns: 2 });
  assert.equal(metrics.nutrition.onTargetDays, 1);
  assert.equal(metrics.nutrition.loggedDays, 2);
  const facts = weeklyFactsForCoach(metrics).join("\n");
  assert.match(facts, /Workouts completed: 2 of 3 planned/);
  assert.match(facts, /Volume vs previous week: \+5%/);
  assert.match(facts, /Bench Press 80kg x 6/);
});

test("a new user gets no invented metrics and no comparison", () => {
  const empty = buildWeeklyMetrics({ week, todayKey });
  assert.equal(empty.hasData, false);
  assert.equal(empty.workouts, null);
  assert.equal(empty.habits, null);
  assert.equal(empty.morning, null);
  assert.equal(empty.nutrition, null);
  assert.equal(empty.bodyWeight, null);
  assert.deepEqual(weeklyFactsForCoach(empty), []);

  const firstWeek = buildWeeklyMetrics({ week, todayKey, workoutLogs: [{ date: "2026-09-29", total_volume: 3000, duration_mins: 40, exercises: [] }] });
  assert.equal(firstWeek.workouts.volumeChangePct, null);
  assert.equal(firstWeek.workouts.previousVolume, null);
  assert.equal(firstWeek.workouts.planned, null);
  assert.equal(firstWeek.nutrition, null);
});

test("an in-progress week only counts days so far", () => {
  const thisWeek = reportWeek("2026-10-11");
  const metrics = buildWeeklyMetrics({ week: thisWeek, todayKey: "2026-10-11", hasMorningRoutine: true, checkins: [{ date: "2026-10-10", score: 8, data: {} }] });
  assert.equal(metrics.morning.days, 7);
  const midweek = buildWeeklyMetrics({ week: { start: "2026-10-05", end: "2026-10-11" }, todayKey: "2026-10-07", hasMorningRoutine: true });
  assert.equal(midweek.morning.days, 3);
});

test("the coach summary round-trips through the stored text", () => {
  const summary = { biggestWin: "Four of four workouts.", focus: "Hit protein on training days.", verdict: "Strong week. Keep it going." };
  const text = formatCoachSummary(summary);
  assert.match(text, /^BIGGEST WIN: Four/);
  assert.deepEqual(parseCoachSummary(text), summary);
  assert.equal(parseCoachSummary("Old style patterns paragraph"), null);
  assert.equal(parseCoachSummary(null), null);
});

test("a first week is labelled the baseline and implausible times are flagged", () => {
  const metrics = buildWeeklyMetrics({ week, todayKey, sessions: [{ name: "A", days: ["MON", "TUE", "THU", "FRI"] }], workoutLogs: [
    { date: "2026-09-29", total_volume: 1200, duration_mins: 1, exercises: [] },
    { date: "2026-10-01", total_volume: 980, duration_mins: 0, exercises: [] },
  ] });
  const facts = weeklyFactsForCoach(metrics).join("\n");
  assert.match(facts, /first tracked week of training: it is the baseline/);
  assert.match(facts, /implausibly short \(1 min for 2 workouts\)/);
});
