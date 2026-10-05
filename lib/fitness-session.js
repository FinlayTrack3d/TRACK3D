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

export function buildWorkoutReview(activeSession, completedSets = {}) {
  const exercises = (activeSession?.exercises || []).map((exercise, exerciseIndex) => {
    const loggedSets = completedSets[exerciseIndex] || [];
    const prescribedSets = Math.max(0, Number(exercise.sets) || 0);
    const setCount = Math.max(prescribedSets, loggedSets.length);
    const sets = Array.from({ length: setCount }, (_, setIndex) => {
      const logged = loggedSets[setIndex];
      const repTarget = Array.isArray(exercise.reps) ? exercise.reps[setIndex] : exercise.reps;
      return logged
        ? { setNumber: setIndex + 1, status: "completed", reps: Number(logged.reps) || 0, weightKg: Number(logged.weight) || 0, targetReps: repTarget || null, extra: setIndex >= prescribedSets || Boolean(logged.extra) }
        : { setNumber: setIndex + 1, status: "skipped", reps: null, weightKg: null, targetReps: repTarget || null, extra: false };
    });
    const completedCount = sets.filter(set => set.status === "completed").length;
    return {
      name: exercise.name,
      prescribedSets,
      completedSets: completedCount,
      skippedSets: Math.max(0, prescribedSets - Math.min(prescribedSets, completedCount)),
      sets,
    };
  });
  return {
    sessionName: activeSession?.name || "Workout",
    prescribedSets: exercises.reduce((total, exercise) => total + exercise.prescribedSets, 0),
    completedSets: exercises.reduce((total, exercise) => total + exercise.completedSets, 0),
    skippedSets: exercises.reduce((total, exercise) => total + exercise.skippedSets, 0),
    totalVolumeKg: workoutVolume(buildLoggedExercises(activeSession, completedSets)),
    exercises,
  };
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

function formatSetForCoach(set, setIndex, target) {
  const targetText = target ? ` (target ${target})` : "";
  if (!set || !(Number(set.reps) > 0)) return `S${setIndex + 1} skipped${targetText}`;
  const weight = Number(set.weight) > 0 ? `${Number(set.weight)}kg` : "bodyweight";
  return `S${setIndex + 1} ${Number(set.reps)} × ${weight}${targetText}`;
}

// One logged workout as plain text with every set (reps × weight against its
// rep target), so a coach can reason about loads rather than session totals.
export function summariseWorkoutForCoach(log) {
  const header = `${log?.date || "Unknown date"} · ${log?.session_name || "Workout"} · ${Number(log?.duration_mins) || 0} min`;
  const exercises = (Array.isArray(log?.exercises) ? log.exercises : []).map((exercise) => {
    const sets = exercise.sets || [];
    const prescribedSets = Number(exercise.prescribed_sets) || 0;
    const count = Math.max(prescribedSets, sets.length);
    const targetFor = (setIndex) => sets[setIndex]?.repRange
      || (Array.isArray(exercise.prescribed_reps) ? exercise.prescribed_reps[setIndex] : exercise.prescribed_reps)
      || null;
    const setText = Array.from({ length: count }, (_, setIndex) => formatSetForCoach(sets[setIndex], setIndex, targetFor(setIndex)));
    return `- ${exercise.name || "Exercise"}: ${setText.join("; ") || "no sets logged"}`;
  });
  return [header, ...exercises].join("\n");
}

// Recent workouts grouped by session name (newest first) so the coach only
// ever compares a session with earlier sessions of the same name.
export function recentWorkoutsForCoach(history = [], { perSession = 3, maxSessions = 6 } = {}) {
  const groups = new Map();
  for (const log of history) {
    const name = String(log?.session_name || "Workout").trim();
    const groupKey = name.toLowerCase();
    if (!groups.has(groupKey)) {
      if (groups.size >= maxSessions) continue;
      groups.set(groupKey, { name, logs: [] });
    }
    const group = groups.get(groupKey);
    if (group.logs.length < perSession) group.logs.push(log);
  }
  if (!groups.size) return "No completed workouts yet.";
  return [...groups.values()]
    .map((group) => `SESSION "${group.name}" (newest first)\n${group.logs.map(summariseWorkoutForCoach).join("\n")}`)
    .join("\n\n");
}

// Compare JSON values ignoring object key order (Postgres jsonb reorders keys).
export function sameJson(a, b) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => [key, stable(value[key])]));
    return value;
  };
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function numericSets(sets = []) {
  return sets
    .map((set) => ({ ...set, weight: Number(set.weight), reps: Number(set.reps) }))
    .filter((set) => Number.isFinite(set.weight) && Number.isFinite(set.reps) && set.reps > 0);
}

