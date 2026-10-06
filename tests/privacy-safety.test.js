import test from "node:test";
import assert from "node:assert/strict";
import { crc32, createZip } from "../lib/zip.js";
import { HEALTH_CONSENT_TEXT, HEALTH_CONSENT_VERSION, clearLocalAppData, deleteAccountProblem, exportFileName, exportFiles, exportLimitText, exportPhotoName, healthConsentStatus, listUserFiles, removeFiles, signUpConsentMetadata } from "../lib/account.js";
import { CALORIE_FLOOR, calorieFloor, calorieTargetProblem, mealPlanFloorProblem, plannedWeeklyLoss, weeklyLossWarning } from "../lib/nutrition-safety.js";
import { calculateNutritionTargets } from "../lib/nutrition-setup.js";
import { dayTargets, restDayCalories } from "../lib/nutrition-plan.js";
import { CHAT_AREAS } from "../lib/coaching/chat-areas.js";
import { SHARED_RULES } from "../lib/coaching/system.js";

// Reads a stored (uncompressed) ZIP back, checking each file's CRC.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "end of central directory");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = {};
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, "central directory entry");
    assert.equal(view.getUint16(offset + 8, true) & 0x0800, 0x0800, "UTF-8 names");
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, "local header");
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    files[name] = data;
    offset += 46 + nameLength;
  }
  return files;
}

test("the ZIP writer stores text and binary files that read back intact", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926, "standard CRC-32 check value");
  const photo = Uint8Array.from({ length: 3000 }, (_, i) => (i * 31) & 255);
  const zip = createZip([{ name: "README.txt", data: "Café ✓\n" }, { name: "photos/2026-10-01/front.jpg", data: photo }, { name: "empty.json", data: "" }]);
  const files = readZip(zip);
  assert.deepEqual(Object.keys(files), ["README.txt", "photos/2026-10-01/front.jpg", "empty.json"]);
  assert.equal(new TextDecoder().decode(files["README.txt"]), "Café ✓\n");
  assert.deepEqual([...files["photos/2026-10-01/front.jpg"]], [...photo]);
  assert.equal(files["empty.json"].length, 0);
});

test("health data consent: the latest of consent and withdrawal wins, for the current version", () => {
  const given = { health_consent_at: "2026-10-06T09:00:00Z", health_consent_version: HEALTH_CONSENT_VERSION };
  assert.equal(HEALTH_CONSENT_TEXT, "I agree to TRACK3D storing my health information (weight, body photos, food, training) to provide coaching.");
  assert.deepEqual(healthConsentStatus({}).reason, "missing");
  // Ticked at sign-up: in the account, still to be copied to the profile.
  const signup = healthConsentStatus({ profileRow: { user_id: "u" }, metadata: given });
  assert.equal(signup.given, true);
  assert.equal(signup.onProfile, false);
  assert.equal(signup.at, "2026-10-06T09:00:00.000Z");
  assert.equal(healthConsentStatus({ profileRow: given, metadata: {} }).onProfile, true);
  // Recorded on the profile by the database at sign-up: kept, even when the
  // browser's clock put the account's copy a little later.
  assert.equal(healthConsentStatus({ profileRow: given, metadata: { ...given, health_consent_at: "2026-10-06T09:02:00Z" } }).onProfile, true);
  const withdrawn = healthConsentStatus({ profileRow: { ...given, health_consent_withdrawn_at: "2026-10-07T09:00:00Z" }, metadata: given });
  assert.equal(withdrawn.given, false);
  assert.equal(withdrawn.reason, "withdrawn");
  // Agreed again after withdrawing.
  assert.equal(healthConsentStatus({ profileRow: { health_consent_at: "2026-10-08T09:00:00Z", health_consent_version: HEALTH_CONSENT_VERSION, health_consent_withdrawn_at: null }, metadata: { health_consent_withdrawn_at: "2026-10-07T09:00:00Z" } }).given, true);
  assert.equal(healthConsentStatus({ profileRow: { ...given, health_consent_version: "2025-01-01" } }).reason, "new_version");
  const metadata = signUpConsentMetadata(new Date("2026-10-06T10:00:00Z"));
  assert.deepEqual(metadata, { health_consent_at: "2026-10-06T10:00:00.000Z", health_consent_version: HEALTH_CONSENT_VERSION });
});

