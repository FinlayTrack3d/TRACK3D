import test from "node:test";
import assert from "node:assert/strict";
import { nextUpItems } from "../lib/next-up.js";
import { isFinishedWorkout, loggedSetsSignature, sessionForDay, setLoggerSuggestion, stepSetValue } from "../lib/fitness-session.js";

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
  // Evening: the end-of-day check-in joins the end of the list (today's
  // meals have all passed, so none is "next").
  assert.deepEqual(nextUpItems({ ...day, hour: 19 }).map(item => item.id), ["workout", "habit", "endOfDay"]);
  assert.deepEqual(nextUpItems({ ...day, hour: 19, endOfDayDone: true }).map(item => item.id), ["workout", "habit"]);
  // Nothing set up yet: no end-of-day check-in.
  assert.deepEqual(nextUpItems({ hour: 21, endOfDayDue: false }), []);
});

test("the workout's usual time orders it against meals", () => {
  const meals = [{ name: "Lunch", time: "12:30", logged: false }];
  const late = nextUpItems({ hour: 11, time: "11:00", workout: { scheduledName: "Upper A", usualTime: "17:45" }, meals });
  assert.deepEqual(late.map(item => item.id), ["meal", "workout"]);
  assert.equal(late[1].detail, "Today's workout · usually 17:45");
  const early = nextUpItems({ hour: 11, time: "11:00", workout: { scheduledName: "Upper A", usualTime: "11:30" }, meals });
  assert.deepEqual(early.map(item => item.id), ["workout", "meal"]);
  assert.equal(nextUpItems({ hour: 11, workout: { scheduledName: "Upper A" }, meals })[0].id, "workout", "no pattern: as before");
});

