import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRanges, equipmentOf, inSessionCue, nextForSet, planExercise, rangeProblem, reorderAfterFirstSession,
  setStatus, shouldAskFormRating, snapWeight, stepFor, suggestSet, withRanges,
} from "../lib/set-progression.js";

const r = (min, max) => ({ min, max });
const set = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), ...extra });

test("the Rep-Range Result Table, row by row, for one set (8-12, 2 kg steps)", () => {
  const next = (reps, extra = {}) => nextForSet({ range: r(8, 12), last: set(20, reps), step: 2, ...extra });
  assert.deepEqual([next(15).weight, next(15).reps], [24, 8]);   // max + 3: two steps
  assert.deepEqual([next(13).weight, next(13).reps], [22, 8]);   // max + 1: one step
  assert.deepEqual([next(12).weight, next(12).reps], [22, 8]);   // top: one step
  assert.deepEqual([next(10).weight, next(10).reps], [20, 11]);  // in range: +1 rep
  assert.deepEqual([next(7).weight, next(7).reps], [20, 8]);     // just under, first time: hold
  assert.deepEqual([next(6).weight, next(6).reps], [18, 8]);     // 2-3 under: one step down
  assert.deepEqual([next(4).weight, next(4).reps], [18, 8]);     // 4+ under: one step down
});

test("just under twice running drops a step; once holds", () => {
  const once = nextForSet({ range: r(10, 15), last: set(12, 9), previous: set(12, 11), step: 2 });
  assert.equal(once.weight, 12);
  const twice = nextForSet({ range: r(10, 15), last: set(12, 9), previous: set(12, 9), step: 2 });
  assert.equal(twice.weight, 10);
  assert.equal(twice.reps, 10, "after a drop the aim is the bottom of the range, never the top");
});

test("2-3 under on the first session after an increase holds once; a long gap holds", () => {
  const newWeight = nextForSet({ range: r(8, 12), last: set(22.5, 6), previous: set(20, 12), step: 2.5 });
  assert.equal(newWeight.weight, 22.5);
  const gap = nextForSet({ range: r(8, 12), last: set(20, 6), step: 2.5, daysSince: 20 });
  assert.equal(gap.weight, 20);
  const wayUnder = nextForSet({ range: r(8, 12), last: set(22.5, 3), previous: set(20, 12), step: 2.5 });
  assert.equal(wayUnder.weight, 20, "4 or more under always drops");
});

test("a form rating below 4 holds the top of the range and limits a big overshoot to one step", () => {
  const top = nextForSet({ range: r(8, 12), last: set(20, 12, { formRating: 3 }), step: 2 });
  assert.equal(top.weight, 20);
  assert.equal(top.reps, 12);
  assert.equal(top.formFocus, true);
  const over = nextForSet({ range: r(8, 12), last: set(20, 16, { formRating: 2 }), step: 2 });
  assert.equal(over.weight, 22);
  const good = nextForSet({ range: r(8, 12), last: set(20, 12, { formRating: 5 }), step: 2 });
  assert.equal(good.weight, 22);
});

test("staggered sets progress on their own but a later set is never heavier", () => {
  const ranges = ["6-8", "8-10", "10-12"];
  const exposures = [
    { date: "2026-10-10", sets: [set(70, 8), set(65, 9), set(60, 12)] },
    { date: "2026-10-03", sets: [set(70, 7), set(65, 9), set(57.5, 12)] },
  ];
  const plan = planExercise({ ranges, exposures, step: 2.5, todayKey: "2026-10-14" });
  assert.deepEqual(plan.map(item => [item.weight, item.reps]), [[72.5, 6], [65, 10], [62.5, 10]]);
  const capped = planExercise({ ranges, exposures: [{ date: "2026-10-10", sets: [set(60, 7), set(60, 10), set(60, 12)] }, exposures[1]], step: 2.5 });
  assert.ok(capped[2].weight <= capped[1].weight && capped[1].weight <= capped[0].weight);
});

test("warm-up sets are left out of progression", () => {
  const plan = planExercise({
    ranges: ["8-12", "8-12"],
    exposures: [
      { sets: [set(15, 10, { warmup: true }), set(20, 12), set(20, 12)] },
      { sets: [set(20, 10), set(20, 10)] },
    ],
    step: 2.5,
  });
  assert.deepEqual(plan.map(item => item.weight), [22.5, 22.5]);
});

test("straight sets (beginners) keep one weight: up only when every set reaches the top", () => {
  const ranges = ["8-10", "8-10", "8-10"];
  const hold = planExercise({ ranges, exposures: [{ sets: [set(40, 10), set(40, 9), set(40, 8)] }, { sets: [set(40, 9), set(40, 8), set(40, 8)] }], step: 2.5 });
  assert.deepEqual(hold.map(item => item.weight), [40, 40, 40]);
  assert.deepEqual(hold.map(item => item.reps), [10, 10, 9]);
  const up = planExercise({ ranges, exposures: [{ sets: [set(40, 10), set(40, 10), set(40, 10)] }, { sets: [set(40, 9), set(40, 9), set(40, 8)] }], step: 2.5 });
  assert.deepEqual(up.map(item => item.weight), [42.5, 42.5, 42.5]);
});