test("the data download has a README, the account, one JSON file per table and the photos", () => {
  const data = {
    exported_at: "2026-10-06T10:00:00Z",
    account: { email: "t@example.invalid" },
    tables: { workout_logs: [{ session_name: "Upper A" }], morning_checkins: [{ data: { weight: "80" } }, { data: {} }], nutrition_logs: [], habits: [{ name: "Read" }], user_profiles: [{ sex: "male" }] },
  };
  const files = exportFiles({ data, userId: "u1", photos: [{ path: "u1/2026-10-01/front.jpg", data: new Uint8Array([1, 2]) }], missingPhotos: [{ path: "u1/2026-10-02/side.jpg", error: "not found" }] });
  const names = files.map(file => file.name);
  assert.deepEqual(names, ["README.txt", "account.json", "data/habits.json", "data/morning_checkins.json", "data/nutrition_logs.json", "data/user_profiles.json", "data/workout_logs.json", "photos/2026-10-01/front.jpg", "photos/NOT-INCLUDED.txt"]);
  const readme = files[0].data;
  assert.match(readme, /morning_checkins\.json: Morning check-ins .*, 2 rows/);
  assert.match(readme, /nutrition_logs\.json: Nutrition logs, 0 rows/);
  assert.match(readme, /1 photo\b/);
  assert.deepEqual(JSON.parse(files.find(file => file.name === "data/workout_logs.json").data), [{ session_name: "Upper A" }]);
  assert.match(files.at(-1).data, /photos\/2026-10-02\/side\.jpg: not found/);
  assert.equal(exportPhotoName("u1/2026-10-01/front.jpg", "u1"), "photos/2026-10-01/front.jpg");
  assert.equal(exportFileName(new Date("2026-10-06T23:30:00Z")), "track3d-data-2026-10-06.zip");
  assert.equal(exportLimitText("2026-10-07T10:00:00Z", "Europe/London"), "You can download your data once a day. Your next download is available from 11:00 on Wednesday 7 October.");
});

test("photos are listed through every folder and page, and removed 100 at a time", async () => {
  const files = Object.fromEntries(Array.from({ length: 1003 }, (_, i) => [`u1/2026-10-01/${String(i).padStart(4, "0")}.jpg`, true]));
  files["u1/2026-10-02/front.jpg"] = true;
  const listCalls = [];
  const bucket = {
    async list(prefix, { limit, offset }) {
      listCalls.push(prefix);
      const inside = Object.keys(files).filter(key => key.startsWith(`${prefix}/`)).map(key => key.slice(prefix.length + 1));
      const folders = [...new Set(inside.filter(rest => rest.includes("/")).map(rest => rest.split("/")[0]))].map(name => ({ name, id: null }));
      const items = [...folders, ...inside.filter(rest => !rest.includes("/")).map(name => ({ name, id: name }))];
      return { data: items.slice(offset, offset + limit), error: null };
    },
    removed: [],
    async remove(paths) { this.removed.push(paths.length); return { data: paths, error: null }; },
  };
  const paths = await listUserFiles(bucket, "u1");
  assert.equal(paths.length, 1004);
  assert.ok(paths.includes("u1/2026-10-02/front.jpg"));
  assert.ok(listCalls.filter(prefix => prefix === "u1/2026-10-01").length >= 2, "second page read");
  await removeFiles(bucket, paths);
  assert.deepEqual(bucket.removed, [...Array(10).fill(100), 4]);
  await assert.rejects(removeFiles({ remove: async () => ({ error: new Error("denied") }) }, ["a"]), /denied/);
});

test("after deleting the account nothing of it is left in the browser", () => {
  const store = entries => {
    const map = new Map(entries);
    return { get length() { return map.size; }, key: index => [...map.keys()][index], removeItem: key => map.delete(key), keys: () => [...map.keys()] };
  };
  const local = store([["track3d-auth", "x"], ["track3d_habits_u1", "x"], ["track3d-session-drafts:u1:fitness", "x"], ["other-site", "x"]]);
  const session = store([["track3d-anything", "x"]]);
  const deleted = [];
  clearLocalAppData({ local, session, indexedDb: { deleteDatabase: name => deleted.push(name) } });
  assert.deepEqual(local.keys(), ["other-site"]);
  assert.deepEqual(session.keys(), []);
  assert.deepEqual(deleted, ["track3d-session-drafts"]);
  assert.match(deleteAccountProblem("wrong_password"), /Nothing has been deleted/);
  assert.match(deleteAccountProblem("too_many_attempts"), /Wait 15 minutes/);
  assert.match(deleteAccountProblem(null, { code: "PGRST202", message: "Could not find the function public.delete_my_account" }), /database update/);
  assert.equal(deleteAccountProblem("deleted"), "");
});

