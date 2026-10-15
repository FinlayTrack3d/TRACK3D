// GET STARTED for a new account: the setup steps in the order each one
// helps the next (nutrition uses the training days, and the morning can use
// both), what to do after each save, and what happens tomorrow once
// everything is set up.
// status: { profile, fitness, nutrition, morning, habits } booleans.

export const SETUP_STEPS = [
  { id: "profile", label: "Complete your profile", saved: "Profile saved" },
  { id: "fitness", label: "Build your training plan", saved: "Training plan saved" },
  { id: "nutrition", label: "Set your calorie target", saved: "Calorie target set" },
  { id: "morning", label: "Set up your morning", saved: "Morning set" },
  { id: "habits", label: "Add 1–3 daily habits", saved: "Habits added", optional: true },
];

export const setupSteps = (status = {}) => SETUP_STEPS.map(step => ({ ...step, done: Boolean(status[step.id]) }));

// Every required step done (habits are optional).
export const setupComplete = (status = {}) => SETUP_STEPS.every(step => step.optional || status[step.id]);

// The first required step still to do, else the optional one, else null.
export function nextSetupStep(status = {}) {
  const steps = setupSteps(status);
  return steps.find(step => !step.done && !step.optional) || steps.find(step => !step.done) || null;
}

// The banner after a setup step is saved: "Morning set ✓", then the next
// step, or "You're all set" once every required step is done.
export function setupSavedBanner(savedId, status = {}) {
  const saved = SETUP_STEPS.find(step => step.id === savedId);
  if (!saved) return null;
  if (setupComplete(status)) return { title: `${saved.saved} ✓`, text: "You're all set.", next: null, allSet: true };
  const next = nextSetupStep(status);
  return { title: `${saved.saved} ✓`, text: `Next: ${next.label}`, next: next.id, allSet: false };
}

const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_NAMES = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };
const dayCodeOf = dateKey => DAY_CODES[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
const shiftKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const sessionOn = (sessions, code) => (sessions || []).find(session => (session.days || []).some(day => String(day).toUpperCase().slice(0, 3) === code)) || null;

// "What happens tomorrow" for You're all set: the morning wake-up, the first
// workout from tomorrow on (within a week) and tomorrow's first meal.
// mealsFor(dateKey, isTrainingDay) gives that day's meals.
export function tomorrowPlan({ today, wakeTime = "", sessions = [], mealsFor = () => [] } = {}) {
  const tomorrow = shiftKey(today, 1);
  const lines = [];
  if (wakeTime) lines.push({ id: "morning", text: `Morning routine from ${wakeTime}` });
  for (let offset = 1; offset <= 7; offset += 1) {
    const code = dayCodeOf(shiftKey(today, offset));
    const session = sessionOn(sessions, code);
    if (!session) continue;
    lines.push({ id: "workout", text: `First workout: ${session.name}, ${offset === 1 ? "tomorrow" : DAY_NAMES[code]}` });
    break;
  }
  const meals = mealsFor(tomorrow, Boolean(sessionOn(sessions, dayCodeOf(tomorrow)))) || [];
  const first = [...meals].sort((a, b) => (a.time && b.time ? String(a.time).localeCompare(String(b.time)) : 0))[0];
  if (first) lines.push({ id: "meal", text: `First meal: ${first.name}${first.time ? ` at ${first.time}` : ""}` });
  return lines;
}

// One experience scale everywhere: the profile's. The AI programme builder
// shows these, and takes the answer from the profile when it is known.
export const EXPERIENCE_ANSWERS = {
  beginner: "Beginner – under a year of regular training",
  intermediate: "Intermediate – 1–3 years of regular training",
  advanced: "Advanced – 3+ years of training",
};
