import test from "node:test";
import assert from "node:assert/strict";
import { minutesLate, photosDue, routineSettings, shiftSchedule, wakeTimeFor, withRoutineSettings } from "../lib/morning-schedule.js";

test("wake-up times by day and a ready-by time are kept on the check-in task", () => {
  const tasks = [{ id: "water", name: "Drink water", scheduledTime: "06:00" }, { id: "checkin", name: "Check-in", scheduledTime: "06:30" }];
  const saved = withRoutineSettings(tasks, { dayWakeTimes: { SAT: "08:00", SUN: "08:30" }, readyBy: "07:00" });
  assert.deepEqual(routineSettings(saved), { dayWakeTimes: { SAT: "08:00", SUN: "08:30" }, readyBy: "07:00" });
  assert.deepEqual(routineSettings(tasks), { dayWakeTimes: {}, readyBy: "" });
  assert.equal(wakeTimeFor("SAT", "06:00", { SAT: "08:00" }), "08:00");
  assert.equal(wakeTimeFor("MON", "06:00", { SAT: "08:00" }), "06:00");
  assert.deepEqual(shiftSchedule(tasks, "06:00", "08:00").map(task => task.scheduledTime), ["08:00", "08:30"]);
  assert.equal(shiftSchedule(tasks, "06:00", "06:00"), tasks);
});

test("progress photos daily, weekly or off; finishing after the ready-by time", () => {
  assert.equal(photosDue({ id: "photos" }, "TUE"), true, "older routines: daily");
  assert.equal(photosDue({ frequency: "weekly", photoDay: "MON" }, "MON"), true);
  assert.equal(photosDue({ frequency: "weekly", photoDay: "MON" }, "TUE"), false);
  assert.equal(photosDue({ frequency: "off" }, "MON"), false);
  assert.equal(minutesLate("07:45", "07:30"), 15);
  assert.equal(minutesLate("07:15", "07:30"), 0);
  assert.equal(minutesLate("07:15", ""), 0);
});

test("a task left out today closes up the times", async () => {
  const { restackSchedule } = await import("../lib/morning-schedule.js");
  const tasks = [{ id: "sleep", duration: 1 }, { id: "weight", duration: 2 }, { id: "water", duration: 2 }, { id: "checkin", duration: 2 }];
  assert.deepEqual(restackSchedule(tasks, "06:00").map(task => task.scheduledTime), ["06:00", "06:01", "06:03", "06:05"]);
});
