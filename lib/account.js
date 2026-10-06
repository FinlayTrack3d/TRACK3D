// Profile -> Account: health data consent, "Download my data" and "Delete my
// account". The database side (consent columns, export_my_data,
// delete_my_account, set_health_consent) is in
// supabase/migrations/202610060001_privacy_account.sql.

// Changing the version asks everyone to agree again on their next visit.
export const HEALTH_CONSENT_VERSION = "2026-10-06";
export const HEALTH_CONSENT_TEXT = "I agree to TRACK3D storing my health information (weight, body photos, food, training) to provide coaching.";

const timeOf = value => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
};
const iso = time => (time ? new Date(time).toISOString() : null);

// Whether the user has agreed to the current version. The profile row is the
// record; consent ticked at sign-up (or given while the profile could not be
// written) is also in the sign-in account's metadata. The latest event wins:
// consent given, or consent withdrawn.
// Returns { given, reason: "given" | "missing" | "withdrawn" | "new_version",
// at, version, withdrawnAt, onProfile }. onProfile is false when the consent
// should be copied to the profile (the profile's own record, timed by the
// database, is kept whenever it is valid).
export function healthConsentStatus({ profileRow = null, metadata = null } = {}) {
  const [profile, account] = [profileRow, metadata].map(source => ({
    at: timeOf(source?.health_consent_at),
    version: String(source?.health_consent_version || ""),
    withdrawnAt: timeOf(source?.health_consent_withdrawn_at),
  }));
  const latest = [profile, account].filter(source => source.at).sort((a, b) => b.at - a.at)[0] || null;
  const withdrawnAt = Math.max(profile.withdrawnAt, account.withdrawnAt);
  const base = { at: iso(latest?.at), version: latest?.version || null, withdrawnAt: iso(withdrawnAt) };
  if (!latest) return { ...base, given: false, reason: withdrawnAt ? "withdrawn" : "missing", onProfile: false };
  if (withdrawnAt >= latest.at) return { ...base, given: false, reason: "withdrawn", onProfile: false };
  if (latest.version !== HEALTH_CONSENT_VERSION) return { ...base, given: false, reason: "new_version", onProfile: false };
  const onProfile = profile.at > 0 && profile.version === HEALTH_CONSENT_VERSION && profile.withdrawnAt < profile.at;
  return { ...base, given: true, reason: "given", onProfile };
}

// The sign-up form sends this with the new account (Supabase user metadata).
export const signUpConsentMetadata = (now = new Date()) => ({ health_consent_at: now.toISOString(), health_consent_version: HEALTH_CONSENT_VERSION });

// ── Download my data ────────────────────────────────────────────────────────
const TABLE_LABELS = {
  morning_checkins: "Morning check-ins (weight, sleep, mood and the rest of each check-in)",
  morning_routines: "Morning routine",
  workout_logs: "Workouts",
  workout_splits: "Training plan",
  workout_overrides: "Workout changes",
  nutrition_logs: "Nutrition logs",
  nutrition_plans: "Nutrition plan, meal library and planned days",
  habits: "Habits",
  habit_completions: "Habit ticks",
  daily_goals: "Daily goals",
  user_profiles: "Profile (height, date of birth, sex, health data consent)",
  coach_profiles: "Coach settings",
  coach_memory: "What the coach remembers",
  coach_memories: "What the coach remembers",
  coach_conversations: "Coach conversations",
  coach_messages: "Coach messages",
  coach_actions: "Changes the coach suggested",
  weekly_reports: "Weekly reports",
  end_of_day: "End of day roundups",
  daily_debrief: "Daily debriefs",
  calendar_tasks: "Calendar",
  pain_reports: "Pain reports",
  activity_logs: "Activities",
  training_programmes: "Training programmes",
  programme_exercises: "Programme exercises",
  training_sessions: "Training sessions",
  training_sets: "Training sets",
  exercise_preferences: "Exercise preferences",
  chat_requests: "Coach requests (times only, for the hourly limit)",
};

const json = value => `${JSON.stringify(value ?? null, null, 2)}\n`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// A photo's path inside the download: "photos/2026-10-01/front.jpg".
export function exportPhotoName(path, userId = "") {
  const text = String(path);
  const prefix = `${userId}/`;
  return `photos/${userId && text.startsWith(prefix) ? text.slice(prefix.length) : text}`;
}

export const exportFileName = (date = new Date()) => `track3d-data-${date.toISOString().slice(0, 10)}.zip`;

