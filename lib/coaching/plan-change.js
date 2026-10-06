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
  if (change.kind === "update_session_days") return `${change.sessionName}: move to ${change.days.join(" / ")}`;
  if (change.kind === "update_prescription") return `${change.sessionName}: ${change.exerciseName} → ${change.sets || "same"} sets, ${Array.isArray(change.reps) ? change.reps.join("/") : change.reps || "same reps"}`;
  if (change.kind === "replace_exercise") return `${change.sessionName}: replace ${change.exerciseName} with ${change.replacementName}`;
  if (change.kind === "rename_exercise") return `${change.sessionName}: rename ${change.exerciseName} to ${change.replacementName}`;
  if (change.kind === "remove_exercise") return `${change.sessionName}: remove ${change.exerciseName}`;
  if (change.kind === "add_exercise") return `${change.sessionName}: add ${change.replacementName}`;
  return "Plan adjustment";
}

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
