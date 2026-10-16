// Morning routine settings kept with the routine's tasks (no extra
// columns): different wake-up times on some days and a "ready by" time sit
// on the locked check-in task; how often progress photos are taken sits on
// the photos task.

const toMinutes = time => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const toTime = minutes => {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
};

// { dayWakeTimes: { SAT: "08:00" }, readyBy: "07:30" | "" } from the routine's tasks.
export function routineSettings(tasks = []) {
  const checkin = (tasks || []).find(task => task?.id === "checkin") || {};
  const dayWakeTimes = Object.fromEntries(Object.entries(checkin.dayWakeTimes || {}).filter(([, time]) => toMinutes(time) !== null));
  return { dayWakeTimes, readyBy: toMinutes(checkin.readyBy) !== null ? checkin.readyBy : "" };
}

// The tasks with the settings written onto the check-in task.
export function withRoutineSettings(tasks = [], { dayWakeTimes = {}, readyBy = "" } = {}) {
  return (tasks || []).map(task => (task?.id === "checkin" ? { ...task, dayWakeTimes, readyBy: readyBy || "" } : task));
}

// The wake-up time on a day (MON..SUN).
export const wakeTimeFor = (dayCode, wakeTime, dayWakeTimes = {}) => dayWakeTimes?.[dayCode] || wakeTime;

// The day's tasks with their times moved by the difference between that
// day's wake-up and the usual one.
export function shiftSchedule(tasks = [], fromWake, toWake) {
  const delta = (toMinutes(toWake) ?? 0) - (toMinutes(fromWake) ?? 0);
  if (!delta) return tasks;
  return (tasks || []).map(task => (toMinutes(task.scheduledTime) === null ? task : { ...task, scheduledTime: toTime(toMinutes(task.scheduledTime) + delta) }));
}

// Progress photos: "daily" (the default for routines saved before this),
// "weekly" on photoDay, or "off".
export const PHOTO_FREQUENCIES = [["weekly", "WEEKLY"], ["daily", "DAILY"], ["off", "OFF"]];
export function photosDue(task = {}, dayCode = "") {
  if (task.frequency === "off") return false;
  if (task.frequency === "weekly") return dayCode === (task.photoDay || "MON");
  return true;
}

// Minutes the routine finishes after the "ready by" time, or 0.
export function minutesLate(finishTime, readyBy) {
  const finish = toMinutes(finishTime);
  const ready = toMinutes(readyBy);
  if (finish === null || ready === null) return 0;
  return Math.max(0, finish - ready);
}

// Times one after another from the wake-up, for a day when some tasks are
// left out (weekly photos, alternating days), so no gaps are left.
export function restackSchedule(tasks = [], wakeTime) {
  let cursor = toMinutes(wakeTime);
  if (cursor === null) return tasks;
  return (tasks || []).map(task => {
    const scheduled = { ...task, scheduledTime: toTime(cursor) };
    cursor += Number(task.duration) || 5;
    return scheduled;
  });
}
