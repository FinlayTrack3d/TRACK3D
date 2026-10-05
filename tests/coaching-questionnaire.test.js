import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, questionnaireAnswersFromExtraction } from "../lib/coaching/questionnaire.js";

const goals = ["Build muscle", "Build strength", "Lose fat", "General fitness", "Athletic performance"];

test("extraction replies wrapped in prose or code fences are still read", () => {
  assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"goal":["Lose fat"]}\n```\nHope that helps.'), { goal: ["Lose fat"] });
  assert.equal(extractJsonObject("no json here"), null);
});

test("chat answers are mapped onto the questionnaire", () => {
  const answers = questionnaireAnswersFromExtraction({
    goal: ["build muscle", "get fitter for football"],
    days_per_week: "four",
    preferred_days: ["Monday", "wed", "FRI", "Sat"],
    session_length: 45,
    equipment: ["dumbbells", "pull-up bar"],
    split: null,
    limitations: "left knee pain on deep squats",
    favourites: "null",
  }, goals);
  assert.deepEqual(answers.goal, ["Build muscle"]);
  assert.equal(answers.goal_custom, "get fitter for football");
  assert.equal(answers.days_per_week, "4 days");
  assert.deepEqual(answers.preferred_days, ["MON", "WED", "FRI", "SAT"]);
  assert.equal(answers.session_length, "45");
  assert.equal(answers.equipment, "dumbbells, pull-up bar");
  assert.equal(answers.limitations, "left knee pain on deep squats");
  assert.equal(answers.split, undefined);
  assert.equal(answers.favourites, undefined);
  assert.deepEqual(questionnaireAnswersFromExtraction({ preferred_days: "flexible" }, goals).preferred_days, ["FLEXIBLE"]);
  assert.deepEqual(questionnaireAnswersFromExtraction(null, goals), {});
});
