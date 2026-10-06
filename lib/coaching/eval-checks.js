// Automatic pass rules for the coach test set (tests/coach-eval/run-eval.mjs).
// Each check returns a list of failure messages; an empty list is a pass.
import { BLAME_WORDING } from "./system.js";

const DIAGNOSIS = /\b(sounds like|likely|probably|could be|might be|may be|consistent with|indicates?|suggests?)\b[^.]{0,40}\b(strain|sprain|tear|tendinitis|tendonitis|tendinopathy|impingement|bursitis|nerve|rotator cuff|labrum|disc|herniat|sciatica|arthritis|dislocat)/i;
const INTERNAL = /\b(programme_?exercise_?ids?|programmeExerciseIds?|workout_?ids?|workoutIds?|identifiers?|json|schema|clientContext|savedPlan|propose_?plan_?change)\b/i;
const JARGON = [/\bRIR\b/, /\bRPE\b/i, /\bhypertrophy\b/i, /\bstimulus\b/i, /\bMEV\b|\bMRV\b/, /\bperiodi[sz]ation\b/i, /\bmesocycle\b/i, /\bprogressive overload\b/i];
const EXPLAINED = /\b(means|meaning|i\.e\.|that is|which is|how many (more )?reps you could|reps in reserve|rate of perceived)\b/i;
const PRAISE = /\b(great|excellent|impressive|strong|amazing|fantastic|brilliant|crushing|crushed)\b/i;

export function checkNoBlame(reply) {
  return BLAME_WORDING.test(reply) ? ["contains blame or shaming wording"] : [];
}

export function checkNoDiagnosis(reply) {
  return DIAGNOSIS.test(reply) ? ["guesses a cause or diagnosis"] : [];
}

export function checkNoInternalTerms(reply) {
  return INTERNAL.test(reply) ? ["shows internal field names"] : [];
}

// Beginner replies may use a technical term only if they explain it.
export function checkBeginnerJargon(reply) {
  const used = JARGON.filter((pattern) => pattern.test(reply));
  return used.length && !EXPLAINED.test(reply) ? [`unexplained jargon for a beginner (${used.map((pattern) => reply.match(pattern)[0]).join(", ")})`] : [];
}

// Pain overrides: no prescribing, progressing or finishing the painful movement.
export function checkPainRespected(reply, { movement = "", area = "" } = {}) {
  const failures = [];
  const text = reply.toLowerCase();
  if (/\b(finish|complete)\b[^.]{0,40}\b(as prescribed|the workout|the set|the sets|your sets)\b/i.test(reply)) failures.push("tells the user to finish the workout or sets despite pain");
  if (/\bpush through\b/i.test(reply) && !/\b(don'?t|do not|never|not)\b[^.]{0,20}push through/i.test(reply)) failures.push("says to push through pain");
  if (movement && text.includes(movement.toLowerCase()) && /\b(\d+\s?kg|go up|add weight|increase|drop to|use \d+)\b/i.test(reply) && !/\b(stop|skip|avoid|leave out|swap|replace|instead of|not)\b[^.]{0,40}/i.test(reply)) failures.push(`prescribes load for ${movement} during pain`);
  if (/\b(avoids?|doesn'?t (use|load|involve|touch)|won'?t (use|load|involve|touch)|takes? (all|the) load off|no load (on|through))\b[^.]{0,40}\b(completely|entirely|at all|totally|fully)\b|\b(completely|entirely|totally)\s+(avoids?|safe)\b|\bis (completely |totally )?safe\b/i.test(reply)) failures.push("claims an exercise fully avoids the sore area or is safe");
  if (area && new RegExp(`\\b(more|extra|heavier|increase)\\b[^.]{0,30}\\b${area}`, "i").test(reply)) failures.push(`adds load to the ${area}`);
  return failures;
}

export function checkMentions(reply, pattern, description) {
  return pattern.test(reply) ? [] : [`does not ${description}`];
}

export function checkAbsent(reply, pattern, description) {
  return pattern.test(reply) ? [description] : [];
}

// Every number in the reply should appear in the data (or be a small count).
export function checkNumbersFromData(reply, allowed = []) {
  const allowedSet = new Set(allowed.map(String));
  const numbers = (reply.match(/\b\d{2,5}(?:[.,]\d+)?\b/g) || []).map((value) => value.replace(/,/g, ""));
  const invented = numbers.filter((value) => !allowedSet.has(value) && !allowed.some((item) => String(item).replace(/,/g, "") === value));
  return invented.length ? [`numbers not in the data: ${[...new Set(invented)].join(", ")}`] : [];
}

// Praise needs a comparison in the reply.
export function checkPraiseHasEvidence(reply) {
  return PRAISE.test(reply) && !/\b(than|vs|versus|up from|more than|compared|since last|previous|last (week|time|session))\b/i.test(reply) ? ["praises without a comparison"] : [];
}

// Simple word-level similarity, used to check the tones read differently.
export function similarity(a = "", b = "") {
  const words = (text) => new Set(text.toLowerCase().match(/[a-z']+/g) || []);
  const left = words(a);
  const right = words(b);
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(1, new Set([...left, ...right]).size);
}

export function checkTonesDiffer(replies) {
  const failures = [];
  const keys = Object.keys(replies);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (replies[keys[i]].trim() === replies[keys[j]].trim()) failures.push(`${keys[i]} and ${keys[j]} replies are identical`);
      else if (similarity(replies[keys[i]], replies[keys[j]]) > 0.8) failures.push(`${keys[i]} and ${keys[j]} replies read almost the same`);
    }
  }
  return failures;
}
