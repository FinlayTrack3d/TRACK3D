import test from "node:test";
import assert from "node:assert/strict";
import { activeWorkoutLogIds, buildLoggedExercises, buildWorkoutReview, improvementsSinceLastTime, moveWorkoutDay, recoverWorkoutState, weeklyWorkoutProgress, workoutPersonalBests, workoutVolume } from "../lib/fitness-session.js";

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

test("detected PBs are kept on the saved sets", () => {
  const session = { name: "Push", exercises: [{ name: "Bench Press", sets: 2, reps: ["8", "8"] }] };
  const pb = { type: "weight_pb", label: "Weight PB" };
  const [exercise] = buildLoggedExercises(session, { 0: [{ weight: "80", reps: "8", personalBest: pb }, { weight: "80", reps: "6", personalBest: pb }] });
  assert.deepEqual(exercise.sets[0].personalBest, pb);
});

test("workout PB summary gives one line per exercise, weight PBs first", () => {
  const weight = { type: "weight_pb", label: "Weight PB" };
  const rep = { type: "rep_pb", label: "Rep PB" };
  const pbs = workoutPersonalBests([
    { name: "Bench Press", sets: [{ weight: "80", reps: "6", personalBest: weight }, { weight: "80", reps: "8", personalBest: weight }, { weight: "75", reps: "12", personalBest: rep }] },
    { name: "Lat Pulldown", sets: [{ weight: "60", reps: "12", personalBest: rep }, { weight: "60", reps: "10", personalBest: null }] },
    { name: "Row", sets: [{ weight: "50", reps: "10" }] },
  ]);
  assert.deepEqual(pbs, [
    { exercise: "Bench Press", type: "weight_pb", label: "Weight PB", weight: 80, reps: 8 },
    { exercise: "Lat Pulldown", type: "rep_pb", label: "Rep PB", weight: 60, reps: 12 },
  ]);
});

test("improvements are only claimed when the previous workout supports them", () => {
  const exercises = [
    { name: "Bench Press", sets: [{ weight: "80", reps: "6" }] },
    { name: "Shoulder Press", sets: [{ weight: "30", reps: "10" }, { weight: "30", reps: "9" }] },
    { name: "Row", sets: [{ weight: "50", reps: "8" }] },
    { name: "Curl", sets: [{ weight: "12", reps: "12" }] },
    { name: "New Exercise", sets: [{ weight: "20", reps: "10" }] },
  ];
  const previous = [
    [{ weight: "75", reps: "8" }],
    [{ weight: "30", reps: "8" }, { weight: "30", reps: "8" }],
    [{ weight: "55", reps: "6" }],
    [{ weight: "12", reps: "12" }],
    null,
  ];
  assert.deepEqual(improvementsSinceLastTime(exercises, previous), [
    { exercise: "Bench Press", kind: "weight", delta: 5, weight: 80, previousWeight: 75 },
    { exercise: "Shoulder Press", kind: "reps", delta: 2, weight: 30 },
  ]);
});

test("weekly workout progress counts this week's real workouts plus the one just finished", () => {
  const history = [
    { id: 1, date: "2026-10-05", total_volume: 3000 },
    { id: 2, date: "2026-10-06", total_volume: 2000 },
    { id: 3, date: "2026-10-04", total_volume: 4000 },
    { id: 4, date: "2026-10-06", total_volume: 0, duration_mins: 1 },
    { id: 9, date: "2026-10-07", total_volume: 5000 },
  ];
  const sessions = [{ name: "Push", days: ["MON", "THU"] }, { name: "Pull", days: ["TUE"] }, { name: "Legs", days: ["sat"] }];
  assert.deepEqual(weeklyWorkoutProgress(history, "2026-10-07", sessions, 9), { completed: 3, planned: 4, activities: 0 });
  assert.deepEqual(weeklyWorkoutProgress([], "2026-10-07", [], null), { completed: 1, planned: 0, activities: 0 });
});

test("the stale-workout cleanup never finalises the workout in progress", () => {
  const now = Date.parse("2026-10-06T00:30:00Z");
  assert.deepEqual(activeWorkoutLogIds({ currentId: 7, now }), [7]);
  assert.deepEqual(activeWorkoutLogIds({ currentId: 7, finalised: true, now }), [], "a finished workout can be finalised");
  const draft = { activeWorkoutLogId: 7, workoutStart: Date.parse("2026-10-05T23:40:00Z") };
  assert.deepEqual(activeWorkoutLogIds({ currentId: null, draft, now }), [7], "reload after midnight keeps the draft's workout open");
  assert.deepEqual(activeWorkoutLogIds({ currentId: 7, draft, now }), [7]);
  const abandoned = { activeWorkoutLogId: 3, workoutStart: Date.parse("2026-10-03T18:00:00Z") };
  assert.deepEqual(activeWorkoutLogIds({ draft: abandoned, now }), [], "an old abandoned draft is not protected");
  assert.deepEqual(activeWorkoutLogIds({ now }), []);
});

test("an empty finished workout is not counted towards the week", () => {
  const history = [{ id: 1, date: "2026-10-05", total_volume: 3000 }];
  assert.deepEqual(weeklyWorkoutProgress(history, "2026-10-07", [], 9, { countCurrent: false }), { completed: 1, planned: 0, activities: 0 });
  assert.deepEqual(weeklyWorkoutProgress(history, "2026-10-07", [], 9), { completed: 2, planned: 0, activities: 0 });
});
