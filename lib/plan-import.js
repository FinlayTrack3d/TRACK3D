// Import My Plan: turn a plan from the user's own coach into a TRACK3D plan.
//
// Flow: source -> plain text -> AI interpretation (JSON) -> normalise and
// flag anything uncertain -> the user reviews/edits -> the existing save.
// Nothing here saves anything.
//
// V1 handles Fitness from pasted text and text files (.txt, .csv - which
// covers a spreadsheet or Google Sheet exported as CSV). V2 adds Nutrition
// (a second prompt + normaliser feeding the existing nutrition plan save)
// and binary formats (.xlsx, PDF, Word) as extra sourceToText converters;
// neither needs changes to the steps below.

export const IMPORT_TEXT_LIMIT = 20000;

const TEXT_FILE = /\.(txt|csv|tsv|md)$/i;

export function isSupportedImportFile(fileName = "") {
  return TEXT_FILE.test(fileName);
}

// Plain text from a pasted string or the text of an uploaded text file.
export function importSourceText(text) {
  const clean = String(text || "").replace(/\r\n?/g, "\n").replace(/ /g, " ").trim();
  return clean.length > IMPORT_TEXT_LIMIT ? { text: clean.slice(0, IMPORT_TEXT_LIMIT), truncated: true } : { text: clean, truncated: false };
}

export function fitnessImportSystemPrompt() {
  return `You convert a training programme written by the user's own coach into JSON for the TRACK3D app.
Copy what the plan says. Never invent exercises, sets, reps, rest times, days or notes that are not in the text.
The text may be informal ("Incline DB Press - 3 x 8-10"), a pasted spreadsheet or CSV, or a list of days.
Rules:
- One entry in "sessions" per workout/day in the plan, in the order given, using the plan's own session names.
- "days": weekday codes (MON,TUE,WED,THU,FRI,SAT,SUN) only if the plan names weekdays for that session; otherwise [].
- "sets": the number of working sets as an integer, or null if not stated.
- "reps": one string per set (e.g. ["8-10","8-10","8-10"]); a single string if one range applies to all sets; null if not stated.
- "rest_seconds": integer seconds if stated, else null. "tempo" only if stated, else null.
- Put cues, RPE/RIR, supersets, warm-up instructions and progression instructions in "notes" (exercise level, session level or programme level as written).
- Expand obvious abbreviations in exercise names (DB = Dumbbell, BB = Barbell) but keep the exercise the same.
- List anything ambiguous, unreadable or guessed in "uncertain" with where it is and what is unclear.
Respond ONLY with JSON:
{"plan_name": string|null, "sessions": [{"name": string, "days": [], "notes": string|null, "exercises": [{"name": string, "sets": number|null, "reps": [string]|string|null, "rest_seconds": number|null, "tempo": string|null, "notes": string|null}]}], "notes": string|null, "uncertain": [{"where": string, "issue": string}]}`;
}

const DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function dayCode(value) {
  const prefix = String(value || "").trim().slice(0, 3).toUpperCase();
  return DAY_CODES.includes(prefix) ? prefix : null;
}

function text(value) {
  const clean = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
  return clean || null;
}

// Validates the AI reply and fills only what TRACK3D needs to run a
// session, flagging every filled-in value so the user checks it.
export function normaliseImportedFitnessPlan(parsed) {
  const flags = [];
  const flag = (where, issue) => flags.push({ where, issue });
  (Array.isArray(parsed?.uncertain) ? parsed.uncertain : []).forEach((item) => {
    if (item && (item.issue || item.where)) flag(text(item.where) || "Plan", text(item.issue) || "Check this part of the plan.");
  });

  const sessions = (Array.isArray(parsed?.sessions) ? parsed.sessions : []).map((session, sessionIndex) => {
    const name = text(session?.name) || `Session ${sessionIndex + 1}`;
    if (!text(session?.name)) flag(name, "No session name was found, so it was numbered.");
    const rawDays = Array.isArray(session?.days) ? session.days : [];
    const days = [...new Set(rawDays.map(dayCode).filter(Boolean))];
    if (rawDays.length && days.length !== rawDays.length) flag(name, `Some training days could not be read (${rawDays.join(", ")}).`);
    const exercises = (Array.isArray(session?.exercises) ? session.exercises : []).flatMap((exercise) => {
      const exerciseName = text(exercise?.name);
      if (!exerciseName) { flag(name, "An exercise without a name was left out."); return []; }
      const where = `${name} · ${exerciseName}`;
      let sets = Number.isInteger(Number(exercise.sets)) && Number(exercise.sets) > 0 ? Number(exercise.sets) : null;
      if (sets !== null && sets > 10) { flag(where, `${sets} sets looks unusual - capped at 10.`); sets = 10; }
      const repValues = Array.isArray(exercise.reps)
        ? exercise.reps.map(text).filter(Boolean)
        : text(exercise.reps) ? [text(exercise.reps)] : [];
      if (sets === null) {
        sets = repValues.length > 1 ? repValues.length : 3;
        flag(where, repValues.length > 1 ? `Sets not stated - taken as ${sets} from the reps listed.` : "Sets not stated - set to 3. Please check.");
      }
      if (!repValues.length) flag(where, "Reps not stated - set to 8-12. Please check.");
      const ranges = repValues.length ? repValues : ["8-12"];
      const rest = Number(exercise.rest_seconds);
      return [{
        name: exerciseName,
        sets,
        reps: Array.from({ length: sets }, (_, index) => ranges[index] || ranges.at(-1)),
        ...(Number.isFinite(rest) && rest > 0 ? { rest_seconds: Math.round(rest) } : {}),
        ...(text(exercise.tempo) ? { tempo: text(exercise.tempo) } : {}),
        ...(text(exercise.notes) ? { notes: text(exercise.notes) } : {}),
      }];
    });
    if (!exercises.length) flag(name, "No exercises were found for this session.");
    return { name, days, exercises, ...(text(session?.notes) ? { notes: text(session.notes) } : {}) };
  }).filter((session) => session.exercises.length || session.name);

  const scheduled = new Map();
  sessions.forEach((session) => session.days.forEach((day) => scheduled.set(day, [...(scheduled.get(day) || []), session.name])));
  scheduled.forEach((names, day) => { if (names.length > 1) flag(day, `${names.join(" and ")} are both on ${day}. Only one session can be planned per day.`); });
  if (sessions.length && sessions.every((session) => !session.days.length)) flag("Training days", "The plan does not say which weekdays to train. Choose days when you edit, or save without fixed days.");

  return {
    planName: text(parsed?.plan_name),
    notes: text(parsed?.notes),
    sessions: sessions.filter((session) => session.exercises.length),
    flags,
  };
}
