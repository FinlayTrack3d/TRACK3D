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
