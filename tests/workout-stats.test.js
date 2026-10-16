import test from "node:test";
import assert from "node:assert/strict";
import { countsAsDone, typicalSessionMinutes, usualStartTime, workoutCompletion } from "../lib/workout-stats.js";

const log = ({ name = "Upper A", minutes = 50, done = 9, planned = 9, date = "2026-10-01", at = "17:30", volume = 1000 } = {}) => ({
  session_name: name, duration_mins: minutes, date, at, total_volume: volume,
  exercises: [{ name: "Bench", prescribed_sets: planned, sets: Array.from({ length: done }, () => ({ reps: "8", weight: "60" })) }],
});

test("an abandoned or barely started workout doesn't count as done", () => {
  assert.equal(workoutCompletion(log({ done: 3, planned: 9 })), 1 / 3);
  assert.equal(countsAsDone(log({ done: 3, planned: 9, minutes: 9 })), false, "9 minutes, a third of the sets");
  assert.equal(countsAsDone(log({ done: 6, planned: 9 })), true);
  assert.equal(countsAsDone(log({ volume: 0, minutes: 1 })), false, "nothing lifted, under 2 minutes");
  assert.equal(countsAsDone({ session_name: "Old", total_volume: 500, duration_mins: 40, exercises: [{ sets: [{}] }] }), true, "older logs without planned sets still count");
});

test("a session's usual length leaves out a one-off long workout", () => {
  const history = [log({ minutes: 52 }), log({ minutes: 48 }), log({ minutes: 140 }), log({ minutes: 50 }), log({ name: "Lower A", minutes: 70 })];
  assert.equal(typicalSessionMinutes(history, "Upper A"), 50);
  assert.equal(typicalSessionMinutes(history.slice(0, 2), "Upper A"), null, "not enough workouts yet");
  assert.equal(typicalSessionMinutes([log({ minutes: 50, done: 3 }), log({ minutes: 50, done: 3 }), log({ minutes: 50, done: 3 })], "Upper A"), null, "unfinished ones don't count");
});

test("the usual training time, when there is a pattern", () => {
  const timeOf = entry => entry.at;
  const dayOf = () => "MON";
  const evenings = [log({ at: "17:30" }), log({ at: "17:45" }), log({ at: "18:05" }), log({ at: "07:00" })];
  assert.equal(usualStartTime(evenings, { sessionName: "Upper A", timeOf, dayOf }), "17:45");
  const scattered = [log({ at: "06:00" }), log({ at: "12:30" }), log({ at: "19:00" })];
  assert.equal(usualStartTime(scattered, { sessionName: "Upper A", timeOf, dayOf }), null);
  // Not enough of this session: the same weekday's workouts are used.
  const others = [log({ name: "Legs", at: "07:10" }), log({ name: "Push", at: "07:00" }), log({ name: "Pull", at: "07:20" })];
  assert.equal(usualStartTime(others, { sessionName: "Upper A", dayCode: "MON", timeOf, dayOf }), "07:10");
});