// The files in the download: README.txt, account.json, one JSON file per
// table (data/<table>.json) and the photos. data is export_my_data()'s
// result; photos are [{ path, data }]; missingPhotos are [{ path, error }]
// that could not be downloaded.
export function exportFiles({ data, photos = [], missingPhotos = [], userId = "" } = {}) {
  const tables = data?.tables && typeof data.tables === "object" ? data.tables : {};
  const names = Object.keys(tables).sort();
  const rows = name => (Array.isArray(tables[name]) ? tables[name].length : 0);
  const readme = [
    "TRACK3D: your data",
    `Exported ${data?.exported_at || new Date().toISOString()} (UTC).`,
    "",
    "account.json: your sign-in account (email, when it was created and last used, and the consent you gave at sign-up).",
    "",
    "data/: one JSON file per table, with every row stored for your account. Empty tables are included.",
    ...names.map(name => `  ${name}.json: ${TABLE_LABELS[name] || name}, ${plural(rows(name), "row")}`),
    "",
    `photos/: your progress photos by date and angle, ${plural(photos.length, "photo")}.`,
    ...(missingPhotos.length ? [`  ${plural(missingPhotos.length, "photo")} could not be downloaded: see photos/NOT-INCLUDED.txt.`] : []),
    "",
    "JSON files open in any text editor. Times are in UTC.",
    "You can download your data once a day from Profile -> Account in TRACK3D.",
    "",
  ].join("\n");
  const files = [
    { name: "README.txt", data: readme },
    { name: "account.json", data: json(data?.account || {}) },
    ...names.map(name => ({ name: `data/${name}.json`, data: json(tables[name] ?? []) })),
    ...photos.map(photo => ({ name: exportPhotoName(photo.path, userId), data: photo.data })),
  ];
  if (missingPhotos.length) {
    files.push({ name: "photos/NOT-INCLUDED.txt", data: `These photos could not be downloaded. Try again tomorrow.\n${missingPhotos.map(photo => `${exportPhotoName(photo.path, userId)}: ${photo.error}`).join("\n")}\n` });
  }
  return files;
}

// "You can download your data once a day..." for export_my_data()'s
// { error: "export_limit", available_at }.
export function exportLimitText(availableAt, timeZone) {
  const when = new Date(availableAt);
  if (Number.isNaN(when.getTime())) return "You can download your data once a day. Please try again tomorrow.";
  const options = timeZone ? { timeZone } : {};
  const time = when.toLocaleTimeString("en-GB", { ...options, hour: "2-digit", minute: "2-digit" });
  const day = when.toLocaleDateString("en-GB", { ...options, weekday: "long", day: "numeric", month: "long" });
  return `You can download your data once a day. Your next download is available from ${time} on ${day}.`;
}

// ── Photos in storage ───────────────────────────────────────────────────────
const PAGE = 1000;

// Every file under folder (and its subfolders) in a storage bucket, as full
// paths. bucket is supabase.storage.from(name). Folders are listed with no id.
export async function listUserFiles(bucket, folder) {
  const files = [];
  const pending = [String(folder).replace(/\/+$/, "")];
  while (pending.length) {
    const current = pending.shift();
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await bucket.list(current, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      for (const item of data || []) {
        const path = `${current}/${item.name}`;
        if (item.id == null) pending.push(path);
        else files.push(path);
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return files;
}

// Removes the files, 100 at a time. Throws on the first error.
export async function removeFiles(bucket, paths) {
  for (let start = 0; start < paths.length; start += 100) {
    const { error } = await bucket.remove(paths.slice(start, start + 100));
    if (error) throw error;
  }
}

// ── After deleting the account ──────────────────────────────────────────────
// Removes everything TRACK3D kept in this browser: local and session storage
// keys starting "track3d" (sign-in, drafts, preferences) and the drafts
// database. Errors are ignored: there may be no storage to clear.
export function clearLocalAppData({ local = globalThis.localStorage, session = globalThis.sessionStorage, indexedDb = globalThis.indexedDB } = {}) {
  for (const storage of [local, session]) {
    try {
      const keys = [];
      for (let index = 0; index < storage.length; index++) keys.push(storage.key(index));
      keys.filter(key => key && key.toLowerCase().startsWith("track3d")).forEach(key => storage.removeItem(key));
    } catch { /* storage unavailable */ }
  }
  try { indexedDb?.deleteDatabase("track3d-session-drafts"); } catch { /* not available */ }
}

// What delete_my_account() returned (or its error), in words, and whether
// anything was deleted. Text for 'ok' and 'deleted' is the caller's.
export function deleteAccountProblem(result, error) {
  if (error) {
    if (/delete_my_account|function|schema cache|PGRST202/i.test(`${error.message || ""} ${error.code || ""}`)) return "Deleting accounts needs a database update first. Nothing has been deleted.";
    return `Couldn't delete your account (${error.message || "connection problem"}). Nothing has been deleted.`;
  }
  if (result === "wrong_password") return "That password isn't right. Nothing has been deleted.";
  if (result === "too_many_attempts") return "Too many wrong passwords. Wait 15 minutes, then try again. Nothing has been deleted.";
  if (result === "not_signed_in") return "Please sign in again, then try again. Nothing has been deleted.";
  if (result === "photos_remaining") return "Some of your progress photos couldn't be deleted, so your account hasn't been deleted yet. Please try again.";
  return "";
}
