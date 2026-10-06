import { describePlanChange, planChangeSummary, planNameKey } from "./plan-change.js";

function exerciseIdentity(exercise) {
  return exercise.id || exercise.programme_exercise_id || exercise.exercise_key || exercise.name;
}

export function applyCoachActionToWorkout(workout, action) {
  if (!workout || !action?.type) return workout;
  const payload = action.payload || action;
  const exercises = [...(workout.exercises || [])];

  if (action.type === "temporary_exercise_swap") {
    return {
      ...workout,
      exercises: exercises.map((exercise) => exerciseIdentity(exercise) === payload.exerciseId
        ? { ...exercise, originalExercise: exercise, id: payload.replacementExerciseId, exercise_key: payload.replacementExerciseId, name: payload.replacementExerciseName || payload.replacementExerciseId, temporary: true }
        : exercise),
      temporaryContext: { ...(workout.temporaryContext || {}), coachActionId: action.id },
    };
  }

  if (action.type === "temporary_reduce_sets") {
    return {
      ...workout,
      exercises: exercises.map((exercise) => exerciseIdentity(exercise) === payload.exerciseId ? { ...exercise, sets: payload.setCount, reps: Array.isArray(exercise.reps) ? exercise.reps.slice(0, payload.setCount) : exercise.reps, temporary: true } : exercise),
      temporaryContext: { ...(workout.temporaryContext || {}), coachActionId: action.id },
    };
  }

  if (action.type === "temporary_reorder") {
    const order = new Map(payload.exerciseIds.map((id, index) => [id, index]));
    return { ...workout, exercises: exercises.sort((a, b) => (order.get(exerciseIdentity(a)) ?? 999) - (order.get(exerciseIdentity(b)) ?? 999)), temporaryContext: { ...(workout.temporaryContext || {}), coachActionId: action.id } };
  }
  return workout;
}

export function applyCoachActionToProgramme(sessions, action) {
  if (!action?.type?.startsWith("propose_permanent_")) return sessions;
  const payload = action.payload || action;
  return sessions.map((session) => ({
    ...session,
    exercises: (session.exercises || []).map((exercise) => {
      if (exerciseIdentity(exercise) !== payload.programmeExerciseId) return exercise;
      if (action.type === "propose_permanent_set_change") {
        const reps = Array.isArray(exercise.reps) ? exercise.reps.slice(0, payload.setCount) : exercise.reps;
        return { ...exercise, sets: payload.setCount, reps };
      }
      return { ...exercise, id: payload.replacementExerciseId, exercise_key: payload.replacementExerciseId, name: payload.replacementExerciseName || payload.replacementExerciseId };
    }),
  }));
}

// Before → after for a permanent change the workout coach proposed, for the
// Proposed change card ("Push A: Bench Press → Dumbbell Press").
export function coachActionChangeLines(sessions, action) {
  const payload = action?.payload || action || {};
  const type = action?.type || action?.action_type;
  for (const session of sessions || []) {
    const exercise = (session.exercises || []).find((item) => exerciseIdentity(item) === payload.programmeExerciseId);
    if (!exercise) continue;
    if (type === "propose_permanent_set_change") return [`${session.name} · ${exercise.name}: ${exercise.sets} sets → ${payload.setCount} sets`];
    if (type === "propose_permanent_exercise_swap") return [`${session.name}: ${exercise.name} → ${payload.replacementExerciseName || payload.replacementExerciseId}`];
  }
  if (type === "propose_permanent_set_change") return [`${payload.setCount} sets from now on`];
  if (type === "propose_permanent_exercise_swap") return [`Swap to ${payload.replacementExerciseName || payload.replacementExerciseId} from now on`];
  return [payload.reason || "A change to your saved plan"];
}

// The Proposed change card for a permanent change the workout coach
// proposed: before → after lines, notes, and whether it would change the
// plan at all. Worked out when the proposal arrives, before anything is saved.
export function coachProposal(sessions, action) {
  const payload = action?.payload || action || {};
  const reason = payload.reason ? [payload.reason] : [];
  if ((action?.type || action?.action_type) !== "propose_plan_change") return { lines: coachActionChangeLines(sessions, action), notes: reason, changed: true };
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const summary = planChangeSummary(sessions || [], changes);
  return {
    lines: summary.lines.length ? summary.lines : changes.map(describePlanChange),
    notes: [...reason, ...(summary.changed && summary.unmatched.length ? [`Not in your plan, so left out: ${summary.unmatched.join("; ")}.`] : [])],
    changed: summary.changed,
  };
}

// What a proposal changes ("push-a|bench-press", "push-a|days", or "push-a|*"
// for the whole session), so a newer proposal for the same thing replaces
// one still waiting.
export function proposalTargets(action) {
  const payload = action?.payload || action || {};
  if (!Array.isArray(payload.changes)) return [String(payload.programmeExerciseId || action?.id || "")];
  return payload.changes.map((change) => {
    const part = change.kind === "remove_session" ? "*" : change.kind === "update_session_days" ? "days" : planNameKey(change.exerciseName || change.replacementName);
    return `${planNameKey(change.sessionName)}|${part}`;
  });
}

export function proposalsOverlap(a, b) {
  const sessionOf = (target) => target.split("|")[0];
  const right = proposalTargets(b);
  return proposalTargets(a).some((x) => right.some((y) => x === y || ((x.endsWith("|*") || y.endsWith("|*")) && sessionOf(x) === sessionOf(y))));
}
