import test from "node:test";
import assert from "node:assert/strict";
import { dayStreak, habitStreak, isCompletedMorning, morningStreak, shiftDateKey, streakBeforeToday } from "../lib/streaks.js";

const today = "2026-10-05";

test("shiftDateKey crosses month and year boundaries", () => {
  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDateKey("2026-01-01", -1), "2025-12-31");
});

test("an unfinished today does not reset the streak carried from yesterday", () => {
  const dates = ["2026-10-02", "2026-10-03", "2026-10-04"];
  assert.equal(dayStreak(dates, today), 3);
  assert.equal(dayStreak([...dates, today], today), 4);
});

test("a missed day ends the streak", () => {
  assert.equal(dayStreak(["2026-10-01", "2026-10-02", "2026-10-04"], today), 1);
  assert.equal(dayStreak(["2026-10-01", "2026-10-02", "2026-10-03"], today), 0);
});

test("dates after today never count", () => {
  assert.equal(dayStreak(["2026-10-04", "2026-10-06", "2026-10-07"], today), 1);
  assert.equal(streakBeforeToday([today, "2026-10-06"], today), 0);
});

test("habit streak follows today's tick without another read", () => {
  assert.equal(habitStreak({ streakBeforeToday: 4, done: false }), 4);
  assert.equal(habitStreak({ streakBeforeToday: 4, done: true }), 5);
  assert.equal(habitStreak({ done: true }), 1);
  assert.equal(habitStreak({}), 0);
});

test("morning streak counts finished check-ins only", () => {
  assert.equal(isCompletedMorning({ date: today, data: { inProgress: true } }), false);
  assert.equal(isCompletedMorning({ date: today, data: { routineSkipped: true } }), false);
  assert.equal(isCompletedMorning({ date: today, data: { roughCheckin: true } }), true);
  const checkins = [
    { date: "2026-10-02", data: {} },
    { date: "2026-10-03", data: { loggedAfter: true } },
    { date: "2026-10-04", data: {} },
    { date: today, data: { inProgress: true } },
  ];
  assert.equal(morningStreak(checkins, today), 3);
  assert.equal(morningStreak([...checkins.slice(0, 3), { date: today, data: {} }], today), 4);
  assert.equal(morningStreak([{ date: "2026-10-03", data: {} }, { date: "2026-10-04", data: { routineSkipped: true } }], today), 0);
});
