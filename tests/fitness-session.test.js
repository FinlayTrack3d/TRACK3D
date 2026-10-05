import test from "node:test";
import assert from "node:assert/strict";
import { buildLoggedExercises, buildWorkoutReview, moveWorkoutDay, recoverWorkoutState, workoutVolume } from "../lib/fitness-session.js";

test("an in-progress server log restores the remaining prescribed workout", () => {
  const planned = { name: "Push", exercises: [{ name: "Bench Press", sets: 3, reps: ["8", "8", "8"] }, { name: "Cable Fly", sets: 2, reps: ["12", "12"] }] };
  const exercises = buildLoggedExercises(planned, { 0: [{ weight: "60", reps: "8" }] });
  const recovered = recoverWorkoutState({ id: "log-1", session_name: "Push", date: "2026-09-29", created_at: "2026-09-29T08:00:00Z", exercises }, planned);
  assert.equal(recovered.activeSession.exercises.length, 2);
  assert.equal(recovered.completedSets[0].length, 1);
  assert.equal(recovered.activeSession.exercises[0].sets, 3);
  assert.equal(recovered.exerciseIdx, 0);
  assert.equal(recovered.workoutLogId, "log-1");
});

test("history volume recalculates after a set is edited or removed", () => {
  assert.equal(workoutVolume([{ sets: [{ weight: 50, reps: 10 }, { weight: 55, reps: 8 }] }]), 940);
  assert.equal(workoutVolume([{ sets: [{ weight: 50, reps: 10 }] }]), 500);
});

test("dragging a workout to an occupied day swaps the two sessions", () => {
  const sessions = [{ name: "Push", days: ["MON"], approval: { approved: true } }, { name: "Pull", days: ["WED"], approval: { approved: true } }];
  const moved = moveWorkoutDay(sessions, "Push", "MON", "WED");
  assert.deepEqual(moved.map((session) => session.days), [["WED"], ["MON"]]);
  assert.equal(moved[0].approval, null);
  assert.deepEqual(sessions.map((session) => session.days), [["MON"], ["WED"]]);
});

test("completion review preserves recorded reps and kg and only marks missing prescribed sets skipped", () => {
  const session = { name: "Push", exercises: [{ name: "Bench Press", sets: 3, reps: ["8", "8", "8"] }, { name: "Cable Fly", sets: 2, reps: "12-15" }] };
  const review = buildWorkoutReview(session, { 0: [{ weight: "60", reps: "8" }, { weight: "62.5", reps: "7" }], 1: [{ weight: "20", reps: "12" }] });
  assert.equal(review.prescribedSets, 5);
  assert.equal(review.completedSets, 3);
  assert.equal(review.skippedSets, 2);
  assert.equal(review.totalVolumeKg, 1157.5);
  assert.deepEqual(review.exercises[0].sets[1], { setNumber: 2, status: "completed", reps: 7, weightKg: 62.5, targetReps: "8", extra: false });
  assert.equal(review.exercises[0].sets[2].status, "skipped");
  assert.equal(review.exercises[1].sets[0].status, "completed");
});

test("extra completed sets are retained without being counted as skipped", () => {
  const session = { name: "Pull", exercises: [{ name: "Row", sets: 1, reps: "10" }] };
  const review = buildWorkoutReview(session, { 0: [{ weight: 40, reps: 10 }, { weight: 42, reps: 8, extra: true }] });
  assert.equal(review.completedSets, 2);
  assert.equal(review.skippedSets, 0);
  assert.equal(review.exercises[0].sets[1].extra, true);
});

test("coach workout summaries list every set against its target and group by session name", async () => {
  const { recentWorkoutsForCoach, summariseWorkoutForCoach } = await import("../lib/fitness-session.js");
  const pullA = { date: "2026-10-03", session_name: "Pull A", duration_mins: 41, exercises: [{ name: "Row", prescribed_sets: 3, prescribed_reps: "8-12", sets: [{ reps: "12", weight: "40" }, { reps: "12", weight: "40" }] }] };
  const summary = summariseWorkoutForCoach(pullA);
  assert.match(summary, /Pull A · 41 min/);
  assert.match(summary, /S1 12 × 40kg \(target 8-12\); S2 12 × 40kg \(target 8-12\); S3 skipped \(target 8-12\)/);
  const grouped = recentWorkoutsForCoach([pullA, { ...pullA, session_name: "Pull B", date: "2026-10-02" }, { ...pullA, date: "2026-09-30" }]);
  const pullASection = grouped.split("\n\n").find((section) => section.startsWith('SESSION "Pull A"'));
  assert.equal((pullASection.match(/· Pull A ·/g) || []).length, 2);
  assert.doesNotMatch(pullASection, /Pull B/);
  assert.equal(recentWorkoutsForCoach([]), "No completed workouts yet.");
});

test("saved plans are compared without depending on jsonb key order", async () => {
  const { sameJson } = await import("../lib/fitness-session.js");
  assert.equal(sameJson([{ name: "Push", days: ["MON"], exercises: [{ sets: 3, name: "Bench" }] }], [{ exercises: [{ name: "Bench", sets: 3 }], days: ["MON"], name: "Push", note: undefined }]), true);
  assert.equal(sameJson([{ name: "Push", days: ["MON"] }], [{ name: "Push", days: ["TUE"] }]), false);
});
