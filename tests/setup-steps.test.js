import test from "node:test";
import assert from "node:assert/strict";
import { nextSetupStep, setupComplete, setupSavedBanner, setupSteps, tomorrowPlan } from "../lib/setup-steps.js";

test("setup steps run profile, training plan, calorie target, morning, then optional habits", () => {
  assert.deepEqual(setupSteps({}).map(step => step.id), ["profile", "fitness", "nutrition", "morning", "habits"]);
  assert.equal(nextSetupStep({}).id, "profile");
  assert.equal(nextSetupStep({ profile: true, morning: true }).id, "fitness", "steps done out of order are skipped");
  assert.equal(setupComplete({ profile: true, fitness: true, nutrition: true, morning: true }), true, "habits are optional");
  assert.equal(nextSetupStep({ profile: true, fitness: true, nutrition: true, morning: true }).id, "habits");
  assert.equal(nextSetupStep({ profile: true, fitness: true, nutrition: true, morning: true, habits: true }), null);
});

test("after a save the banner points to the next step, or says you're all set", () => {
  assert.deepEqual(setupSavedBanner("morning", { profile: true, morning: true }), { title: "Morning set ✓", text: "Next: Build your training plan", next: "fitness", allSet: false });
  assert.deepEqual(setupSavedBanner("nutrition", { profile: true, fitness: true, nutrition: true, morning: true }), { title: "Calorie target set ✓", text: "You're all set.", next: null, allSet: true });
  assert.equal(setupSavedBanner("unknown", {}), null);
});

test("tomorrow's plan: wake-up, first workout and first meal", () => {
  // 2026-10-15 is a Thursday.
  const sessions = [{ name: "Full Body A", days: ["MON"] }, { name: "Full Body B", days: ["WED"] }];
  const meals = [{ name: "Lunch", time: "12:30" }, { name: "Eggs on Toast", time: "07:30" }];
  const lines = tomorrowPlan({ today: "2026-10-15", wakeTime: "06:30", sessions, mealsFor: () => meals });
  assert.deepEqual(lines.map(line => line.text), ["Morning routine from 06:30", "First workout: Full Body A, Monday", "First meal: Eggs on Toast at 07:30"]);
  const friday = tomorrowPlan({ today: "2026-10-15", sessions: [{ name: "Upper A", days: ["FRIDAY"] }] });
  assert.deepEqual(friday.map(line => line.text), ["First workout: Upper A, tomorrow"]);
  // Tomorrow's meals follow whether tomorrow is a training day.
  let asked = null;
  tomorrowPlan({ today: "2026-10-15", sessions: [{ name: "Upper A", days: ["FRI"] }], mealsFor: (date, training) => { asked = [date, training]; return []; } });
  assert.deepEqual(asked, ["2026-10-16", true]);
});

test("answers given in one setup are reused in the others", async () => {
  const { EXPERIENCE_ANSWERS } = await import("../lib/setup-steps.js");
  const { normaliseExperience } = await import("../lib/coaching/system.js");
  const { normaliseNutritionGoal } = await import("../lib/nutrition-setup.js");
  const { inMorningRoutine } = await import("../lib/habit-links.js");
  for (const [level, answer] of Object.entries(EXPERIENCE_ANSWERS)) assert.equal(normaliseExperience(answer), level);
  // The training goal picks the nutrition goal.
  assert.equal(normaliseNutritionGoal("Build muscle and Lose fat"), "Lose fat");
  assert.equal(normaliseNutritionGoal("Build muscle"), "Lean bulk");
  assert.equal(normaliseNutritionGoal("General fitness"), null, "no match: the usual default");
  // Habit suggestions the morning already covers.
  assert.equal(inMorningRoutine("Drink enough water", ["Wake up", "Drink water"]), true);
  assert.equal(inMorningRoutine("Plan tomorrow", ["Drink water"]), false);
});