test("calorie targets can't go below the minimum: 1,200 women, 1,500 men, 1,350 not given", () => {
  assert.deepEqual({ ...CALORIE_FLOOR }, { female: 1200, male: 1500, unknown: 1350 });
  assert.equal(calorieFloor("Female"), 1200);
  assert.equal(calorieFloor("male"), 1500);
  assert.equal(calorieFloor("Prefer not to say"), 1350);
  assert.equal(calorieFloor(null), 1350);
  // Typing 1,000 kcal is blocked, with an explanation.
  assert.match(calorieTargetProblem("1000", "Female"), /^1,000 kcal a day is below TRACK3D's minimum of 1,200 kcal for women\. .*Raise it to at least 1,200 kcal/);
  assert.match(calorieTargetProblem(1000, ""), /minimum of 1,350 kcal when sex isn't given \(1,200 for women, 1,500 for men\)/);
  assert.match(calorieTargetProblem(0, "Male"), /below TRACK3D's minimum of 1,500/);
  assert.equal(calorieTargetProblem("", "Male"), "", "nothing typed yet");
  assert.equal(calorieTargetProblem(1200, "Female"), "");
  assert.match(mealPlanFloorProblem([{ calories: 500 }, { calories: 600 }], "Female", "Your meals"), /^Your meals add up to 1,100 kcal, below the minimum of 1,200 kcal a day for women/);
  assert.equal(mealPlanFloorProblem([{ calories: 700 }, { calories: 600 }], "Female"), "");
  assert.equal(mealPlanFloorProblem([], "Female"), "", "no meals yet");
  // The calculator never goes below it either.
  assert.equal(calculateNutritionTargets({ weight: 45, height: 150, age: 60, sex: "Female", activityLevel: "Sedentary", goal: "Lose fat" }).calories, 1200);
});

test("rest days stay at or above the minimum", () => {
  assert.equal(restDayCalories(2381), 2100, "still about 12% lighter normally");
  assert.equal(restDayCalories(1300, 1200), 1200);
  assert.equal(restDayCalories(1100, 1200), 1100, "never above the training day");
  const plan = { daily_calories: 1300, protein_target: 100, carbs_target: 120, fats_target: 40, rest_day_meals: [{ name: "x" }], setup: { sex: "Female" } };
  assert.equal(dayTargets(plan, false).calories, 1200);
  assert.equal(dayTargets({ ...plan, setup: {} }, false).calories, 1300, "unknown sex: 1,350 minimum, capped at the training day");
});

test("losing more than 1% of body weight a week is warned about", () => {
  const loss = plannedWeeklyLoss({ calories: 1600, maintenance: 3071, weight: 80 });
  assert.equal(loss.kgPerWeek.toFixed(2), "1.34");
  assert.match(weeklyLossWarning({ calories: 1600, maintenance: 3071, weight: 80 }), /^At 1,600 kcal a day you'd lose about 1\.3 kg a week, 1\.7% of your body weight \(maintenance is about 3,071 kcal\)\. Losing more than 1% a week/);
  assert.match(weeklyLossWarning({ calories: 1600, maintenance: 3071, weight: 80, estimated: true }), /estimated maintenance/);
  assert.equal(weeklyLossWarning({ calories: 2630, maintenance: 3071, weight: 80 }), "", "0.5% a week is fine");
  assert.equal(weeklyLossWarning({ calories: 3200, maintenance: 3071, weight: 80 }), "", "no deficit");
  assert.equal(weeklyLossWarning({ calories: 1600, maintenance: null, weight: 80 }), "", "unknown maintenance");
});

test("AI meal plans and the coach are told the minimum", () => {
  for (const area of ["meal_plan_build", "meal_plan_tweak", "rest_day_plan"]) {
    assert.match(CHAT_AREAS[area].instructions, /Never return a plan that adds up to less than the minimum daily calories in the user's message, even if the user asks for less\./, area);
  }
  assert.match(SHARED_RULES, /below TRACK3D's minimum: 1,200 kcal a day for women, 1,500 for men, 1,350 if sex isn't given\), losing more than 1% of body weight a week/);
  assert.match(SHARED_RULES, /Beat \(beateatingdisorders\.org\.uk\)/);
});
