import { repTargets, splitRepTargets } from "../workout.js";

function key(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// One rep target per set, also when the coach lists them in one string.
function repArray(value, setCount, fallback = "8-12") {
  return repTargets(value, setCount, splitRepTargets(fallback).at(-1) || "8-12");
}

function matches(value, expected) {
  return key(value) === key(expected);
}

// Session and exercise names compared ignoring case and punctuation.
export const planNameKey = key;

export function exerciseHistoryNames(exercise) {
  if (typeof exercise === "string") return [exercise];
  return [exercise?.name, ...(exercise?.historyAliases || [])].filter(Boolean);
}

// Names that are the same exercise worded differently, so its history (last
// weight, progression) carries across: "DB Goblet Squats", "Dumbbell Goblet
// Squat" and "Goblet Squat". An equipment word on one side only still
// matches ("Goblet Squat" is done with a dumbbell), but different equipment
// on both sides does not ("Barbell Row" is not "Dumbbell Row").
const ABBREVIATIONS = { db: "dumbbell", dbs: "dumbbell", bb: "barbell", kb: "kettlebell" };
const EQUIPMENT = new Set(["dumbbell", "barbell", "kettlebell", "cable", "machine", "smith"]);
const singular = (word) => (word.endsWith("sses") ? word.slice(0, -2) : word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const nameWords = (value) => key(value).split("-").filter(Boolean).map((word, index, words) => {
  const full = ABBREVIATIONS[word] || word;
  return index === words.length - 1 || EQUIPMENT.has(singular(full)) ? singular(full) : full;
});

export function sameExerciseName(a, b) {
  const left = nameWords(a);
  const right = nameWords(b);
  if (!left.length || !right.length) return false;
  if (left.join(" ") === right.join(" ")) return true;
  const bare = (words) => words.filter((word) => !EQUIPMENT.has(word));
  const leftBare = bare(left);
  const rightBare = bare(right);
  const leftHasEquipment = leftBare.length !== left.length;
  const rightHasEquipment = rightBare.length !== right.length;
  return leftHasEquipment !== rightHasEquipment && leftBare.length > 0 && leftBare.join(" ") === rightBare.join(" ");
}

export function exerciseMatchesHistory(exercise, historicalName) {
  return exerciseHistoryNames(exercise).some((name) => sameExerciseName(name, historicalName));
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

    // The session leaves the plan; its days become rest days. Workouts
    // already logged under its name stay in history.
    if (change.kind === "remove_session") {
      updated = updated.filter((_, index) => index !== sessionIndex);
      continue;
    }

    if (change.kind === "update_session_days" && Array.isArray(change.days) && change.days.length) {
      // The user approved this change itself, so the session keeps its approval
      // and 8-week commitment instead of needing the whole plan re-approved.
      updated[sessionIndex] = { ...session, days: [...new Set(change.days)] };
      continue;
    }

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

    if (changed) updated[sessionIndex] = { ...session, exercises };
  }

  return updated;
}

export function describePlanChange(change) {
  if (change.kind === "remove_session") return `${change.sessionName}: remove from your plan`;
  if (change.kind === "update_session_days") return `${change.sessionName}: move to ${change.days.join(" / ")}`;
  if (change.kind === "update_prescription") return `${change.sessionName}: ${change.exerciseName} → ${change.sets || "same"} sets, ${Array.isArray(change.reps) ? change.reps.join("/") : change.reps || "same reps"}`;
  if (change.kind === "replace_exercise") return `${change.sessionName}: replace ${change.exerciseName} with ${change.replacementName}`;
  if (change.kind === "rename_exercise") return `${change.sessionName}: rename ${change.exerciseName} to ${change.replacementName}`;
  if (change.kind === "remove_exercise") return `${change.sessionName}: remove ${change.exerciseName}`;
  if (change.kind === "add_exercise") return `${change.sessionName}: add ${change.replacementName}`;
  return "Plan adjustment";
}

const WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const dayCode = (day) => String(day || "").trim().toUpperCase().slice(0, 3);
const sessionsOn = (sessions, day) => (sessions || []).filter((session) => (session.days || []).some((value) => dayCode(value) === day)).map((session) => session.name);

// "4 × 8-10", or "4 × 6-8/6-8/8/10" when the sets differ.
function prescriptionText(exercise) {
  if (!exercise) return "";
  const reps = Array.isArray(exercise.reps) ? exercise.reps.map(String) : splitRepTargets(exercise.reps);
  const sets = Number(exercise.sets) || reps.length;
  const repText = new Set(reps).size > 1 ? reps.join("/") : reps[0] || "";
  return [sets ? `${sets} ×` : "", repText].filter(Boolean).join(" ");
}

// What a proposal would change, as before → after lines for the approval
// card: days first ("FRI: Full Body Pump → Rest"), then exercises ("Push A ·
// Bench Press: 4 × 8-10 → 3 × 8-10"). unmatched describes changes naming a
// session or exercise the plan doesn't have (they would do nothing);
// changed is false when nothing in the plan would change.
export function planChangeSummary(sessions = [], changes = []) {
  const after = applyPlanChangeProposal(sessions, changes);
  const lines = [];
  for (const day of WEEK) {
    const before = sessionsOn(sessions, day);
    const now = sessionsOn(after, day);
    if (before.join("|") !== now.join("|")) lines.push(`${day}: ${before.join(" + ") || "Rest"} → ${now.join(" + ") || "Rest"}`);
  }
  const unmatched = [];
  for (const change of changes) {
    const session = sessions.find((item) => matches(item.name, change.sessionName));
    if (!session) { unmatched.push(describePlanChange(change)); continue; }
    if (change.kind === "update_session_days") continue;
    if (change.kind === "remove_session") {
      if (!(session.days || []).length) lines.push(`${session.name}: removed from your plan`);
      continue;
    }
    // This change on its own, so earlier changes can't shift the exercises.
    const changedSession = applyPlanChangeProposal([session], [change])[0];
    if (change.kind === "add_exercise") {
      lines.push(`${session.name}: + ${change.replacementName} ${prescriptionText(changedSession.exercises.at(-1))}`.trim());
      continue;
    }
    const index = (session.exercises || []).findIndex((exercise) => matches(exercise.name, change.exerciseName));
    if (index < 0) { unmatched.push(describePlanChange(change)); continue; }
    const exercise = session.exercises[index];
    const next = changedSession.exercises[index];
    if (change.kind === "remove_exercise") lines.push(`${session.name}: ${exercise.name} ${prescriptionText(exercise)} → removed`);
    else if (change.kind === "rename_exercise") lines.push(`${session.name}: ${exercise.name} → ${next.name} (same exercise, history kept)`);
    else if (change.kind === "replace_exercise") lines.push(`${session.name}: ${exercise.name} ${prescriptionText(exercise)} → ${next.name} ${prescriptionText(next)}`);
    else if (change.kind === "update_prescription" && prescriptionText(exercise) !== prescriptionText(next)) lines.push(`${session.name} · ${exercise.name}: ${prescriptionText(exercise)} → ${prescriptionText(next)}`);
  }
  return { lines, unmatched, changed: JSON.stringify(after) !== JSON.stringify(sessions) };
}

// The saved plan in brief (sessions, days, exercises and prescriptions), so
// the workout coach can propose changes by exact name.
export function planOutline(sessions = []) {
  return (sessions || []).map((session) => ({
    name: session.name,
    days: session.days || [],
    exercises: (session.exercises || []).map((exercise) => ({ name: exercise.name, prescription: prescriptionText(exercise) })),
  }));
}

// An approved plan change, applied to the workout in progress where it
// changes today's session. Logged sets are never lost: an exercise with
// logged sets stays in today's workout (removing or replacing it starts next
// time), set counts never drop below the sets already logged, and what is
// kept for each exercise by position (logged sets, set progress, typed
// numbers) moves with it. state: { workout, exerciseIdx, setProgress,
// completedSets, currentInputs }. Returns the new state, whether the workout
// changed, and notes on what stays as it is today.
export function applyPlanChangeToWorkout(state = {}, changes = []) {
  const workout = state.workout;
  if (!workout?.exercises?.length) return { ...state, changed: false, notes: [] };
  const items = workout.exercises.map((exercise, index) => ({
    exercise,
    logged: state.completedSets?.[index],
    progress: state.setProgress?.[index],
    inputs: state.currentInputs?.[index],
    current: index === state.exerciseIdx,
  }));
  const notes = [];
  for (const change of changes) {
    if (!matches(workout.name, change.sessionName) || change.kind === "update_session_days") continue;
    if (change.kind === "remove_session") {
      notes.push(`Today's ${workout.name} carries on as it is.`);
      continue;
    }
    if (change.kind === "add_exercise") {
      const added = applyPlanChangeProposal([{ name: workout.name, exercises: [] }], [change])[0].exercises[0];
      if (added) items.push({ exercise: added });
      continue;
    }
    const item = items.find((entry) => !entry.removed && matches(entry.exercise.name, change.exerciseName));
    if (!item) continue;
    const logged = (item.logged || []).length;
    if ((change.kind === "remove_exercise" || change.kind === "replace_exercise") && logged) {
      notes.push(`${item.exercise.name} stays in today's workout because you've logged sets on it.`);
      continue;
    }
    if (change.kind === "remove_exercise") {
      // A workout always keeps at least one exercise.
      if (items.filter((entry) => !entry.removed).length > 1) item.removed = true;
      continue;
    }
    const next = applyPlanChangeProposal([{ name: workout.name, exercises: [item.exercise] }], [change])[0].exercises[0];
    if (change.kind === "replace_exercise") {
      // A different exercise: numbers typed for the old one don't carry over.
      Object.assign(item, { exercise: next, inputs: undefined });
      continue;
    }
    const sets = Math.max(Number(next.sets) || 1, logged);
    item.exercise = { ...next, sets, reps: repArray(next.reps, sets) };
  }
  const kept = items.filter((entry) => !entry.removed);
  // The exercise being done stays current; if it was removed, the next one
  // still in the workout is.
  const currentAt = items.findIndex((entry) => entry.current);
  let exerciseIdx = kept.findIndex((entry) => entry.current);
  if (exerciseIdx < 0) exerciseIdx = Math.min(items.slice(0, Math.max(0, currentAt)).filter((entry) => !entry.removed).length, kept.length - 1);
  const byPosition = (field) => Object.fromEntries(kept.flatMap((entry, index) => (entry[field] === undefined ? [] : [[index, entry[field]]])));
  const exercises = kept.map((entry) => entry.exercise);
  return {
    workout: { ...workout, exercises },
    exerciseIdx: Math.max(0, exerciseIdx),
    setProgress: byPosition("progress"),
    completedSets: byPosition("logged"),
    currentInputs: byPosition("inputs"),
    changed: JSON.stringify(exercises) !== JSON.stringify(workout.exercises),
    notes: [...new Set(notes)],
  };
}

// "I approve", "approve", "yes, save it", "go ahead": approving in words.
// Only the Proposed change card saves, so these get pointed to it.
const APPROVAL_REPLY = /^\s*(?:(?:yes|ok|okay)[,!.\s]+)?(?:i\s+)?(?:approve[sd]?|confirm(?:ed)?|accept(?:ed)?)\b|^\s*(?:(?:yes|ok|okay)[,!.\s]+)?(?:please\s+)?(?:save|apply)\s+(?:it|this|that|them|the\s+changes?|my\s+plan)\b|^\s*(?:(?:yes|ok|okay)[,!.\s]+)?(?:go\s+ahead|do\s+it)\b/i;
export const isApprovalReply = (message = "") => String(message).length <= 80 && APPROVAL_REPLY.test(String(message));

// True for messages asking to change the saved plan (sets, reps, exercises,
// sessions or days), which must go through the approve-and-save flow.
// Questions about the plan ("Why do I have 4 sets of squats?", "Should I
// add a day?") are answered by the coach. Only requests to change it ("Change
// Row to 3 sets", "Can you move Pull A to Thursday?") go to Change Plan.
const QUESTION_START = /^\s*(why|what|what's|whats|how|should|shall|is|are|was|were|does|do|did|would|when|which|who|where|isn't|aren't|any)\b/i;
const REQUEST_START = /^\s*((can|could|will|would)\s+(you|i|we)\b|please\b|i\s+want\b|i'd\s+like\b|i\s+would\s+like\b|let'?s\b)/i;

export function isPlanChangeRequest(message = "") {
  const text = String(message);
  if (QUESTION_START.test(text) && !REQUEST_START.test(text)) return false;
  if (/\b(rebuild|redo|redesign|shorten|lengthen)\b[\s\S]*\b(plan|programme|program|split|sessions?|workouts?|push|pull|legs|upper|lower|full body|minutes|mins)\b/i.test(text)) return true;
  return /\b(change|swap|replace|remove|drop|delete|add|move|reduce|increase|decrease|cut|switch|lower|raise)\b[\s\S]*\b(sets?|reps?|exercises?|sessions?|days?|plan|programme|program|workout|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\bfrom\s+\d+\s+(sets?|reps?)\s+to\s+\d+/i.test(text);
}
