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
    if (exercise?.activity) return `- ${exercise.name || "Activity"}: ${activitySummary({ ...log, exercises: [exercise] }) || "activity"}`;
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
// has just finished is counted once, whether or not the history list has
// been reloaded yet (its id is passed as currentLogId), unless countCurrent
// is false because nothing was logged in it.
export function weeklyWorkoutProgress(history = [], todayKey, sessions = [], currentLogId = null, { countCurrent = true } = {}) {
  const start = weekStartKey(todayKey);
  const real = (log) => Number(log.total_volume) > 0 || (Number(log.duration_mins) || 0) >= 2;
  const earlier = history.filter((log) => log.id !== currentLogId && log.date >= start && log.date <= todayKey && real(log)).length;
  const planned = new Set(sessions.flatMap((session) => (session.days || []).map((day) => String(day).toUpperCase()))).size;
  return { completed: earlier + (countCurrent ? 1 : 0), planned };
}

// Workout log ids that must not be finalised by the stale-workout cleanup:
// the workout open on screen and one saved in the local draft (a reload
// mid-session). Both may have started before midnight. A draft older than
// maxDraftAgeMs is an abandoned session and is not protected.
export function activeWorkoutLogIds({ currentId = null, finalised = false, draft = null, now = Date.now(), maxDraftAgeMs = 12 * 60 * 60 * 1000 } = {}) {
  const draftFresh = draft?.activeWorkoutLogId && Number(draft.workoutStart) > 0 && now - Number(draft.workoutStart) < maxDraftAgeMs;
  return [...new Set([finalised ? null : currentId, draftFresh ? draft.activeWorkoutLogId : null].filter((id) => id !== null && id !== undefined && id !== ""))];
}

// One line per exercise with its best completed set (heaviest, then most
// reps), for coaches that need to know what was lifted.
export function bestSetsSummary(exercises = []) {
  return exercises.flatMap((exercise) => {
    const sets = numericSets(exercise.sets);
    if (!sets.length) return [];
    const best = sets.reduce((top, set) => (set.weight > top.weight || (set.weight === top.weight && set.reps > top.reps) ? set : top));
    return [`${exercise.name}: ${sets.length} set${sets.length === 1 ? "" : "s"}, best ${best.weight}kg × ${best.reps}`];
  });
}

// One short "sets × reps" line for a planned exercise, e.g. "3 × 8–10".
// Different targets per set are shown as one range ("4 × 6–12") rather
// than set by set; reps that are not numbers ("AMRAP", "30s") are kept.
export function setsRepsSummary(exercise = {}) {
  const raw = Array.isArray(exercise?.reps) ? exercise.reps : String(exercise?.reps ?? "").split(/[/,]/);
  const reps = raw.map(value => String(value ?? "").trim()).filter(Boolean).map(value => value.replace(/\s*-\s*/g, "–"));
  const sets = Math.max(0, parseInt(exercise?.sets, 10) || reps.length || 0);
  const unique = [...new Set(reps)];
  let repText = unique.length === 1 ? unique[0] : "";
  if (unique.length > 1) {
    const numeric = unique.every(value => /^\d+(–\d+)?$/.test(value));
    const numbers = unique.flatMap(value => (value.match(/\d+/g) || []).map(Number));
    repText = numeric ? (Math.min(...numbers) === Math.max(...numbers) ? String(numbers[0]) : `${Math.min(...numbers)}–${Math.max(...numbers)}`) : "varied reps";
  }
  if (!sets) return repText ? (/^\d/.test(repText) ? `${repText} reps` : repText) : "";
  if (!repText) return `${sets} set${sets === 1 ? "" : "s"}`;
  return repText === "varied reps" ? `${sets} sets · varied reps` : `${sets} × ${repText}`;
}

// The logged sets of a workout, ignoring bookkeeping (set numbers, rep
// ranges) and key order, so an autosave can tell whether anything changed
// compared with what the server already has.
export function loggedSetsSignature(exercises = []) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).filter(name => value[name] !== undefined).sort().map(name => [name, stable(value[name])]));
    return value;
  };
  return JSON.stringify((Array.isArray(exercises) ? exercises : [])
    .map(exercise => [key(exercise?.name), (exercise?.sets || []).map(({ setNum: _setNum, repRange: _repRange, ...set }) => stable(set))])
    .filter(([, sets]) => sets.length));
}

// An unfinished workout from an earlier day counts as finished when shown,
// so nothing has to be written just to open the app.
export const isFinishedWorkout = (log, todayKey) => Boolean(log) && (!log.in_progress || (Boolean(todayKey) && String(log.date || "") < todayKey));

