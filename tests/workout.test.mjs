import test from 'node:test';
import assert from 'node:assert/strict';
import { repRange, targetFor, normalizeExercise, estimateSession, requestedBudget, equivalentWorkout, workoutReview } from '../lib/workout.js';
import { mirrorDraft, readDraft } from '../lib/session-drafts.js';

test('legacy targets and dash variants become valid ranges, including optional sets', () => {
  for (const value of ['12-15', '12–15', '12—15', '15']) assert.deepEqual(repRange(value), [12,15]);
  const ex = normalizeExercise({ sets: 4, reps: ['15','10–12','8-10','6–8'] });
  assert.equal(targetFor(ex, 4), '6–8');
  assert.equal(targetFor({ reps: '12–15 / 8–10' }, 1), '8–10');
});
test('duration includes tempo, working sets, real rest, ramps and transitions', () => {
  const ex = { sets: 4, reps: '12–15', tempo: '3-1-1-0', rest_seconds: 120, warmup_sets: 2 };
  const short = estimateSession({ exercises: [ex] });
  assert.deepEqual(short, { minutes: 20, working: 300, rest: 360, ramp: 200, warmup: 300, transitions: 0 });
  assert(estimateSession({ exercises: Array(6).fill(ex) }).minutes > 90);
  assert(estimateSession({ exercises: [{ ...ex, sets: 3 }] }).minutes < short.minutes);
  assert(estimateSession({ exercises: [{ ...ex, rest_seconds: 180 }] }).minutes > short.minutes);
});
test('explicit time budgets override model durations, including different days', () => {
  assert.equal(requestedBudget('approximately 1 hour'), 60);
  assert.equal(requestedBudget('an hour every session'), 60);
  assert.equal(requestedBudget('1 hour 30 minutes'), 90);
  assert.equal(requestedBudget('45–60 minutes'), 60);
  assert.equal(requestedBudget('Monday 30 minutes, Wednesday 45–60, Saturday 75', ['WED']), 60);
  assert.equal(requestedBudget('Monday 30 minutes, Wednesday 45–60, Saturday 75', ['MON','SAT']), 30);
});
test('equivalent comparison excludes different workouts and the current workout', () => {
  const previous = { session_name: 'Upper A', created_at: '2026-09-01T10:00:00Z' };
  const history = [{ session_name: 'Upper A', created_at: '2026-09-10T12:00:00Z' }, { session_name: 'Upper B', created_at: '2026-09-09T12:00:00Z' }, previous];
  assert.equal(equivalentWorkout(history, { name: 'Upper A' }, Date.parse('2026-09-10T11:00:00Z')), previous);
});
test('review separates prescribed and extra sets, missing work, range achievement and progression', () => {
  const session = { exercises: [{ name: 'Press', sets: 2, reps: ['12–15','12–15'] }, { name: 'Row', sets: 3, reps: '12–15' }] };
  const previous = { exercises: [{ name: 'Press', sets: [{ reps: 12, weight: 20 }, { reps: 12, weight: 20 }] }] };
  const review = workoutReview(session, { 0: [{ reps: 15, weight: 20 }, { reps: 15, weight: 22 }, { reps: 10, weight: 22 }] }, previous);
  assert.equal(review[0].extra, 1);
  assert.equal(review[0].achieved, 2);
  assert.equal(review[0].improvements, 2);
  assert.match(review[0].advice, /next available weight/);
  assert.equal(review[1].logged, 0);
});
test('workout mirror survives reopening beyond 24 hours, isolates users, and clears explicitly', async () => {
  const storage = new Map();
  globalThis.localStorage = { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k) ?? null };
  const draft = { completedSets: { 0: [{ reps: 15, weight: 20 }] }, workoutFeedback: 'Good', view: 'complete' };
  mirrorDraft('one', 'fitness', draft);
  const now = Date.now;
  try {
    Date.now = () => now() + 7 * 86400000;
    assert.deepEqual(await readDraft('one', 'fitness'), draft);
    mirrorDraft('two', 'fitness', { completedSets: {} });
    assert.deepEqual(await readDraft('one', 'fitness'), draft);
    mirrorDraft('one', 'fitness', null);
    assert.equal(await readDraft('one', 'fitness'), null);
  } finally { Date.now = now; delete globalThis.localStorage; }
});
