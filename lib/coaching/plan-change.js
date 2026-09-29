function key(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function repArray(value, setCount, fallback = "8-12") {
  const supplied = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "").split("/").map((item) => item.trim()).filter(Boolean);
  const last = supplied.at(-1) || fallback;
  return Array.from({ length: setCount }, (_, index) => supplied[index] || last);
}

function matches(value, expected) {
  return key(value) === key(expected);
}

export function exerciseHistoryNames(exercise) {
  if (typeof exercise === "string") return [exercise];
  return [exercise?.name, ...(exercise?.historyAliases || [])].filter(Boolean);
}

export function exerciseMatchesHistory(exercise, historicalName) {
  const historicalKey = key(historicalName);
  return exerciseHistoryNames(exercise).some((name) => key(name) === historicalKey);
}

export function applyPlanChangeProposal(sessions = [], changes = []) {
  let updated = structuredClone(sessions);

  for (const change of changes) {
    const sessionIndex = updated.findIndex((session) => matches(session.name, change.sessionName));
    if (sessionIndex < 0) continue;
    const session = updated[sessionIndex];
    const exercises = [...(session.exercises || [])];
    const exerciseIndex = exercises.findIndex((exercise) => matches(exercise.name, change.exerciseName));
    let changed = false;

    if (change.kind === "update_prescription" && exerciseIndex >= 0) {
      const exercise = exercises[exerciseIndex];
      const sets = Math.max(1, Math.min(10, Number(change.sets) || Number(exercise.sets) || 1));
      exercises[exerciseIndex] = {
        ...exercise,
        sets,
        reps: repArray(change.reps ?? exercise.reps, sets, Array.isArray(exercise.reps) ? exercise.reps.at(-1) : exercise.reps),
      };
      changed = true;
    }

    if (change.kind === "replace_exercise" && exerciseIndex >= 0 && change.replacementName) {
      const exercise = exercises[exerciseIndex];
      const sets = Math.max(1, Math.min(10, Number(change.sets) || Number(exercise.sets) || 1));
      exercises[exerciseIndex] = {
        ...exercise,
        name: change.replacementName,
        sets,
        reps: repArray(change.reps ?? exercise.reps, sets, Array.isArray(exercise.reps) ? exercise.reps.at(-1) : exercise.reps),
        tempo: change.tempo || exercise.tempo,
      };
      changed = true;
    }

    if (change.kind === "rename_exercise" && exerciseIndex >= 0 && change.replacementName) {
      const exercise = exercises[exerciseIndex];
      exercises[exerciseIndex] = {
        ...exercise,
        name: change.replacementName,
        historyAliases: [...new Set([...(exercise.historyAliases || []), exercise.name])],
      };
      changed = true;
    }

    if (change.kind === "remove_exercise" && exerciseIndex >= 0) {
      exercises.splice(exerciseIndex, 1);
      changed = true;
    }

    if (change.kind === "add_exercise" && change.replacementName) {
      const sets = Math.max(1, Math.min(10, Number(change.sets) || 3));
      exercises.push({
        name: change.replacementName,
        sets,
        reps: repArray(change.reps, sets),
        tempo: change.tempo || "3-0-1-0",
      });
      changed = true;
    }

    if (changed) updated[sessionIndex] = { ...session, exercises, approval: null };
  }

  return updated;
}

export function describePlanChange(change) {
  if (change.kind === "update_prescription") return `${change.sessionName}: ${change.exerciseName} → ${change.sets || "same"} sets, ${Array.isArray(change.reps) ? change.reps.join("/") : change.reps || "same reps"}`;
  if (change.kind === "replace_exercise") return `${change.sessionName}: replace ${change.exerciseName} with ${change.replacementName}`;
  if (change.kind === "rename_exercise") return `${change.sessionName}: rename ${change.exerciseName} to ${change.replacementName}`;
  if (change.kind === "remove_exercise") return `${change.sessionName}: remove ${change.exerciseName}`;
  if (change.kind === "add_exercise") return `${change.sessionName}: add ${change.replacementName}`;
  return "Plan adjustment";
}
