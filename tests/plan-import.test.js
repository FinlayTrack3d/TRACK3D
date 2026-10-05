import test from "node:test";
import assert from "node:assert/strict";
import { importSourceText, isSupportedImportFile, normaliseImportedFitnessPlan, IMPORT_TEXT_LIMIT } from "../lib/plan-import.js";

test("text sources are cleaned and very long plans are truncated", () => {
  assert.deepEqual(importSourceText("  Push A\r\nBench - 3 x 8  "), { text: "Push A\nBench - 3 x 8", truncated: false });
  const long = importSourceText("x".repeat(IMPORT_TEXT_LIMIT + 5));
  assert.equal(long.text.length, IMPORT_TEXT_LIMIT);
  assert.equal(long.truncated, true);
});

test("only text-based files are accepted in V1", () => {
  assert.equal(isSupportedImportFile("plan.csv"), true);
  assert.equal(isSupportedImportFile("PLAN.TXT"), true);
  assert.equal(isSupportedImportFile("plan.xlsx"), false);
  assert.equal(isSupportedImportFile("plan.pdf"), false);
});

test("a clear coach plan maps straight onto TRACK3D sessions", () => {
  const result = normaliseImportedFitnessPlan({
    plan_name: "Coach Sam block 1",
    notes: "Add 2.5kg when all sets hit the top of the range.",
    sessions: [{ name: "Push A", days: ["Monday"], notes: "Warm up shoulders", exercises: [
      { name: "Incline Dumbbell Press", sets: 3, reps: "8-10", rest_seconds: 120, tempo: null, notes: "RIR 2" },
      { name: "Cable Fly", sets: 3, reps: ["12-15", "12-15", "12-15"], rest_seconds: null },
    ] }],
    uncertain: [],
  });
  assert.equal(result.planName, "Coach Sam block 1");
  assert.equal(result.notes, "Add 2.5kg when all sets hit the top of the range.");
  assert.deepEqual(result.sessions[0].days, ["MON"]);
  assert.equal(result.sessions[0].notes, "Warm up shoulders");
  assert.deepEqual(result.sessions[0].exercises[0], { name: "Incline Dumbbell Press", sets: 3, reps: ["8-10", "8-10", "8-10"], rest_seconds: 120, notes: "RIR 2" });
  assert.deepEqual(result.sessions[0].exercises[1], { name: "Cable Fly", sets: 3, reps: ["12-15", "12-15", "12-15"] });
  assert.deepEqual(result.flags, []);
});

test("missing or doubtful details are flagged, never silently invented", () => {
  const result = normaliseImportedFitnessPlan({
    sessions: [
      { name: "Day 1", days: [], exercises: [{ name: "Squat", sets: null, reps: null }, { name: "Leg Press", sets: null, reps: ["10", "8", "6"] }, { name: "", sets: 3 }] },
      { name: "Day 2", days: ["Funday"], exercises: [{ name: "Row", sets: 14, reps: "10" }] },
      { name: "Empty", days: [], exercises: [] },
    ],
    uncertain: [{ where: "Day 1 · Squat", issue: "Weight column unreadable" }],
  });
  const issues = result.flags.map((item) => `${item.where}: ${item.issue}`).join("\n");
  assert.match(issues, /Day 1 · Squat: Weight column unreadable/);
  assert.match(issues, /Day 1 · Squat: Sets not stated - set to 3/);
  assert.match(issues, /Day 1 · Squat: Reps not stated - set to 8-12/);
  assert.match(issues, /Day 1 · Leg Press: Sets not stated - taken as 3 from the reps listed/);
  assert.match(issues, /exercise without a name was left out/);
  assert.match(issues, /Day 2: Some training days could not be read \(Funday\)/);
  assert.match(issues, /Day 2 · Row: 14 sets looks unusual - capped at 10/);
  assert.match(issues, /Empty: No exercises were found/);
  assert.match(issues, /does not say which weekdays/);
  assert.deepEqual(result.sessions.map((session) => session.name), ["Day 1", "Day 2"]);
  assert.deepEqual(result.sessions[0].exercises[1].reps, ["10", "8", "6"]);
});

test("two sessions on the same weekday are flagged", () => {
  const result = normaliseImportedFitnessPlan({ sessions: [
    { name: "Push", days: ["MON"], exercises: [{ name: "Bench", sets: 3, reps: "8" }] },
    { name: "Pull", days: ["mon"], exercises: [{ name: "Row", sets: 3, reps: "8" }] },
  ] });
  assert.match(result.flags.map((item) => item.issue).join(" "), /Push and Pull are both on MON/);
});