test("session 2 of a brand-new exercise is reordered heaviest first (playbook example)", () => {
  const plan = reorderAfterFirstSession({ sets: [set(60, 10), set(65, 10), set(70, 8)], ranges: ["6-8", "8-10", "10-12"], step: 2.5 });
  assert.deepEqual(plan.map(item => [item.weight, item.reps]), [[70, 8], [65, 10], [62.5, 10]]);
  assert.equal(reorderAfterFirstSession({ sets: [set(60, 10), set(60, 9)], ranges: ["8-10", "8-10"], step: 2.5 }), null, "one weight: no reordering");
  const beginner = reorderAfterFirstSession({ sets: [set(60, 10), set(65, 10), set(70, 6)], ranges: ["8-10", "8-10", "8-10"], step: 2.5 });
  assert.deepEqual(beginner.map(item => [item.weight, item.reps]), [[65, 10], [65, 10], [65, 10]]);
  const viaPlan = planExercise({ ranges: ["6-8", "8-10", "10-12"], exposures: [{ sets: [set(60, 10), set(65, 10), set(70, 8)] }], step: 2.5 });
  assert.equal(viaPlan[0].reordered, true);
  assert.equal(viaPlan[0].weight, 70);
});

test("in the workout: the next set follows today's weight, moved by the cue, never above it", () => {
  const ranges = ["10-15", "10-15", "10-15"];
  const plan = [{ weight: 10, reps: 10 }, { weight: 10, reps: 10 }, { weight: 10, reps: 10 }];
  const followsChoice = suggestSet({ ranges, setIndex: 1, plan, todaySets: [set(12, 11)], step: 2 });
  assert.equal(followsChoice.weight, "12", "the user chose 12 kg for set 1, so set 2 stays at 12 kg");
  const heavy = suggestSet({ ranges, setIndex: 1, plan, todaySets: [set(12, 7)], step: 2 });
  assert.equal(heavy.weight, "10", "two or three under the range: a step lighter for the next set");
  assert.match(heavy.note, /Heavy/);
  const light = suggestSet({ ranges, setIndex: 1, plan, todaySets: [set(12, 18)], step: 2 });
  assert.equal(light.weight, "12", "never heavier than the set before");
});

test("suggestions fill the planned weight and reps as values, with no history a weight is asked for", () => {
  const planned = suggestSet({ ranges: ["8-12"], setIndex: 0, plan: [{ weight: 22.5, reps: 10, reason: "in range: same weight, one more rep" }] });
  assert.equal(planned.weight, "22.5");
  assert.equal(planned.reps, "10");
  const fresh = suggestSet({ ranges: ["8-12"], setIndex: 0 });
  assert.equal(fresh.weight, "");
  assert.match(fresh.note, /No history yet/);
});

test("in-session cues and set labels follow the table", () => {
  assert.equal(inSessionCue(15, "8-12").delta, 1);
  assert.equal(inSessionCue(6, "8-12").delta, -1);
  assert.equal(inSessionCue(3, "8-12", { week: 1 }).delta, -2);
  assert.equal(setStatus(7, "10-15").tone, "under");
  assert.equal(setStatus(7, "10-15").label, "below 10–15");
  assert.equal(setStatus(12, "8-12").label, "Top ✓");
});

test("weight steps come from the gym and suggestions snap to them", () => {
  assert.equal(equipmentOf("Dumbbell Bicep Curl"), "dumbbell");
  assert.equal(equipmentOf("Goblet Squat"), "dumbbell");
  assert.equal(equipmentOf("Lat Pulldown"), "cable");
  assert.equal(equipmentOf("Leg Press"), "machine");
  assert.equal(equipmentOf("Barbell Back Squat"), "barbell");
  assert.equal(stepFor("Dumbbell Row", { dumbbell: 2 }), 2);
  assert.equal(stepFor("Leg Press"), 5);
  assert.equal(snapWeight(11, 2), 12);
  assert.equal(snapWeight(23, 2.5, "down"), 22.5);
});

test("form rating is asked at the top of the range, not in week 1, at most twice a workout and weekly", () => {
  assert.equal(shouldAskFormRating({ reps: 12, range: "8-12" }), true);
  assert.equal(shouldAskFormRating({ reps: 11, range: "8-12" }), false);
  assert.equal(shouldAskFormRating({ reps: 12, range: "8-12", week: 1 }), false);
  assert.equal(shouldAskFormRating({ reps: 12, range: "8-12", warmup: true }), false);
  assert.equal(shouldAskFormRating({ reps: 12, range: "8-12", askedThisWorkout: 2 }), false);
  assert.equal(shouldAskFormRating({ reps: 12, range: "8-12", lastAskedDaysAgo: 3 }), false);
  assert.equal(shouldAskFormRating({ reps: 12, range: "8-12", lastAskedDaysAgo: 3, lastRating: 3 }), true);
});

test("every set gets a range: defaults by type and level, and a range typed must be valid", () => {
  assert.deepEqual(defaultRanges(3), ["6-8", "8-10", "10-12"]);
  assert.deepEqual(defaultRanges(3, { kind: "isolation" }), ["10-12", "12-15", "12-15"]);
  assert.deepEqual(defaultRanges(3, { straight: true }), ["8-10", "8-10", "8-10"]);
  assert.deepEqual(withRanges({ name: "Dumbbell Bicep Curl", sets: 3, reps: ["12", "12", "12"] }).reps, ["10-12", "12-15", "12-15"]);
  assert.deepEqual(withRanges({ name: "Bench Press", sets: 2, reps: ["8-12", "10-15"] }).reps, ["8-12", "10-15"]);
  assert.equal(rangeProblem("12-8"), "The first number must be lower than the second.");
  assert.equal(rangeProblem("8-12"), "");
  assert.equal(rangeProblem("abc"), "Enter a range like 8-12.");
});
