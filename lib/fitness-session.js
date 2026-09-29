function key(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildLoggedExercises(activeSession, completedSets = {}) {
  return (activeSession?.exercises || []).map((exercise, exerciseIndex) => ({
    name: exercise.name,
    prescribed_sets: Number(exercise.sets) || 1,
    prescribed_reps: exercise.reps || "8-12",
    tempo: exercise.tempo || null,
    notes: exercise.notes || null,
    historyAliases: exercise.historyAliases || [],
    trainingSessionId: activeSession?.trainingSessionId || null,
    sets: (completedSets[exerciseIndex] || []).map((set, setIndex) => ({
      ...set,
      setNum: setIndex + 1,
      repRange: Array.isArray(exercise.reps) ? exercise.reps[setIndex] : exercise.reps,
    })),
    context: activeSession?.gymContext || { type: "usual", name: "" },
  }));
}

export function recoverWorkoutState(log, plannedSession) {
  if (!log) return null;
  const loggedExercises = Array.isArray(log.exercises) ? log.exercises : [];
  const plannedExercises = plannedSession?.exercises || [];
  const source = loggedExercises.length ? loggedExercises : plannedExercises;
  const exercises = source.map((logged) => {
    const planned = plannedExercises.find((exercise) => key(exercise.name) === key(logged.name));
    const loggedSets = logged.sets || [];
    const setCount = Math.max(1, Number(logged.prescribed_sets) || Number(planned?.sets) || loggedSets.length || 1);
    const reps = logged.prescribed_reps || planned?.reps || Array.from({ length: setCount }, (_, index) => loggedSets[index]?.repRange || "8-12");
    return {
      ...(planned || {}),
      name: logged.name || planned?.name || "Exercise",
      sets: setCount,
      reps,
      tempo: logged.tempo || planned?.tempo || "",
      notes: logged.notes || planned?.notes || "",
      historyAliases: logged.historyAliases || planned?.historyAliases || [],
    };
  });
  const completedSets = Object.fromEntries(exercises.map((exercise, exerciseIndex) => {
    const logged = loggedExercises.find((item) => key(item.name) === key(exercise.name));
    return [exerciseIndex, (logged?.sets || []).map((set, index) => ({ ...set, setNum: index + 1 }))];
  }));
  const firstIncomplete = exercises.findIndex((exercise, index) => (completedSets[index] || []).length < (Number(exercise.sets) || 1));
  const exerciseIdx = firstIncomplete >= 0 ? firstIncomplete : Math.max(0, exercises.length - 1);
  return {
    activeSession: {
      ...(plannedSession || {}),
      name: log.session_name || plannedSession?.name || "Workout",
      exercises,
      trainingSessionId: loggedExercises.find((exercise) => exercise.trainingSessionId)?.trainingSessionId || null,
      gymContext: loggedExercises.find((exercise) => exercise.context)?.context || { type: "usual", name: "" },
    },
    completedSets,
    setProgress: Object.fromEntries(exercises.map((_, index) => [index, (completedSets[index] || []).length])),
    exerciseIdx,
    workoutStart: Date.parse(log.created_at || `${log.date}T12:00:00Z`) || Date.now(),
    workoutLogId: log.id,
  };
}

export function workoutVolume(exercises = []) {
  return exercises.reduce((total, exercise) => total + (exercise.sets || []).reduce((sum, set) => sum + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0), 0);
}

export function moveWorkoutDay(sessions = [], sessionName, sourceDay, targetDay) {
  if (!sessionName || !sourceDay || !targetDay || sourceDay === targetDay) return sessions;
  const movingIndex = sessions.findIndex((session) => session.name === sessionName && (session.days || []).includes(sourceDay));
  if (movingIndex < 0) return sessions;
  const targetIndex = sessions.findIndex((session) => (session.days || []).includes(targetDay));
  return sessions.map((session, index) => {
    if (index === movingIndex) return { ...session, days: [...new Set((session.days || []).map((day) => day === sourceDay ? targetDay : day))], approval: null };
    if (index === targetIndex) return { ...session, days: [...new Set((session.days || []).map((day) => day === targetDay ? sourceDay : day))], approval: null };
    return session;
  });
}
