// What the user's workouts show over time: whether a logged workout really
// counts as done, how long each session usually takes (one unusually long
// session doesn't count), and the time of day it is usually done.
import { activityOfLog, countsAsDone, workoutCompletion } from "./fitness-session.js";

export { countsAsDone, workoutCompletion };

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const sameSession = (log, name) => String(log?.session_name || "").toLowerCase() === String(name || "").toLowerCase();

// How long a session usually takes, from its last 8 complete workouts (at
// least 3): times far from the usual (over 1.4× or under 0.6× the median,
// such as a workout left open) are left out. null until there are enough.
export function typicalSessionMinutes(history = [], sessionName = "") {
  const minutes = (history || [])
    .filter(log => sameSession(log, sessionName) && !activityOfLog(log) && (workoutCompletion(log) ?? 1) >= 0.8)
    .map(log => Number(log.duration_mins) || 0)
    .filter(value => value >= 5)
    .slice(0, 8);
  if (minutes.length < 3) return null;
  const middle = median(minutes);
  const kept = minutes.filter(value => value <= middle * 1.4 && value >= middle * 0.6);
  return Math.round(kept.reduce((total, value) => total + value, 0) / kept.length);
}

const toMinutes = time => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const toTime = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;

// The time a session is usually started, when there is a pattern: the
// last 6 workouts of that session (or, failing that, on that weekday),
// at least 3, most of them within an hour of the middle one. timeOf(log)
// gives a log's start as "HH:MM" in the user's home time; dayOf(log) its
// day code. null when there is no clear pattern.
export function usualStartTime(history = [], { sessionName = "", dayCode = "", timeOf = () => null, dayOf = () => "" } = {}) {
  const done = (history || []).filter(log => !activityOfLog(log) && countsAsDone(log));
  const bySession = done.filter(log => sameSession(log, sessionName));
  const pick = bySession.length >= 3 ? bySession : done.filter(log => dayCode && dayOf(log) === dayCode);
  const starts = pick.slice(0, 6).map(log => toMinutes(timeOf(log))).filter(value => value !== null);
  if (starts.length < 3) return null;
  const middle = median(starts);
  const close = starts.filter(value => Math.abs(value - middle) <= 60);
  if (close.length < Math.ceil(starts.length * 0.6)) return null;
  return toTime(median(close));
}