const roundKg = (value) => Math.round(value * 100) / 100;

// One line per exercise from the PB flags saved on each set when it was
// logged (detectPersonalBest). A weight PB outranks a rep PB.
export function workoutPersonalBests(exercises = []) {
  return exercises.flatMap((exercise) => {
    const flagged = numericSets(exercise.sets).filter((set) => set.personalBest?.type);
    const weightPbs = flagged.filter((set) => set.personalBest.type === "weight_pb");
    const repPbs = flagged.filter((set) => set.personalBest.type === "rep_pb");
    const pick = weightPbs.length ? weightPbs : repPbs;
    if (!pick.length) return [];
    const best = pick.reduce((top, set) => (set.weight > top.weight || (set.weight === top.weight && set.reps > top.reps) ? set : top));
    return [{
      exercise: exercise.name,
      type: weightPbs.length ? "weight_pb" : "rep_pb",
      label: weightPbs.length ? "Weight PB" : "Rep PB",
      weight: best.weight,
      reps: best.reps,
    }];
  });
}

// Compares each exercise with the previous time it was done. Only claims an
// improvement the numbers show: a heavier top set, or more reps at the same
// top weight. previousSets[i] holds the last sets for exercises[i], or null.
export function improvementsSinceLastTime(exercises = [], previousSets = []) {
  return exercises.flatMap((exercise, index) => {
    const current = numericSets(exercise.sets);
    const previous = numericSets(previousSets[index] || []);
    if (!current.length || !previous.length) return [];
    const currentTop = Math.max(...current.map((set) => set.weight));
    const previousTop = Math.max(...previous.map((set) => set.weight));
    if (currentTop > previousTop) {
      return [{ exercise: exercise.name, kind: "weight", delta: roundKg(currentTop - previousTop), weight: currentTop, previousWeight: previousTop }];
    }
    if (currentTop === previousTop) {
      const currentReps = Math.max(...current.filter((set) => set.weight === currentTop).map((set) => set.reps));
      const previousReps = Math.max(...previous.filter((set) => set.weight === previousTop).map((set) => set.reps));
      if (currentReps > previousReps) return [{ exercise: exercise.name, kind: "reps", delta: currentReps - previousReps, weight: currentTop }];
    }
    return [];
  });
}

function weekStartKey(todayKey) {
  const date = new Date(`${todayKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

// Workouts finished this week (Monday to Sunday, home timezone) against the
// number of training days in the plan. Workouts abandoned straight after
// starting (nothing lifted, under 2 minutes) do not count. The workout that
// has just finished is always counted once, whether or not the history list
// has been reloaded yet (its id is passed as currentLogId).
export function weeklyWorkoutProgress(history = [], todayKey, sessions = [], currentLogId = null) {
  const start = weekStartKey(todayKey);
  const real = (log) => Number(log.total_volume) > 0 || (Number(log.duration_mins) || 0) >= 2;
  const earlier = history.filter((log) => log.id !== currentLogId && log.date >= start && log.date <= todayKey && real(log)).length;
  const planned = new Set(sessions.flatMap((session) => (session.days || []).map((day) => String(day).toUpperCase()))).size;
  return { completed: earlier + 1, planned };
}
