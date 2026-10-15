// Built-in starter programmes, used when the AI coach can't build one (the
// coach is offline, or keeps failing). Chosen from the answers the user has
// already given: days a week, equipment, time per session and experience.
// Every set has a rep range (playbook V1.3): straight sets for beginners,
// staggered sets (heaviest first) otherwise.
import { defaultRanges, exerciseKind } from "./set-progression.js";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// Exercise slots, by equipment: full gym, dumbbells (home or dumbbells only)
// and bodyweight.
const MOVES = {
  squat: { gym: "Barbell Back Squat", dumbbell: "Goblet Squat", bodyweight: "Bodyweight Squat" },
  hinge: { gym: "Barbell Romanian Deadlift", dumbbell: "Dumbbell Romanian Deadlift", bodyweight: "Single-Leg Glute Bridge" },
  lunge: { gym: "Dumbbell Reverse Lunge", dumbbell: "Dumbbell Reverse Lunge", bodyweight: "Reverse Lunge" },
  push: { gym: "Dumbbell Bench Press", dumbbell: "Dumbbell Bench Press", bodyweight: "Push-Up" },
  inclinePush: { gym: "Incline Dumbbell Press", dumbbell: "Incline Dumbbell Press", bodyweight: "Decline Push-Up" },
  overhead: { gym: "Dumbbell Shoulder Press", dumbbell: "Dumbbell Shoulder Press", bodyweight: "Pike Push-Up" },
  row: { gym: "Seated Cable Row", dumbbell: "Dumbbell Row (single arm)", bodyweight: "Inverted Row" },
  pull: { gym: "Lat Pulldown", dumbbell: "Chest-Supported Dumbbell Row", bodyweight: "Doorway Row" },
  legCurl: { gym: "Seated Leg Curl", dumbbell: "Dumbbell Hamstring Curl", bodyweight: "Sliding Leg Curl" },
  calf: { gym: "Standing Calf Raise", dumbbell: "Dumbbell Calf Raise", bodyweight: "Single-Leg Calf Raise" },
  biceps: { gym: "Cable Curl", dumbbell: "Dumbbell Bicep Curl", bodyweight: "Towel Curl" },
  triceps: { gym: "Cable Tricep Pushdown", dumbbell: "Overhead Dumbbell Extension", bodyweight: "Bench Dip" },
  lateral: { gym: "Dumbbell Lateral Raise", dumbbell: "Dumbbell Lateral Raise", bodyweight: "Plank Shoulder Tap" },
  core: { gym: "Plank", dumbbell: "Plank", bodyweight: "Plank" },
};

const TEMPLATES = {
  fullBody2: {
    name: "Full Body x2",
    note: "Two full-body sessions a week: every muscle trained twice, with time to recover.",
    sessions: [
      { name: "Full Body A", slots: ["squat", "push", "row", "overhead", "legCurl", "core"] },
      { name: "Full Body B", slots: ["hinge", "inclinePush", "pull", "lunge", "biceps", "triceps"] },
    ],
  },
  fullBody3: {
    name: "Full Body x3",
    note: "Three full-body sessions a week, rotating A, B and C.",
    sessions: [
      { name: "Full Body A", slots: ["squat", "push", "row", "lateral", "core"] },
      { name: "Full Body B", slots: ["hinge", "overhead", "pull", "lunge", "triceps"] },
      { name: "Full Body C", slots: ["lunge", "inclinePush", "row", "legCurl", "biceps"] },
    ],
  },
  upperLower4: {
    name: "Upper / Lower x4",
    note: "Upper and lower body on alternate days, each twice a week.",
    sessions: [
      { name: "Upper A", slots: ["push", "row", "overhead", "pull", "biceps", "triceps"] },
      { name: "Lower A", slots: ["squat", "hinge", "lunge", "calf", "core"] },
      { name: "Upper B", slots: ["inclinePush", "pull", "lateral", "row", "triceps", "biceps"] },
      { name: "Lower B", slots: ["hinge", "lunge", "legCurl", "calf", "core"] },
    ],
  },
};

