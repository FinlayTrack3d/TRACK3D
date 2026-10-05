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
export const IMPORT_FILE_MAX_BYTES = 512 * 1024;
// Longest values kept from an interpreted plan; anything longer is cut and flagged.
export const IMPORT_FIELD_LIMITS = { name: 80, notes: 500, planNotes: 2000, tempo: 20, flag: 300, sessions: 14, exercises: 30 };

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

function text(value, max = Infinity) {
  const clean = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// Validates the AI reply and fills only what TRACK3D needs to run a
// session, flagging every filled-in value so the user checks it.
export function normaliseImportedFitnessPlan(parsed) {
  const L = IMPORT_FIELD_LIMITS;
  const flags = [];
  const flag = (where, issue) => flags.push({ where: text(where, L.flag), issue: text(issue, L.flag) });
  const tooLong = (value, max) => typeof value === "string" && value.trim().length > max;
  (Array.isArray(parsed?.uncertain) ? parsed.uncertain : []).slice(0, 50).forEach((item) => {
    if (item && (item.issue || item.where)) flag(text(item.where) || "Plan", text(item.issue) || "Check this part of the plan.");
  });

  const rawSessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  if (rawSessions.length > L.sessions) flag("Plan", `The plan has ${rawSessions.length} sessions; only the first ${L.sessions} were kept.`);
  const sessions = rawSessions.slice(0, L.sessions).map((session, sessionIndex) => {
    const name = text(session?.name, L.name) || `Session ${sessionIndex + 1}`;
    if (tooLong(session?.name, L.name)) flag(name, "The session name was shortened.");
    if (!text(session?.name)) flag(name, "No session name was found, so it was numbered.");
    const rawDays = Array.isArray(session?.days) ? session.days : [];
    const days = [...new Set(rawDays.map(dayCode).filter(Boolean))];
    if (rawDays.length && days.length !== rawDays.length) flag(name, `Some training days could not be read (${rawDays.join(", ")}).`);
    const rawExercises = Array.isArray(session?.exercises) ? session.exercises : [];
    if (rawExercises.length > L.exercises) flag(name, `${rawExercises.length} exercises listed; only the first ${L.exercises} were kept.`);
    const exercises = rawExercises.slice(0, L.exercises).flatMap((exercise) => {
      const exerciseName = text(exercise?.name, L.name);
      if (!exerciseName) { flag(name, "An exercise without a name was left out."); return []; }
      const where = `${name} · ${exerciseName}`;
      if (tooLong(exercise.name, L.name)) flag(where, "The exercise name was shortened.");
      if (tooLong(exercise.notes, L.notes)) flag(where, "The exercise notes were shortened.");
      let sets = Number.isInteger(Number(exercise.sets)) && Number(exercise.sets) > 0 ? Number(exercise.sets) : null;
      if (sets !== null && sets > 10) { flag(where, `${sets} sets looks unusual - capped at 10.`); sets = 10; }
      const repValues = Array.isArray(exercise.reps)
        ? exercise.reps.slice(0, 10).map((value) => text(value, L.tempo)).filter(Boolean)
        : text(exercise.reps, L.tempo) ? [text(exercise.reps, L.tempo)] : [];
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
        ...(Number.isFinite(rest) && rest > 0 ? { rest_seconds: Math.min(Math.round(rest), 900) } : {}),
        ...(text(exercise.tempo, L.tempo) ? { tempo: text(exercise.tempo, L.tempo) } : {}),
        ...(text(exercise.notes, L.notes) ? { notes: text(exercise.notes, L.notes) } : {}),
      }];
    });
    if (!exercises.length) flag(name, "No exercises were found for this session.");
    if (tooLong(session?.notes, L.notes)) flag(name, "The session notes were shortened.");
    return { name, days, exercises, ...(text(session?.notes, L.notes) ? { notes: text(session.notes, L.notes) } : {}) };
  }).filter((session) => session.exercises.length || session.name);

  const scheduled = new Map();
  sessions.forEach((session) => session.days.forEach((day) => scheduled.set(day, [...(scheduled.get(day) || []), session.name])));
  scheduled.forEach((names, day) => { if (names.length > 1) flag(day, `${names.join(" and ")} are both on ${day}. Only one session can be planned per day.`); });
  if (tooLong(parsed?.notes, L.planNotes)) flag("Plan", "The coach notes were shortened.");
  if (sessions.length && sessions.every((session) => !session.days.length)) flag("Training days", "The plan does not say which weekdays to train. Choose days when you edit, or save without fixed days.");

  return {
    planName: text(parsed?.plan_name, L.name),
    notes: text(parsed?.notes, L.planNotes),
    sessions: sessions.filter((session) => session.exercises.length),
    flags,
  };
}
