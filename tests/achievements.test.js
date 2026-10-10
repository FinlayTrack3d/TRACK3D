import test from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENT_COUNT, computeAchievements, unseenAchievements } from "../lib/achievements.js";

const workout = (date, exercises = [], volume = 1000) => ({ date, in_progress: false, total_volume: volume, duration_mins: 45, exercises });
const lift = (name, weight, reps = 5, extra = {}) => ({ name, prescribed_sets: 1, sets: [{ weight: String(weight), reps: String(reps), ...extra }], ...extra.exercise });
const badge = (list, id) => list.find((item) => item.id === id);

test("workout counts and lift milestones say when they were earned", () => {
  const list = computeAchievements({ workouts: [
    workout("2026-09-01", [lift("Bench Press", 57.5)]),
    workout("2026-09-03", [lift("Barbell Bench Press", 60), lift("Back Squat", 100)]),
    workout("2026-09-05", [lift("Incline Bench Press", 80), lift("Goblet Squat", 120), lift("Romanian Deadlift", 150)]),
  ] });
  assert.equal(list.length, ACHIEVEMENT_COUNT);
  assert.deepEqual(badge(list, "first-workout").earnedOn, "2026-09-01");
  assert.deepEqual(badge(list, "workouts-10").progress, { current: 3, target: 10, unit: "" });
  assert.equal(badge(list, "bench-60").earnedOn, "2026-09-03");
  assert.equal(badge(list, "squat-100").earnedOn, "2026-09-03");
  // Incline bench, goblet squat and Romanian deadlift aren't the main lifts.
  assert.deepEqual(badge(list, "bench-100").progress, { current: 60, target: 100, unit: "kg" });
  assert.equal(badge(list, "squat-140").earned, false);
  assert.equal(badge(list, "deadlift-140").earned, false);
});

test("in-progress, empty and activity logs don't count", () => {
  const list = computeAchievements({ workouts: [
    { date: "2026-09-01", in_progress: true, total_volume: 900, exercises: [] },
    { date: "2026-09-02", in_progress: false, total_volume: 0, duration_mins: 1, exercises: [] },
    { date: "2026-09-03", in_progress: false, total_volume: 0, duration_mins: 45, exercises: [{ name: "Run", activity: { type: "run" }, sets: [] }] },
  ] });
  assert.equal(badge(list, "first-workout").earned, false);
});

test("weeks in a row, perfect weeks, volume and PBs", () => {
  const sessions = [{ name: "Push", days: ["MON"], exercises: [] }];
  const weekly = ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"].map((date) => workout(date, [lift("Row", 50, 10, { personalBest: { type: "weight_pb" } })], 3000));
  const list = computeAchievements({ workouts: weekly, sessions, planStartKey: "2026-08-31" });
  assert.equal(badge(list, "weeks-4").earnedOn, "2026-09-21");
  assert.equal(badge(list, "perfect-week").earnedOn, "2026-08-31");
  assert.equal(badge(list, "perfect-weeks-4").earnedOn, "2026-09-21");
  assert.equal(badge(list, "volume-10k").earnedOn, "2026-09-21");
  assert.deepEqual(badge(list, "pbs-10").progress, { current: 4, target: 10, unit: "" });
  // A gap week breaks the run; a missed set isn't a perfect week.
  const gappy = computeAchievements({ workouts: [weekly[0], weekly[2], { ...weekly[3], exercises: [{ name: "Row", prescribed_sets: 3, sets: [{ weight: "50", reps: "10" }] }] }], sessions });
  assert.equal(badge(gappy, "weeks-4").progress.current, 2);
  assert.equal(badge(gappy, "perfect-week").earnedOn, "2026-08-31");
  assert.equal(badge(gappy, "perfect-weeks-4").progress.current, 2);
});

test("morning and habit streaks, and nutrition", () => {
  const days = (start, count) => Array.from({ length: count }, (_, index) => { const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + index); return d.toISOString().slice(0, 10); });
  const checkins = [...days("2026-09-01", 7).map((date) => ({ date, score: 8, data: {} })), { date: "2026-09-08", score: 2, data: {} }];
  const habitCompletions = days("2026-09-01", 8).map((date) => ({ habit_id: "h1", date }));
  const plan = { daily_calories: 2000, protein_target: 150 };
  const nutritionLogs = days("2026-09-07", 7).map((date, index) => ({ date, total_calories: index < 5 ? 2000 : 3000, total_protein: 160 }));
  const list = computeAchievements({ checkins, habitCompletions, nutritionLogs, nutritionPlan: plan });
  assert.equal(badge(list, "morning-first").earnedOn, "2026-09-01");
  assert.equal(badge(list, "morning-streak-7").earnedOn, "2026-09-07");
  assert.equal(badge(list, "morning-streak-30").progress.current, 7, "a 2/10 morning doesn't extend the streak");
  assert.equal(badge(list, "habit-streak-7").earnedOn, "2026-09-07");
  assert.equal(badge(list, "nutrition-7").earnedOn, "2026-09-13");
  assert.equal(badge(list, "nutrition-week").earnedOn, "2026-09-11");
});

test("new badges are only the ones not shown before; the first time, none are", () => {
  const list = computeAchievements({ workouts: [workout("2026-09-01")] });
  assert.deepEqual(unseenAchievements(list, null), []);
  assert.deepEqual(unseenAchievements(list, []).map((item) => item.id), ["first-workout"]);
  assert.deepEqual(unseenAchievements(list, ["first-workout"]), []);
});