test("a meal whose time has passed is not next", () => {
  const meals = [{ name: "Eggs on Toast", time: "07:30", logged: false }, { name: "Lunch", time: "12:30", logged: false }, { name: "Dinner", time: "18:30", logged: false }];
  const mealAt = time => nextUpItems({ hour: Number(time.slice(0, 2)), time, meals }).find(item => item.id === "meal")?.title || null;
  assert.equal(mealAt("07:00"), "Eggs on Toast");
  assert.equal(mealAt("08:15"), "Eggs on Toast", "still next for an hour after its time");
  assert.equal(mealAt("08:45"), "Lunch");
  assert.equal(mealAt("22:50"), null, "after the last meal, nothing");
  // Meals without a time stay next until they are logged.
  assert.equal(nextUpItems({ hour: 23, meals: [{ name: "Snack", logged: false }] }).find(item => item.id === "meal").title, "Snack");
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

test("set logger suggests the reps to aim for and the weight, and says why", () => {
  const range = ["6-8", "6-8", "6-8"];
  const last = (...sets) => sets.map(([reps, weight = "42.5"]) => ({ weight, reps: String(reps) }));
  // 7 last time in a 6-8 range: same weight, aim for 8.
  assert.deepEqual(setLoggerSuggestion({ ranges: range, setIndex: 0, lastSets: last([7], [7], [6]) }), { weight: "42.5", reps: "8", note: "Last time 7 × 42.5 kg. Aim for 8." });
  // 12 on a 6-8 range: the weight is too light, so 45 kg.
  assert.deepEqual(setLoggerSuggestion({ ranges: range, setIndex: 0, lastSets: last([12], [8], [7]) }), { weight: "45", reps: "8", note: "Last time 12 × 42.5 kg, over the 6-8 range, so 45 kg today. Aim for 8." });
  // One rep over the top is not enough on its own: aim for the top.
  assert.deepEqual(setLoggerSuggestion({ ranges: range, setIndex: 0, lastSets: last([9], [7], [6]) }).weight, "42.5");
  // Every set at the top of its own range, including a 6-rep back-off set.
  const backOff = setLoggerSuggestion({ ranges: ["6-8", "6-8", "8-10", "6"], setIndex: 0, lastSets: last([8, "60"], [8, "60"], [10, "60"], [6, "60"]) });
  assert.deepEqual(backOff, { weight: "62.5", reps: "6", note: "Every set reached the top of its range last time, so 62.5 kg today. Aim for 6." });
  // Later sets keep today's weight; the aim comes from last time's set at that weight.
  // Set 2 follows set 2 last time, not the weight set 1 moved to today.
  assert.deepEqual(setLoggerSuggestion({ ranges: range, setIndex: 1, lastSets: last([12], [8], [7]), todaySets: [{ weight: "45", reps: "8" }] }), { weight: "42.5", reps: "8", note: "Last time 8 × 42.5 kg. Aim for 8." });
  // Light, high-rep work: the top of a 15-20 range on every set still moves
  // the weight up, even though it is a big step; aim for the bottom of the range.
  assert.deepEqual(setLoggerSuggestion({ ranges: ["15-20", "15-20"], setIndex: 0, lastSets: [{ weight: "10", reps: "20" }, { weight: "10", reps: "20" }], increment: 2.5, bigStep: true }),
    { weight: "12.5", reps: "15", note: "Every set reached the top of its range last time, so 12.5 kg today. It's a big step at this weight: aim for 15, and if you can't get 15 with good form, go back to 10 kg." });
  assert.equal(setLoggerSuggestion({ ranges: ["12-15"], setIndex: 0, lastSets: [{ weight: "10", reps: "15" }], bigStep: true }).weight, "12.5");
  // Set 2 of a 12-15 exercise follows set 2 last time up too.
  assert.equal(setLoggerSuggestion({ ranges: ["12-15", "12-15"], setIndex: 1, lastSets: [{ weight: "8", reps: "15" }, { weight: "8", reps: "15" }], increment: 2, bigStep: true, todaySets: [{ weight: "10", reps: "13" }] }).weight, "10");
  // No history: aim for the top of the range; the weight is yours to choose.
  assert.deepEqual(setLoggerSuggestion({ ranges: range, setIndex: 0 }), { weight: "", reps: "8", note: "No history yet: pick a weight you can lift for 6-8 reps with good form." });
  // Bodyweight: 0 kg stays 0 kg, aim for one more rep.
  assert.deepEqual(setLoggerSuggestion({ ranges: ["8-12"], setIndex: 0, lastSets: [{ weight: "0", reps: "9" }] }), { weight: "0", reps: "10", note: "Last time 9 reps. Aim for 10." });
  assert.deepEqual(setLoggerSuggestion({ ranges: ["AMRAP"], setIndex: 0 }), { weight: "", reps: "", note: "" });
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

test("each set follows the same set last time, so planned drops in weight are kept", () => {
  // Last time 35 kg, then 30 kg: set 2 today is 30 kg even though set 1 was 35.
  const lastSets = [{ weight: "35", reps: "9" }, { weight: "30", reps: "9" }];
  const setTwo = setLoggerSuggestion({ ranges: ["8-10", "8-10"], setIndex: 1, lastSets, todaySets: [{ weight: "35", reps: "9" }] });
  assert.deepEqual(setTwo, { weight: "30", reps: "10", note: "Last time 9 × 30 kg. Aim for 10." });
  // A set with nothing to match last time follows the set just logged.
  assert.equal(setLoggerSuggestion({ ranges: ["8-10", "8-10", "8-10"], setIndex: 2, lastSets, todaySets: [{ weight: "35", reps: "9" }, { weight: "32.5", reps: "9" }] }).weight, "32.5");
});

test("well under the range last time: drop the weight to reach the top of it", () => {
  // 6 × 5 kg on a 10-12 range: lighter, aiming for 12, not 5 kg aiming for 10.
  assert.deepEqual(setLoggerSuggestion({ ranges: ["10-12"], setIndex: 0, lastSets: [{ weight: "5", reps: "6" }] }),
    { weight: "2.5", reps: "12", note: "Last time 6 × 5 kg, under the 10-12 range, so 2.5 kg today to reach 12. Aim for 12." });
  // Weights that go up in 5 kg: down to 0 kg.
  assert.equal(setLoggerSuggestion({ ranges: ["10-12"], setIndex: 0, lastSets: [{ weight: "5", reps: "6" }], increment: 5 }).weight, "0");
  // Choosing the old weight anyway says what would reach the range.
  assert.deepEqual(setLoggerSuggestion({ ranges: ["10-12"], setIndex: 0, lastSets: [{ weight: "5", reps: "6" }], chosenWeight: "5" }),
    { weight: "5", reps: "10", note: "Last time 6 × 5 kg, under the 10-12 range: 2.5 kg should let you reach 12. At 5 kg, aim for 10." });
  // One rep short is close enough: same weight, one more rep.
  assert.deepEqual(setLoggerSuggestion({ ranges: ["10-12"], setIndex: 0, lastSets: [{ weight: "20", reps: "9" }] }), { weight: "20", reps: "10", note: "Last time 9 × 20 kg. Aim for 10." });
  // Heavier: 60 kg × 5 on 8-10 → 52.5 kg (Epley estimate for 10, in 2.5 kg steps).
  assert.equal(setLoggerSuggestion({ ranges: ["8-10"], setIndex: 0, lastSets: [{ weight: "60", reps: "5" }] }).weight, "52.5");
});

test("the halfway check-in compares today's sets with the same sets last time", async () => {
  const { midSessionCheckIn, nextUnfinishedExercise } = await import("../lib/fitness-session.js");
  const exercises = [{ name: "Bench Press", sets: 2, reps: ["6-8", "6-8"] }, { name: "Row", sets: 2, reps: ["8-10"] }];
  const lastSetsByExercise = [[{ weight: "80", reps: "8" }, { weight: "80", reps: "7" }], []];
  // Not halfway yet with one set of four.
  assert.equal(midSessionCheckIn({ exercises, completedSets: { 0: [{ weight: "80", reps: "8" }] }, lastSetsByExercise }).halfway, false);
  const strong = midSessionCheckIn({ exercises, completedSets: { 0: [{ weight: "82.5", reps: "8" }, { weight: "80", reps: "7" }] }, lastSetsByExercise });
  assert.deepEqual({ halfway: strong.halfway, better: strong.better, same: strong.same, under: strong.under, verdict: strong.verdict }, { halfway: true, better: 1, same: 1, under: 0, verdict: "strong" });
  assert.deepEqual(strong.lines, ["Bench Press: set 1 8×82.5kg, set 2 7×80kg (last time: set 1 8×80kg, set 2 7×80kg)"]);
  assert.deepEqual(strong.remaining, ["Row"]);
  const off = midSessionCheckIn({ exercises, completedSets: { 0: [{ weight: "80", reps: "5" }, { weight: "80", reps: "4" }] }, lastSetsByExercise });
  assert.equal(off.verdict, "off");
  assert.equal(off.under, 2);
  // Every set logged: past halfway, nothing to check in about.
  assert.equal(midSessionCheckIn({ exercises, completedSets: { 0: [{}, {}], 1: [{}, {}] }, lastSetsByExercise }).halfway, false);

  // After finishing an exercise: the next unfinished one, going round to a missed one.
  const three = [{ sets: 2 }, { sets: 2 }, { sets: 2 }];
  assert.equal(nextUnfinishedExercise(three, { 0: [{}, {}] }, 0), 1);
  assert.equal(nextUnfinishedExercise(three, { 0: [{}, {}], 2: [{}, {}] }, 2), 1, "back to the missed middle one");
  assert.equal(nextUnfinishedExercise(three, { 0: [{}], 1: [{}, {}], 2: [{}, {}] }, 2), 0);
  assert.equal(nextUnfinishedExercise(three, { 0: [{}, {}], 1: [{}, {}], 2: [{}, {}] }, 2), null);
});
