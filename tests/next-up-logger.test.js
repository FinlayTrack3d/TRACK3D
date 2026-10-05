import test from "node:test";
import assert from "node:assert/strict";
import { nextUpItems } from "../lib/next-up.js";
import { isFinishedWorkout, loggedSetsSignature, sessionForDay, setLoggerDefaults, stepSetValue } from "../lib/fitness-session.js";

const day = {
  morning: { hasRoutine: true, done: false, wakeTime: "06:00" },
  workout: { scheduledName: "Upper A", done: false },
  meals: [{ name: "Breakfast", time: "07:00", logged: false }, { name: "Lunch", time: "12:30", logged: false }],
  habits: [{ id: 1, name: "Read 10 pages", done: false }, { id: 2, name: "Walk", done: true }],
};

test("next up follows the day: morning, workout, meal, habits, end of day", () => {
  const morning = nextUpItems({ ...day, hour: 7 });
  assert.deepEqual(morning.map(item => item.id), ["morning", "workout", "meal", "habit"]);
  assert.equal(morning[0].action, "START →");
  assert.equal(morning[2].title, "Breakfast");
  assert.equal(morning[3].title, "Read 10 pages");
  assert.match(morning[3].detail, /1 habit left/);
  // After midday an untouched morning is no longer due.
  assert.deepEqual(nextUpItems({ ...day, hour: 13 }).map(item => item.id), ["workout", "meal", "habit"]);
  // A started morning stays due.
  assert.equal(nextUpItems({ ...day, hour: 13, morning: { ...day.morning, inProgress: true } })[0].action, "FINISH →");
  // Evening: the end-of-day check-in joins the end of the list.
  assert.deepEqual(nextUpItems({ ...day, hour: 19 }).map(item => item.id), ["workout", "meal", "habit", "endOfDay"]);
  assert.deepEqual(nextUpItems({ ...day, hour: 19, endOfDayDone: true }).map(item => item.id), ["workout", "meal", "habit"]);
});

test("a workout in progress comes first; logged meals are skipped", () => {
  const items = nextUpItems({ ...day, hour: 9, workout: { inProgressName: "Upper A" }, meals: [{ name: "Breakfast", time: "07:00", logged: true }, { name: "Lunch", time: "12:30", logged: false }] });
  assert.equal(items[0].id, "workout");
  assert.equal(items[0].action, "CONTINUE →");
  assert.equal(items.filter(item => item.id === "workout").length, 1);
  const meal = items.find(item => item.id === "meal");
  assert.equal(meal.title, "Lunch");
  assert.equal(meal.mealIndex, 1, "index in today's meal list, for one-tap logging");
  assert.deepEqual(nextUpItems({ hour: 10 }), [], "nothing set up, nothing due");
});

test("set logger starts from today's target and last weight", () => {
  // Last time 80 kg x 9 in an 8-10 range, no change suggested: same again.
  assert.deepEqual(setLoggerDefaults({ repRange: "8-10", lastSet: { weight: "80", reps: "9" } }), { weight: "80", reps: "9" });
  // Weight went up: start at the bottom of the range.
  assert.deepEqual(setLoggerDefaults({ repRange: "8-10", lastSet: { weight: "80", reps: "10" }, suggestedWeight: "82.5" }), { weight: "82.5", reps: "8" });
  // Last time's reps are kept inside today's range.
  assert.deepEqual(setLoggerDefaults({ repRange: "8-10", lastSet: { weight: "80", reps: "12" } }), { weight: "80", reps: "10" });
  // A set already logged today sets the weight for the next one.
  assert.equal(setLoggerDefaults({ repRange: "6-8", previousSet: { weight: "100", reps: "7" }, lastSet: { weight: "95", reps: "8" } }).weight, "100");
  // No history: reps from the range, weight left for the user.
  assert.deepEqual(setLoggerDefaults({ repRange: "12" }), { weight: "", reps: "12" });
  assert.deepEqual(setLoggerDefaults({ repRange: "AMRAP" }), { weight: "", reps: "" });
  assert.equal(stepSetValue("80", 2.5), "82.5");
  assert.equal(stepSetValue("1", -2.5), "0");
  assert.equal(stepSetValue("", 1), "1");
});

test("restored sets match the server, so nothing is written on load", () => {
  const server = [{ name: "Bench Press", sets: [{ weight: "80", reps: "8", setNum: 1, repRange: "8-10" }] }, { name: "Row", sets: [] }];
  const local = [{ name: "bench press", prescribed_sets: 3, sets: [{ reps: "8", weight: "80", setNum: 1, repRange: "6-8" }] }, { name: "Row", sets: [] }];
  assert.equal(loggedSetsSignature(server), loggedSetsSignature(local));
  assert.notEqual(loggedSetsSignature(server), loggedSetsSignature([{ name: "Bench Press", sets: [{ weight: "80", reps: "9" }] }]));
  assert.equal(isFinishedWorkout({ in_progress: true, date: "2026-10-04" }, "2026-10-05"), true, "yesterday's unfinished workout shows as finished");
  assert.equal(isFinishedWorkout({ in_progress: true, date: "2026-10-05" }, "2026-10-05"), false);
  assert.equal(sessionForDay([{ name: "Upper A", days: ["MONDAY"] }], "MON").name, "Upper A");
  assert.equal(sessionForDay([{ name: "Upper A", days: ["TUE"] }], "MON"), null);
});
