import test from "node:test";
import assert from "node:assert/strict";
import { starterPlan } from "../lib/starter-plans.js";

test("a starter plan follows the answers already given: days, equipment, time and level", () => {
  const plan = starterPlan({ days_per_week: "3 days", preferred_days: ["MON", "WED", "FRI"], equipment: "Dumbbells only", session_length: "45 minutes" }, "beginner");
  assert.equal(plan.sessions.length, 3);
  assert.deepEqual(plan.sessions.map(session => session.days[0]), ["MON", "WED", "FRI"]);
  assert.ok(plan.sessions.every(session => session.exercises.length === 5), "45 minutes: 5 exercises");
  assert.ok(plan.sessions.flatMap(session => session.exercises).every(exercise => !/Barbell|Cable|Machine|Pulldown/.test(exercise.name)), "dumbbells only");
  const squat = plan.sessions[0].exercises[0];
  assert.equal(squat.name, "Goblet Squat");
  assert.deepEqual(squat.reps, ["8-10", "8-10", "8-10"], "beginners: straight sets with a range on every set");
  assert.equal(plan.starter, true);
});

test("intermediate lifters get staggered ranges; 5+ days uses the 4-day starter and says so", () => {
  const plan = starterPlan({ days_per_week: "5 days", equipment: "Full gym", session_length: "1 hour" }, "intermediate");
  assert.equal(plan.sessions.length, 4);
  assert.match(plan.notes, /You asked for 5 days/);
  assert.deepEqual(plan.sessions[0].exercises[0].reps, ["6-8", "8-10", "10-12"]);
  assert.equal(new Set(plan.sessions.map(session => session.days[0])).size, 4);
  const bodyweight = starterPlan({ days_per_week: "2 days", equipment: "Bodyweight only" }, null);
  assert.equal(bodyweight.sessions.length, 2);
  assert.ok(bodyweight.sessions.flatMap(session => session.exercises).some(exercise => exercise.name === "Push-Up"));
});