// Starting values for the set logger, so most sets are one tap on LOG SET.
// Weight: the set just logged, else the progression suggestion, else last
// session's weight. Reps: last time's reps at the same weight, kept inside
// today's target range, else the bottom of the range (also when the weight
// has gone up). Anything the user typed wins over these.
export function setLoggerDefaults({ repRange = "", previousSet = null, lastSet = null, suggestedWeight = null } = {}) {
  const positive = value => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; };
  const numbers = String(repRange || "").match(/\d+/g)?.map(Number) || [];
  const low = numbers.length ? numbers[0] : null;
  const high = numbers.length ? numbers.at(-1) : null;
  const weight = positive(previousSet?.weight) ?? positive(suggestedWeight) ?? positive(lastSet?.weight);
  let reps = null;
  if (low !== null) {
    const lastReps = positive(lastSet?.reps);
    const sameWeight = weight !== null && positive(lastSet?.weight) === weight;
    reps = lastReps !== null && sameWeight ? Math.min(high, Math.max(low, lastReps)) : low;
  }
  return { weight: weight === null ? "" : String(weight), reps: reps === null ? "" : String(reps) };
}

// One tap on − or + in the set logger: ±1 rep or ±2.5 kg, never below 0.
export function stepSetValue(value, delta) {
  const next = Math.max(0, (Number(value) || 0) + delta);
  return String(Math.round(next * 100) / 100);
}

// The session planned for a day (MON..SUN); days may be saved as "MON" or "MONDAY".
export function sessionForDay(sessions = [], dayCode = "") {
  const code = String(dayCode).toUpperCase().slice(0, 3);
  return (sessions || []).find(session => (session.days || []).some(day => String(day).toUpperCase().slice(0, 3) === code)) || null;
}

// A planned session's length in minutes, the same everywhere it is shown:
// the length saved with the session, otherwise about 3 minutes a set plus
// 5 minutes to warm up.
export function sessionPlannedMinutes(session = {}) {
  const saved = Number(session?.duration_mins);
  if (saved > 0) return Math.round(saved);
  const sets = (session?.exercises || []).reduce((total, exercise) => total + (Number(exercise.sets) || 0), 0);
  return sets ? 5 + sets * 3 : 0;
}

// Other activities (running, HYROX, ...): logged with a duration and an
// effort, and they can sit in the weekly plan like a workout.
export const ACTIVITY_TYPES = [
  { id: "run", label: "Run", distance: true },
  { id: "hyrox", label: "HYROX", distance: false },
  { id: "cycle", label: "Cycle", distance: true },
  { id: "swim", label: "Swim", distance: true },
  { id: "walk", label: "Walk", distance: true },
  { id: "sport", label: "Sport", distance: false },
  { id: "other", label: "Other", distance: false },
];
export const ACTIVITY_EFFORTS = [
  { id: "easy", label: "Easy" },
  { id: "moderate", label: "Moderate" },
  { id: "hard", label: "Hard" },
  { id: "max", label: "All-out" },
];
export const activityTypeLabel = type => ACTIVITY_TYPES.find(item => item.id === type)?.label || "Activity";
export const isActivitySession = session => session?.kind === "activity";

// A weekly plan entry for an activity on the given days.
export function activitySession({ type = "other", name = "", days = [], minutes = 30 } = {}) {
  return {
    name: String(name || "").trim() || activityTypeLabel(type),
    kind: "activity",
    activityType: type,
    days: [...new Set(days.map(day => String(day).toUpperCase().slice(0, 3)))],
    duration_mins: Math.max(1, Math.round(Number(minutes) || 30)),
    exercises: [],
    approval: { approved: true },
  };
}

// The workout_logs row for a logged activity. The details sit in the
// exercises column, so no new column is needed.
export function activityLogRow({ userId, date, type = "other", name = "", minutes, effort = "moderate", distanceKm = null, notes = "" } = {}) {
  const title = String(name || "").trim() || activityTypeLabel(type);
  const distance = Number(distanceKm) > 0 ? Math.round(Number(distanceKm) * 100) / 100 : null;
  return {
    user_id: userId,
    date,
    session_name: title,
    exercises: [{ name: title, activity: { type, effort, distanceKm: distance, notes: String(notes || "").trim() }, sets: [] }],
    total_volume: 0,
    duration_mins: Math.max(1, Math.round(Number(minutes) || 0)),
    in_progress: false,
  };
}

// The activity a workout_logs row records, or null for a gym workout.
export function activityOfLog(log) {
  const exercise = (Array.isArray(log?.exercises) ? log.exercises : []).find(item => item?.activity);
  return exercise ? { name: exercise.name || log.session_name, ...exercise.activity } : null;
}

// "45 min · Hard · 5 km" for a logged activity, or "" for a gym workout.
export function activitySummary(log) {
  const activity = activityOfLog(log);
  if (!activity) return "";
  return [
    Number(log?.duration_mins) > 0 && `${Number(log.duration_mins)} min`,
    ACTIVITY_EFFORTS.find(item => item.id === activity.effort)?.label,
    Number(activity.distanceKm) > 0 && `${Number(activity.distanceKm)} km`,
  ].filter(Boolean).join(" · ");
}