const DEFAULT_DAYS = { 1: ["MON"], 2: ["MON", "THU"], 3: ["MON", "WED", "FRI"], 4: ["MON", "TUE", "THU", "SAT"] };

const equipmentKind = text => {
  const value = String(text || "").toLowerCase();
  if (/bodyweight|no equipment|none/.test(value)) return "bodyweight";
  if (/dumbbell|home/.test(value)) return "dumbbell";
  return "gym";
};

// "3 days" -> 3; "45 minutes" / "1 hour" -> minutes.
const firstNumber = text => Number(String(text || "").match(/\d+/)?.[0]) || null;
const minutesOf = text => {
  const value = String(text || "").toLowerCase();
  const number = firstNumber(value);
  if (!number) return null;
  return /hour|hr/.test(value) && number < 5 ? number * 60 : number;
};

// The starter plan for these answers, in the same shape as an AI-built plan
// ({ split_name, sessions, notes }). answers: the builder's answers;
// experience: "beginner" | "intermediate" | "advanced" | null.
export function starterPlan(answers = {}, experience = null) {
  const daysWanted = Math.max(1, Math.min(7, firstNumber(answers.days_per_week) || 3));
  const sessionsCount = Math.min(daysWanted, 4);
  const template = sessionsCount >= 4 ? TEMPLATES.upperLower4 : sessionsCount === 3 ? TEMPLATES.fullBody3 : TEMPLATES.fullBody2;
  const equipment = equipmentKind(answers.equipment);
  const straight = !experience || experience === "beginner";
  const minutes = minutesOf(answers.session_length);
  // Shorter sessions keep the first exercises (the most important ones).
  const exerciseCount = minutes && minutes <= 30 ? 4 : minutes && minutes <= 45 ? 5 : 6;
  const preferred = (Array.isArray(answers.preferred_days) ? answers.preferred_days : []).filter(day => DAYS.includes(day));
  const days = preferred.length >= sessionsCount ? preferred.slice(0, sessionsCount) : DEFAULT_DAYS[Math.max(1, Math.min(4, sessionsCount))] || DEFAULT_DAYS[3];
  const sessionsOnPlan = template.sessions.slice(0, sessionsCount === 1 ? 1 : template.sessions.length);
  const sessions = sessionsOnPlan.map((session, index) => ({
    name: session.name,
    days: sessionsCount === 1 ? [days[0]] : [days[index % days.length]],
    reasoning: template.note,
    exercises: session.slots.slice(0, exerciseCount).map(slot => {
      const name = MOVES[slot][equipment];
      const sets = slot === "core" || slot === "calf" ? 2 : 3;
      const timed = name === "Plank";
      return {
        name,
        sets,
        reps: timed ? Array(sets).fill("30-45s") : defaultRanges(sets, { kind: exerciseKind(name), straight }),
        tempo: timed ? "0-0-0-0" : "3-0-1-0",
        rest_seconds: exerciseKind(name) === "isolation" || timed ? 60 : 90,
        warmup_sets: slot === session.slots[0] ? 2 : 0,
        notes: "",
      };
    }),
  }));
  const extraDays = daysWanted > sessionsCount ? ` You asked for ${daysWanted} days: this starter plan uses ${sessionsCount}; add more once the AI coach is back.` : "";
  return {
    split_name: `${template.name} (starter plan)`,
    sessions,
    notes: `A starter plan built into TRACK3D while the AI coach is unavailable. ${template.note}${extraDays} You can rebuild it with the coach later.`,
    starter: true,
  };
}

// Session names suggested for a plan with this many sessions a week.
export function sessionNameSuggestions(count = 3) {
  const names = {
    1: ["Full Body"],
    2: ["Full Body A", "Full Body B"],
    3: ["Push", "Pull", "Legs"],
    4: ["Upper A", "Lower A", "Upper B", "Lower B"],
    5: ["Push", "Pull", "Legs", "Upper", "Lower"],
    6: ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"],
  }[count];
  return names || Array.from({ length: count }, (_, index) => `Session ${index + 1}`);
}
