import { Fragment, useState, useRef, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { readDraft, useSessionDraft } from "../lib/session-drafts";
import { beginLoginWindow, loginWindowExpiry, clearLoginWindow } from "../lib/login-window";
import { resolveActivePain, streamCoachMessage } from "../lib/coaching/coach-client";
import { COACH_PERSONALITIES } from "../lib/coaching/personality";
import { normaliseExperience } from "../lib/coaching/system";
import { detectPersonalBest, evaluateProgression, inferIncrement } from "../lib/coaching/progression";
import { exerciseKey, saveStructuredWorkout } from "../lib/coaching/training-data";
import { applyCoachActionToProgramme, applyCoachActionToWorkout, coachProposal, proposalsOverlap } from "../lib/coaching/ui-actions";
import { applyPlanChangeProposal, applyPlanChangeToWorkout, describePlanChange, exerciseMatchesHistory, isApprovalReply, isPlanChangeRequest, planChangeSummary, planOutline } from "../lib/coaching/plan-change";
import { ACTIVITY_EFFORTS, ACTIVITY_TYPES, activityLogRow, activityOfLog, activitySession, activitySummary, activityTypeLabel, activeWorkoutLogIds, bestSetsSummary, buildLoggedExercises, buildWorkoutReview, improvementsSinceLastTime, isActivitySession, moveWorkoutDay, recentWorkoutsForCoach, recoverWorkoutState, sameJson, sessionPlannedMinutes, setsRepsSummary, loggedSetsSignature, isFinishedWorkout, setLoggerSuggestion, stepSetValue, sessionForDay, weeklyWorkoutProgress, workoutPersonalBests, workoutVolume, settledWorkoutDuration, workoutDurationMins } from "../lib/fitness-session";
import { isYesNoQuestion } from "../lib/coaching/quick-replies";
import { recentChatMessages } from "../lib/chat-limits";
import { extractJsonObject, questionnaireAnswersFromExtraction } from "../lib/coaching/questionnaire";
import { estimateSession, fitSessionToBudget, repTargets, requestedBudget, splitRepTargets } from "../lib/workout";
import { countsForMorningStreak, habitStreak, morningStreak, shiftDateKey, STREAK_MIN_MORNING_SCORE, streakBeforeToday } from "../lib/streaks";
import { ACHIEVEMENT_CATEGORIES, computeAchievements, unseenAchievements } from "../lib/achievements";
import { IMPORT_FILE_MAX_BYTES, importSourceText, isSupportedImportFile, normaliseImportedFitnessPlan } from "../lib/plan-import";
import { buildWeeklyMetrics, formatCoachSummary, isNewWeeklyReport, nutritionDayOnTarget, parseCoachSummary, reportWeek, weeklyFactsForCoach, weeklyFactsKey } from "../lib/weekly-report";
import { nextUpItems } from "../lib/next-up";
import { dailyScore } from "../lib/daily-score";
import { linkedHabitIds } from "../lib/habit-links";
import { EXPERIENCE_CHOICES, PREFER_NOT_TO_SAY_NOTE, PROFILE_SEX, ageFromDateOfBirth, formatDateOfBirth, isProfileComplete, missingProfileFields, normaliseProfile, profileChanges, profileProblem, profileSaveError, profileUpdate, sexLabel } from "../lib/profile";
import { ACTIVITY_LEVELS, AI_NUTRITION_QUESTIONS, NUTRITION_GOALS, SEX_OPTIONS, allergyConflictText, allergyRule, applyMealTimes, calculateNutritionTargets, mealAllergyConflicts, mealTimeSlots, normaliseNutritionGoal, parseAllergies, preferencesText, setupStatsProblem, suggestActivityLevel, targetUpdateSuggestion } from "../lib/nutrition-setup";
import { QUICK_FOODS, addExtraFood, addOffPlanMacros, calculateLoggedNutrition, mealSwap, swappedMealResult, countCompletedMeals, dayTargets, hasRestDayMeals, inferNutritionStyle, isMealAnswered, unloggedFoodFromLog, mealPlanGapText, mealPlanTargetCheck, mealsForDay, nextReviewStep, nutritionLogFields, offPlanNutrition, restDayCalories, sumFoodEstimate, unloggedFood, isFlexibleMeal, mergeMealLibrary, prepareNutritionMeals, remainingNutritionTargets } from "../lib/nutrition-plan";
import { EATING_SUPPORT_TEXT, calorieFloor, calorieTargetProblem, mealPlanFloorProblem, weeklyLossWarning } from "../lib/nutrition-safety";
import { HEALTH_CONSENT_TEXT, HEALTH_CONSENT_VERSION, clearLocalAppData, deleteAccountProblem, exportFileName, exportFiles, exportLimitText, healthConsentStatus, listUserFiles, removeFiles } from "../lib/account";
import { createZip } from "../lib/zip";

// ─── Shared reads ─────────────────────────────────────────────────────────────
// On start the dashboard, the hidden Morning and Fitness tabs and the weekly
// report all load at once. A read made while the same read is still in
// flight shares that request, so each row is fetched once per load.
const readsInFlight = new Map();
const cloneData = value => (value == null ? value : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
function sharedRead(key, run) {
  let request = readsInFlight.get(key);
  if (!request) {
    request = Promise.resolve().then(run);
    readsInFlight.set(key, request);
    const clear = () => { if (readsInFlight.get(key) === request) readsInFlight.delete(key); };
    request.then(clear, clear);
  }
  // Each screen gets its own copy, so one can't change another's data.
  return request.then(result => ({ ...result, data: cloneData(result?.data) }));
}
// One row per user; maybeSingle, so a missing row is null rather than a 406.
const readOwnRow = (table, userId) => sharedRead(`${table}:${userId}`, () => supabase.from(table).select("*").eq("user_id", userId).maybeSingle());
const readWorkoutSplit = userId => readOwnRow("workout_splits", userId);
const readMorningRoutine = userId => readOwnRow("morning_routines", userId);
const readNutritionPlan = userId => readOwnRow("nutrition_plans", userId);
const readCoachProfile = userId => readOwnRow("coach_profiles", userId);
const readUserProfile = userId => readOwnRow("user_profiles", userId);
const readHabits = userId => sharedRead(`habits:${userId}`, () => supabase.from("habits").select("*").eq("user_id", userId).order("created_at", { ascending: true }));
const readHabitCompletions = (userId, from, to) => sharedRead(`habit_completions:${userId}:${from}:${to}`, () => supabase.from("habit_completions").select("habit_id,date").eq("user_id", userId).gte("date", from).lte("date", to));

// /api/chat requires the signed-in user's Supabase session token.
async function chatHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
}

// Streams a coach conversation reply from /api/chat, calling onText with the
// text so far as it arrives. Falls back to a normal JSON reply. Throws on
// failure, including a failure part-way through the stream.
async function streamCoachText(payload, onText = () => {}) {
  const res = await fetch("/api/chat", { method: "POST", headers: await chatHeaders(), body: JSON.stringify({ ...payload, stream: true }) });
  if (!res.ok || !res.body || res.headers.get("X-Coach-Stream") !== "1") {
    const text = await readCoachReply(res);
    onText(text);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    const errorAt = text.indexOf("\u0000ERROR:");
    if (errorAt >= 0) throw new Error(text.slice(errorAt + 7) || "the coach reply was cut off");
    onText(text);
  }
  if (!text.trim()) throw new Error("the coach sent an empty reply");
  return text.trim();
}

// The text of a coach reply. Throws when the request failed or the reply is
// empty, so a screen never shows canned text as if the coach had written it.
async function readCoachReply(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `the coach is unavailable (${res.status})`);
  const text = (data.content || []).map(block => block.text || "").join("").trim();
  if (!text) throw new Error("the coach sent an empty reply");
  return text;
}

const NEON = "#00FFB2";
const EXPERIENCE_OPTIONS = [["beginner", "BEGINNER"], ["intermediate", "INTERMEDIATE"], ["advanced", "ADVANCED"]];
const NEON2 = "#00C8FF";
const NEON3 = "#FF2D78";
const BG = "#080C10";
const SURFACE = "#0D1318";
const SURFACE2 = "#111921";
const BORDER = "#1A2530";

const DEFAULT_HOME_TIME_ZONE = "Europe/London";

const resolveHomeTimeZone = (user) => {
  const candidate = user?.user_metadata?.timezone || user?.user_metadata?.time_zone || DEFAULT_HOME_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_HOME_TIME_ZONE;
  }
};

const getZonedDateInfo = (date = new Date(), timeZone = DEFAULT_HOME_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    dayCode: parts.weekday.slice(0, 3).toUpperCase(),
    time: `${parts.hour}:${parts.minute}`,
  };
};

// Today's date (YYYY-MM-DD) in the user's home timezone, optionally shifted
// by whole days. Use this rather than the device clock's local date.
const homeDateKey = (user, offsetDays = 0) => shiftDateKey(getZonedDateInfo(new Date(), resolveHomeTimeZone(user)).dateKey, offsetDays);
// Labels for a YYYY-MM-DD key, independent of the device timezone.
const dateKeyLabel = (dateKey, options) => new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
const dateKeyDayCode = dateKey => ["SUN","MON","TUE","WED","THU","FRI","SAT"][new Date(`${dateKey}T12:00:00Z`).getUTCDay()];

function useZonedDateKey(timeZone) {
  const [dateKey, setDateKey] = useState(() => getZonedDateInfo(new Date(), timeZone).dateKey);
  useEffect(() => {
    const update = () => setDateKey(getZonedDateInfo(new Date(), timeZone).dateKey);
    update();
    const timer = setInterval(update, 5000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [timeZone]);
  return dateKey;
}

const INITIAL_HABITS = [];
const POPULAR_DAILY_HABITS = [
  { name: "Drink enough water", category: "health" },
  { name: "Go for a walk", category: "fitness" },
  { name: "Read for 10 minutes", category: "growth" },
  { name: "Stretch or move", category: "fitness" },
  { name: "Meditate for 5 minutes", category: "mindset" },
  { name: "Plan tomorrow", category: "growth" },
];

const mealWasCompleted = value => value === true || value?.completed === true;
const mealWasMissed = value => value === false || value?.completed === false;
const completedMealCount = results => Object.entries(results || {}).filter(([key, value]) => key !== "_review_complete" && mealWasCompleted(value)).length;
const cleanAiText = value => String(value || "")
  .replace(/^\s*(?:\*+|-{3,}|_{3,})\s*$/gm, "")
  .replace(/\*\*(.*?)\*\*/g, "$1")
  .replace(/\*\*/g, "")
  .replace(/__(.*?)__/g, "$1")
  .replace(/^\s*#{1,6}\s*/gm, "")
  .replace(/^\s*\*\s+/gm, "• ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const WORKOUTS = [
  { name: "Bench Press", sets: "4x8", weight: "185 lbs", type: "PUSH" },
  { name: "Incline DB Press", sets: "3x10", weight: "70 lbs", type: "PUSH" },
  { name: "Cable Flies", sets: "3x15", weight: "40 lbs", type: "PUSH" },
  { name: "Tricep Pushdown", sets: "3x12", weight: "55 lbs", type: "ARMS" },
  { name: "Overhead Ext.", sets: "3x10", weight: "65 lbs", type: "ARMS" },
];

const MEALS = [
  { name: "Chicken & Rice", time: "7:30 AM", cals: 480, p: 42, c: 55, f: 8 },
  { name: "Protein Shake", time: "10:00 AM", cals: 220, p: 40, c: 10, f: 3 },
  { name: "Salmon + Greens", time: "1:00 PM", cals: 560, p: 48, c: 22, f: 18 },
  { name: "Greek Yogurt", time: "4:00 PM", cals: 150, p: 17, c: 12, f: 3 },
];

const TOTAL_C = MEALS.reduce((a, m) => a + m.c, 0);
const TOTAL_F = MEALS.reduce((a, m) => a + m.f, 0);

const heatColor = (v) => {
  if (v === 0) return BORDER;
  if (v === 1) return "rgba(0,255,178,0.15)";
  if (v === 2) return "rgba(0,255,178,0.35)";
  if (v === 3) return "rgba(0,255,178,0.6)";
  return NEON;
};

const SUGGESTED_TASKS = [
  { name: "Brush teeth", duration: 2, type: "tick" },
  { name: "Drink water", duration: 2, type: "tick" },
  { name: "Have breakfast", duration: 15, type: "tick" },
  { name: "Have a shower", duration: 15, type: "tick" },
  { name: "Take supplements", duration: 2, type: "tick" },
  { name: "Stretch / Mobility", duration: 15, type: "tick" },
  { name: "Go for a walk", duration: 30, type: "tick" },
  { name: "Meditate", duration: 10, type: "tick" },
  { name: "Review goals for the day", duration: 5, type: "tick" },
  { name: "Read", duration: 20, type: "tick" },
];

const MORNING_QUOTES = [
  "Well done. The hardest part is showing up — go smash it.",
  "Another morning won. Now go make the rest of the day count.",
  "You started right. Carry that energy forward.",
  "Discipline in the morning, freedom in the afternoon.",
  "Small wins stack. You just added one. Keep going.",
];

const css = `
  .t3d * { box-sizing: border-box; margin: 0; padding: 0; }
  .t3d { display: flex; min-height: 100vh; background: #080C10; color: #E0EAF0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  .t3d input, .t3d select, .t3d textarea { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important; }
  .t3d-sidebar { width: 210px; background: #0D1318; border-right: 1px solid #1A2530; display: flex; flex-direction: column; padding: 28px 0; flex-shrink: 0; }
  .t3d-logo { font-family: 'Orbitron', monospace; font-weight: 900; font-size: 20px; letter-spacing: 4px; padding: 0 22px 28px; background: linear-gradient(90deg,#00FFB2,#00C8FF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-align: center; }
  .t3d-logo small { font-size: 9px; letter-spacing: 1px; display: block; -webkit-text-fill-color: #FFFFFF; color: #FFFFFF; margin-top: 4px; font-weight: 400; text-align: center; }
  .t3d-nav { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 22px; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 500; letter-spacing: .7px; text-align: left; color: #E0EAF0; background: none; border: 0; border-left: 2px solid transparent; transition: all .18s; }
  .t3d-nav:focus-visible, .t3d-bnav-item:focus-visible, .t3d-btn:focus-visible { outline: 2px solid #00C8FF; outline-offset: 2px; }
  .t3d-nav:focus-visible { outline-offset: -2px; }
  .t3d-nav:hover { color: #8AABB8; background: rgba(0,255,178,.04); }
  .t3d-nav.on { color: #00FFB2; border-left-color: #00FFB2; background: rgba(0,255,178,.06); }
  .t3d-nav-icon { width: 18px; text-align: center; font-size: 14px; }
  .t3d-sfooter { margin-top: auto; padding: 22px; font-size: 11px; color: #607784; letter-spacing: .6px; line-height: 1.6; }
  .t3d-main { flex: 1; padding: 28px 28px 48px; min-width: 0; overflow-y: auto; }
  @media (max-width: 768px) {
    .t3d-sidebar { display: none !important; }
    .t3d-main { padding: 16px 16px 80px; }
    .t3d-grid3 { grid-template-columns: repeat(2,1fr); }
    .t3d-grid12 { grid-template-columns: 1fr; }
    .t3d-grid2 { grid-template-columns: 1fr; }
  }
  .t3d-set-input { width: 80px; height: 80px; background: #E0EAF0; border: none; border-radius: 8px; font-size: 28px; font-weight: 700; text-align: center; color: #080C10; outline: none; }
  .t3d-set-confirm { width: 60px; height: 60px; background: #00FFB2; border: none; border-radius: 8px; font-size: 24px; cursor: pointer; color: #080C10; font-weight: 700; }
  @media (max-width: 768px) {
    .t3d-workout-card { padding: 16px 10px !important; }
    .t3d-set-input { width: 38vw; height: 38vw; max-width: 150px; max-height: 150px; font-size: 38px; }
    .t3d-set-confirm { width: 76px; height: 76px; font-size: 30px; }
  }
  .t3d-bottom-nav { display: none; }
  @media (max-width: 768px) {
    .t3d-bottom-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: #0D1318; border-top: 1px solid #1A2530; padding: 8px 0 12px; z-index: 50; justify-content: space-around; align-items: center; }
  }
  .t3d-bnav-item { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; padding: 4px 12px; border-radius: 8px; transition: all .18s; color: #E0EAF0; font-family: 'Orbitron', sans-serif; font-size: 8px; letter-spacing: .8px; border: none; background: transparent; }
  .t3d-bnav-item.on { color: #00FFB2; }
  .t3d-bnav-icon { font-size: 20px; }
  .t3d-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; }
  .t3d-title { margin: 0; font-family: 'Orbitron', monospace; font-size: 18px; font-weight: 700; letter-spacing: 3px; }
  .t3d-date { font-size: 11px; color: #B4C5CC; letter-spacing: 1.4px; margin-top: 4px; }
  .t3d-dot { width: 8px; height: 8px; border-radius: 50%; background: #00FFB2; box-shadow: 0 0 8px #00FFB2; animation: t3dpulse 2s infinite; }
  @keyframes t3dpulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes t3dfade { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
  /* No "forwards" fill: a held transform makes fixed popups position against
     the section instead of the screen, so they opened off-screen when scrolled. */
  .t3d-fade { animation: t3dfade .35s ease; }
  @keyframes t3dcheckpop { 0%{opacity:0;transform:scale(.6)} 60%{opacity:1;transform:scale(1.08)} 100%{transform:scale(1)} }
  @keyframes t3dring { 0%{opacity:.7;transform:scale(.9)} 100%{opacity:0;transform:scale(1.7)} }
  .t3d-done-badge { position: relative; width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 50%; border: 2px solid #00FFB2; display: flex; align-items: center; justify-content: center; font-size: 28px; color: #00FFB2; box-shadow: 0 0 24px rgba(0,255,178,.25); animation: t3dcheckpop .6s cubic-bezier(.16,1,.3,1); }
  .t3d-done-badge::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid #00FFB2; opacity: 0; animation: t3dring 1.1s ease-out .2s 2; }
  .t3d-reveal { animation: t3dfade .45s ease backwards; }
  @media (prefers-reduced-motion: reduce) { .t3d-done-badge, .t3d-done-badge::after, .t3d-reveal { animation: none; } }
  .t3d-grid3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 16px; }
  .t3d-grid2 { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; margin-bottom: 16px; }
  .t3d-grid12 { display: grid; grid-template-columns: 1fr 2fr; gap: 14px; margin-bottom: 16px; }
  body.t3d-workout-active { overflow: hidden; overscroll-behavior: none; }
  body.t3d-workout-active .t3d { height: 100dvh; min-height: 0; overflow: hidden; }
  /* The page stays locked during a workout, but the workout area itself can
     scroll so the coach below it is reachable on short phone screens. */
  body.t3d-workout-active .t3d-main { height: 100dvh; overflow-y: auto; overscroll-behavior: contain; }
  body.t3d-workout-active .t3d-header { display: none; }
  body.t3d-workout-active .t3d-bottom-nav { display: none !important; }
  .t3d-workout-screen { height: 100%; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
  .t3d-workout-screen .t3d-workout-card { flex: 1; min-height: 0; overflow: hidden; padding: 14px 18px; }
  .t3d-compact-coach { flex: 0 0 190px; height: 190px !important; max-height: 190px; overflow: hidden; }
  .t3d-compact-coach.t3d-coach-expanded { position: fixed; inset: 10px; z-index: 180; width: auto; height: auto !important; max-height: none; overflow: hidden; box-shadow: 0 0 0 9999px rgba(0,0,0,.88); }
  @media (max-width: 768px) {
    body.t3d-workout-active .t3d-main { padding: 10px; }
    .t3d-workout-screen { gap: 7px; }
    .t3d-workout-screen .t3d-workout-card { padding: 10px !important; }
    .t3d-compact-coach { flex-basis: 190px; height: 190px !important; max-height: 190px; }
    .t3d-compact-coach.t3d-coach-expanded { inset: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom)); height: auto !important; max-height: none; }
  }
  .t3d-card { background: #0D1318; border: 1px solid #1A2530; border-radius: 8px; padding: 20px; position: relative; overflow: hidden; }
  .t3d-card::before { content:''; position:absolute; top:0;left:0;right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(0,255,178,.25),transparent); }
  .t3d-ctitle { font-family: 'Orbitron', sans-serif; font-size: 10px; font-weight: 600; letter-spacing: 2px; color: #6F8792; text-transform: uppercase; margin-top: 0; margin-bottom: 14px; line-height: 1.45; }
  .t3d-sval { font-family: 'Orbitron', monospace; font-size: 30px; font-weight: 700; margin: 6px 0 3px; }
  .t3d-slabel { font-size: 11px; color: #C6D3D8; letter-spacing: .6px; }
  .t3d-sdelta { font-size: 10px; margin-top: 8px; }
  .t3d-up { color: #00FFB2; } .t3d-dn { color: #FF2D78; }
  .t3d-pbar { height: 4px; background: #1A2530; border-radius: 2px; overflow: hidden; margin-top: 10px; }
  .t3d-pfill { height: 100%; border-radius: 2px; transition: width .8s cubic-bezier(.16,1,.3,1); }
  .t3d-hrow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1A2530; cursor: pointer; }
  .t3d-hrow:last-child { border-bottom: none; }
  .t3d-hcheck { width: 20px; height: 20px; border-radius: 4px; border: 1px solid #1A2530; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; transition: all .18s; }
  .t3d-hcheck.done { background: rgba(0,255,178,.1); border-color: #00FFB2; color: #00FFB2; }
  .t3d-hname { flex: 1; font-size: 12px; line-height: 1.45; }
  .t3d-hstreak { font-family: 'Orbitron', monospace; font-size: 10px; color: #E0EAF0; }
  .t3d-hstreak.fire { color: #FF8C00; }
  .t3d-hmap { display: grid; grid-template-columns: repeat(7,1fr); gap: 4px; margin-top: 8px; }
  .t3d-hcell { aspect-ratio:1; border-radius: 2px; transition: transform .15s; cursor: pointer; }
  .t3d-hcell:hover { transform: scale(1.25); }
  .t3d-witem { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1A2530; font-size: 11px; }
  .t3d-witem:last-child { border-bottom: none; }
  .t3d-wtag { font-family: 'Orbitron', monospace; font-size: 8px; letter-spacing: 1px; padding: 3px 7px; border-radius: 3px; flex-shrink: 0; background: rgba(0,255,178,.07); color: #00FFB2; border: 1px solid rgba(0,255,178,.2); }
  .t3d-mrow { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .t3d-mlbl { font-size: 10px; width: 65px; letter-spacing: 1px; }
  .t3d-mbar { flex: 1; height: 5px; background: #1A2530; border-radius: 3px; overflow: hidden; }
  .t3d-mfill { height: 100%; border-radius: 3px; transition: width .8s cubic-bezier(.16,1,.3,1); }
  .t3d-mval { font-family: 'Orbitron', monospace; font-size: 10px; width: 65px; text-align: right; }
  .t3d-btn { background: rgba(0,255,178,.07); border: 1px solid rgba(0,255,178,.32); color: #00FFB2; font-family: 'Orbitron', sans-serif; font-size: 10px; font-weight: 600; letter-spacing: 1.25px; line-height: 1.35; padding: 9px 16px; border-radius: 5px; cursor: pointer; transition: all .18s; white-space: nowrap; }
  .t3d-btn:hover { background: rgba(0,255,178,.14); }
  .t3d-btn:disabled { opacity: .35; cursor: not-allowed; }
  .t3d-btn-sm { padding: 6px 12px; font-size: 9px; }
  .t3d-btn-red { background: rgba(255,45,120,.07); border-color: rgba(255,45,120,.25); color: #FF2D78; }
  /* Phones and touch screens: every button and box is at least a 44px tap. */
  @media (pointer: coarse), (max-width: 768px) { .t3d-btn, .t3d-bnav-item, .t3d-input, .t3d-ai-input { min-height: 44px; } }
  .t3d-ai-msg { margin-bottom: 8px; padding: 10px 13px; border-radius: 6px; font-size: 12px; line-height: 1.55; animation: t3dfade .3s ease; }
  .t3d-ai-tag { font-family: 'Orbitron', monospace; font-size: 8px; letter-spacing: 2px; margin-bottom: 5px; }
  .t3d-ai-input { flex: 1; background: #111921; border: 1px solid #31434F; border-radius: 5px; padding: 10px 12px; color: #E0EAF0; font-size: 12px; outline: none; transition: border-color .18s; }
  .t3d-ai-input:focus { border-color: rgba(0,255,178,.35); }
  /* iOS zooms into inputs under 16px; keep coach inputs at 16px on phones. */
  @media (max-width: 768px) { .t3d-ai-input { font-size: 16px; } }
  .t3d-ai-input::placeholder { color: #607784; }
  .t3d-compact-coach .t3d-ai-input::placeholder { color: #6F8792; }
  .t3d-compact-coach .t3d-ai-msg { padding: 8px 10px; margin-bottom: 6px; line-height: 1.6; font-size: 12px; }
  .t3d-rough-checkin { padding-bottom: 8px; }
  @keyframes t3dblink { 0%,100%{opacity:1} 50%{opacity:0} }
  .t3d-cursor::after { content:'|'; animation: t3dblink .7s infinite; color: #00FFB2; }
  .t3d-input { background: #111921; border: 1px solid #31434F; border-radius: 5px; padding: 10px 12px; color: #E0EAF0; font-size: 13px; line-height: 1.4; outline: none; transition: border-color .18s; width: 100%; }
  .t3d-input:focus { border-color: rgba(0,255,178,.35); }
  .t3d-input::placeholder { color: #1E2E3A; }
  .t3d-input.t3d-minutes::placeholder { color: #8AABB8; }
  .t3d-checkin-step { min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px; }
  .t3d-big-btn { width: 100%; padding: 18px; font-family: 'Orbitron', monospace; font-size: 13px; letter-spacing: 3px; border-radius: 8px; cursor: pointer; transition: all .2s; border: none; }
  .t3d-tick-btn { background: rgba(0,255,178,.1); border: 2px solid #00FFB2; color: #00FFB2; padding: 16px 32px; font-family: 'Orbitron', monospace; font-size: 20px; border-radius: 8px; cursor: pointer; transition: all .2s; margin: 8px; }
  .t3d-tick-btn:hover { background: rgba(0,255,178,.2); transform: scale(1.05); }
  .t3d-cross-btn { background: rgba(255,45,120,.1); border: 2px solid #FF2D78; color: #FF2D78; padding: 16px 32px; font-family: 'Orbitron', monospace; font-size: 20px; border-radius: 8px; cursor: pointer; transition: all .2s; margin: 8px; }
  .t3d-cross-btn:hover { background: rgba(255,45,120,.2); transform: scale(1.05); }
  .t3d-task-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 8px 14px; border-radius: 20px; font-family: inherit; font-size: 11px; letter-spacing: 1px; cursor: pointer; border: 1px solid #31434F; background: #111921; color: #C5D6DC; margin: 4px; transition: all .18s; }
  .t3d-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .t3d-task-chip.selected { border-color: #00FFB2; background: rgba(0,255,178,.08); color: #00FFB2; }
  .t3d-task-chip:hover { border-color: #E0EAF0; color: #8AABB8; }
  .t3d-progress-dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 24px; }
  .t3d-dot-step { width: 8px; height: 8px; border-radius: 50%; background: #1A2530; transition: all .3s; }
  .t3d-dot-step.active { background: #00FFB2; box-shadow: 0 0 6px #00FFB2; }
  .t3d-dot-step.done { background: rgba(0,255,178,.4); }
`;

// ─── Score Ring ───────────────────────────────────────────────────────────────
// Decorative task icon with a trailing space; "▸" (stored on older custom
// tasks) looked tappable, so it is not shown.
const taskIcon = task => task?.icon && task.icon !== "▸" ? `${task.icon} ` : "";

// Check-in data keys that are flags or timing, not tasks.
const HIDDEN_CHECKIN_KEYS = new Set(["wakeTiming", "routineTiming", "inProgress", "roughCheckin", "routineSkipped", "skipReason", "recordedAt", "loggedAfter", "checkin", "photos", "scoreBasis"]);

// Thumbnails for a check-in's stored progress photos (placeholders such as
// "skipped" or "deferred" are not files).
function CheckinPhotoThumbs({ photos }) {
  const paths = Object.entries(photos || {}).filter(([, value]) => typeof value === "string" && value.includes("/"));
  const pathKey = paths.map(([, path]) => path).join("|");
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let cancelled = false;
    paths.forEach(([angle, path]) => {
      supabase.storage.from("checkin-photos").createSignedUrl(path, 3600)
        .then(({ data }) => { if (!cancelled && data?.signedUrl) setUrls(current => ({ ...current, [angle]: data.signedUrl })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);
  if (!paths.length) return <div style={{ fontSize: 10, color: "#6F8792" }}>No progress photos saved for this day.</div>;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {paths.map(([angle]) => (
        <figure key={angle} style={{ margin: 0, textAlign: "center" }}>
          {urls[angle]
            ? <img src={urls[angle]} alt={`${angle} progress photo`} style={{ width: 72, height: 90, objectFit: "cover", borderRadius: 6, border: `1px solid ${BORDER}` }} />
            : <div style={{ width: 72, height: 90, borderRadius: 6, border: `1px solid ${BORDER}`, background: SURFACE2 }} />}
          <figcaption style={{ fontSize: 8, color: "#8AABB8", marginTop: 3 }}>{angle.toUpperCase()}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// Weight is stored in kg; stone and pounds are converted on entry.
const KG_PER_LB = 0.45359237;
function WeightEntry({ kgValue, onKgChange, unit, onUnitChange }) {
  const totalLb = Number(kgValue) > 0 ? Number(kgValue) / KG_PER_LB : 0;
  const [stone, setStone] = useState(totalLb ? String(Math.floor(totalLb / 14)) : "");
  const [pounds, setPounds] = useState(totalLb ? String(Math.round((totalLb % 14) * 10) / 10) : "");
  const updateImperial = (nextStone, nextPounds) => {
    setStone(nextStone);
    setPounds(nextPounds);
    const lb = (Number(nextStone) || 0) * 14 + (Number(nextPounds) || 0);
    onKgChange(lb > 0 ? String(Math.round(lb * KG_PER_LB * 10) / 10) : "");
  };
  const unitButton = (value, label) => (
    <button type="button" className="t3d-btn t3d-btn-sm" aria-pressed={unit === value} onClick={() => onUnitChange(value)}
      style={{ flex: 1, minHeight: 44, borderColor: unit === value ? NEON : BORDER, color: unit === value ? NEON : "#8AABB8" }}>{label}</button>
  );
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>{unitButton("kg", "KG")}{unitButton("st", "STONE & LB")}</div>
      {unit === "st" ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="t3d-input" type="number" inputMode="numeric" aria-label="Stone" placeholder="st" value={stone}
            onChange={e => updateImperial(e.target.value, pounds)} style={{ textAlign: "center", fontSize: 22, padding: 14 }} />
          <span style={{ color: "#E0EAF0", fontSize: 13 }}>st</span>
          <input className="t3d-input" type="number" inputMode="decimal" aria-label="Pounds" placeholder="lb" value={pounds}
            onChange={e => updateImperial(stone, e.target.value)} style={{ textAlign: "center", fontSize: 22, padding: 14 }} />
          <span style={{ color: "#E0EAF0", fontSize: 13 }}>lb</span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="t3d-input" type="number" inputMode="decimal" aria-label="Weight in kg" placeholder="Enter kg..." value={kgValue}
            onChange={e => onKgChange(e.target.value)} style={{ textAlign: "center", fontSize: 24, padding: 16 }} />
          <span style={{ color: "#E0EAF0", fontSize: 14 }}>kg</span>
        </div>
      )}
      {unit === "st" && kgValue && <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 6, textAlign: "center" }}>Saved as {kgValue} kg</div>}
    </div>
  );
}

function ScoreRing({ score, size = 108, max = 100 }) {
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  const fraction = max ? score / max : 0;
  const offset = circ * (1 - fraction);
  const color = fraction >= 0.7 ? NEON : fraction >= 0.4 ? "#FF8C00" : NEON3;
  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={BORDER} strokeWidth="6" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
          strokeWidth="6" strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)", filter: `drop-shadow(0 0 5px ${color})` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 26, fontWeight: 700, lineHeight: 1, color }}>{score}</div>
        <div style={{ fontSize: 9, letterSpacing: 1, color: "#8AABB8", marginTop: 5 }}>OUT OF {max}</div>
      </div>
    </div>
  );
}

// ─── Proposed change card ─────────────────────────────────────────────────────
// A plan change the coach proposed, shown directly under the coach's message
// with what it changes (before → after). Nothing is saved until APPROVE &
// SAVE. While it waits it scrolls into view and stays pinned in sight in the
// chat (sticky), so it can't be missed. status: pending, saving, saved,
// discarded, replaced or unusable. highlight: bump to bring it back into view.
function ProposedChangeCard({ lines = [], notes = [], status = "pending", error = "", onApprove, onDiscard, highlight = 0 }) {
  const ref = useRef(null);
  const waiting = status === "pending" || status === "saving";
  useEffect(() => {
    if (status === "pending") ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [status, highlight]);
  const outcome = {
    saved: { text: "Saved to your plan ✓", color: NEON },
    discarded: { text: "Discarded: your plan hasn't changed.", color: "#8AABB8" },
    replaced: { text: "Replaced by the newer proposal below. This one wasn't saved.", color: "#8AABB8" },
    unusable: { text: "Nothing to save: those sessions or exercises aren't in your plan.", color: "#FFB547" },
  }[status];
  return (
    <div ref={ref} role="group" aria-label="Proposed change" data-testid="proposed-change" data-status={status}
      style={{ ...(waiting ? { position: "sticky", top: 0, bottom: 0, zIndex: 2 } : {}), margin: "0 0 10px", padding: 12, borderRadius: 7, background: waiting ? "#18170F" : SURFACE2, border: `1px solid ${waiting ? "rgba(255,181,71,.6)" : BORDER}`, boxShadow: waiting ? "0 6px 18px rgba(0,0,0,.55)" : "none" }}>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, fontWeight: 700, color: waiting ? "#FFB547" : "#8AABB8", letterSpacing: 1, marginBottom: 7 }}>Proposed change</div>
      {lines.map((line, index) => <div key={index} data-testid="proposed-change-line" style={{ fontSize: 12, color: "#E0EAF0", lineHeight: 1.5, marginBottom: 3, overflowWrap: "anywhere" }}>{line}</div>)}
      {notes.map((note, index) => <div key={index} style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.5, marginTop: 5 }}>{note}</div>)}
      {error && <div role="alert" style={{ fontSize: 10, color: NEON3, lineHeight: 1.5, marginTop: 6 }}>{error}</div>}
      {waiting ? (
        <>
          <div style={{ fontSize: 9, color: "#8AABB8", margin: "8px 0" }}>Not saved yet.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="t3d-btn" style={{ flex: 1, borderColor: NEON, background: "rgba(0,255,178,.12)" }} disabled={status === "saving"} onClick={onApprove}>{status === "saving" ? "SAVING..." : "APPROVE & SAVE"}</button>
            <button type="button" className="t3d-btn t3d-btn-red" style={{ flex: 1 }} disabled={status === "saving"} onClick={onDiscard}>DISCARD</button>
          </div>
        </>
      ) : outcome && <div role="status" style={{ fontSize: 10, color: outcome.color, marginTop: 6 }}>{outcome.text}</div>}
    </div>
  );
}

// ─── AI Coach ─────────────────────────────────────────────────────────────────
// Error replies are shown but never kept in the chat history. These are ones
// earlier versions kept, removed when a saved chat is opened.
const STALE_COACH_ERRORS = /^(Coach returned an invalid response\.?|Coach is unavailable( right now)?\.?( Your workout is still saved\.)?|Connection error\. Check your internet connection and try again\.|The coach couldn't answer that just now\. Please try again\.|The coach reply was cut off\. Please try again\.)$/;

// planSessions: the whole saved plan, to describe a proposed change before →
// after (coachContext may hold only today's session).
function AICoach({ dayContext, area = "dashboard", context, onOpenChangePlan, title, introduction, activationLabel, openingMessage, compact = false, onAction, onMemoryUpdate, storageKey, pendingPrompt, onConsumedPrompt, coachingV12 = false, coachContext, onStructuredAction, openWithoutPrompt = false, planSessions = null }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [restored, setRestored] = useState(!storageKey);
  const [actions, setActions] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [painActive, setPainActive] = useState(false); // an unresolved pain report shapes the coach's replies
  const [painNote, setPainNote] = useState("");
  const [proposalHighlight, setProposalHighlight] = useState(0); // brings a waiting Proposed change card back into view

  const endRef = useRef(null);
  const messageListRef = useRef(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`track3d-coach-${storageKey}`) || "null");
      // Error replies aren't restored; the rest keep their changes under them.
      const kept = (Array.isArray(saved?.messages) ? saved.messages : []).map((message, index) => ({ message, index }))
        .filter(({ message }) => !message?.error && !STALE_COACH_ERRORS.test(String(message?.content || "").trim()));
      const position = new Map(kept.map((item, index) => [item.index, index]));
      if (Array.isArray(saved?.messages)) setMessages(kept.map(item => item.message));
      // Proposed changes stay under their messages until approved or discarded.
      if (Array.isArray(saved?.actions)) setActions(saved.actions.filter(action => action?.scope === "permanent" && position.has(action.messageIndex)).map(({ deciding: _deciding, ...action }) => ({ ...action, messageIndex: position.get(action.messageIndex) })));
      if (saved?.started || saved?.messages?.length) setStarted(true);
    } catch { /* Ignore an unreadable local draft. */ }
    setRestored(true);
  }, [storageKey]);

  // Coach style and training experience are set once, in the profile. A
  // change there mid-chat leaves a note here and goes with the next message.
  useEffect(() => {
    const changed = event => setMessages(current => (current.some(message => message.role === "user" || message.role === "assistant") ? [...current, { role: "note", content: event.detail?.note || "Coach settings changed" }] : current));
    window.addEventListener("track3d-coach-settings", changed);
    return () => window.removeEventListener("track3d-coach-settings", changed);
  }, []);

  useEffect(() => {
    if (!storageKey || !restored) return;
    // Error replies aren't kept, so each change is saved against its
    // message's place among the messages that are.
    const position = new Map();
    const kept = [];
    messages.forEach((message, index) => { if (!message.error) { position.set(index, kept.length); kept.push(message); } });
    const keptActions = actions.filter(action => action.scope === "permanent" && position.has(action.messageIndex)).map(action => ({ ...action, messageIndex: position.get(action.messageIndex) }));
    localStorage.setItem(`track3d-coach-${storageKey}`, JSON.stringify({ started, messages: kept, actions: keptActions }));
  }, [storageKey, restored, started, messages, actions]);

  const scroll = () => messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });

  const send = async (msg, { hidden = false } = {}) => {
    if (!msg.trim() || loading) return;
    // Close the phone keyboard so the screen returns to its normal size.
    document.activeElement?.blur?.();
    // "I approve" in words: only the card saves, so point to it.
    if (coachingV12 && !hidden && isApprovalReply(msg) && actions.some(action => action.scope === "permanent" && action.status === "pending_approval" && action.changed !== false)) {
      setMessages([...messages, { role: "user", content: msg }, { role: "assistant", content: "That change isn't saved yet. Tap APPROVE & SAVE on the Proposed change card to save it, or DISCARD to keep your plan as it is." }]);
      setInput("");
      if (compact) setExpanded(true);
      setProposalHighlight(count => count + 1);
      setTimeout(scroll, 50);
      return;
    }
    setLoading(true);
    const updated = [...messages, { role: "user", content: msg, ...(hidden ? { hidden: true } : {}) }];
    setMessages(updated);
    setInput("");
    setTimeout(scroll, 50);
    // A style or level change since the last reply goes with the message, so
    // the coach answers in the new style instead of repeating its last answer.
    const lastReply = messages.map(message => message.role).lastIndexOf("assistant");
    const changes = messages.slice(lastReply + 1).filter(message => message.role === "note").map(message => message.content);
    const sentMsg = changes.length ? `(${changes.join("; ")}. Answer in this style and level, in fresh words.)\n${msg}` : msg;
    const apiHistory = [...messages, { role: "user", content: sentMsg }];
    try {
      if (coachingV12) {
        const data = await streamCoachMessage(sentMsg, conversationId, coachContext, partial => {
          setMessages([...updated, { role: "assistant", content: partial }]);
          scroll();
        });
        setConversationId(data.conversationId);
        // Each change sits under the reply that proposed it. Permanent changes
        // stay until approved or discarded (a newer one for the same exercise
        // or session replaces a waiting one); temporary ones last until the
        // next reply. A permanent change's card (before → after) is worked
        // out now, from the plan as it is before anything is saved.
        const incoming = (data.actions || []).map(action => {
          const typed = { ...action, type: action.type || action.action_type, messageIndex: updated.length };
          return typed.scope === "permanent" ? { ...typed, ...coachProposal(planSessions || coachContext?.programme, typed) } : typed;
        });
        setActions(current => [
          ...current.filter(action => action.scope === "permanent").map(action => (action.status === "pending_approval" && incoming.some(next => next.scope === "permanent" && proposalsOverlap(next, action)) ? { ...action, status: "replaced" } : action)),
          ...incoming,
        ]);
        // The minimised chat is too small for a Proposed change card.
        if (compact && incoming.some(action => action.scope === "permanent" && action.changed !== false)) setExpanded(true);
        setPainActive(Boolean(data.activePain));
        setPainNote("");
        setMessages([...updated, { role: "assistant", content: data.message || "I don't have enough data to answer that yet.", planChangeHint: Boolean(data.planChangeHint) }]);
        setLoading(false);
        setTimeout(scroll, 50);
        return;
      }
      const reply = await streamCoachText({
        area,
        context: context ?? `User data today:\n${dayContext || "- Nothing logged yet today"}`,
        messages: recentChatMessages(apiHistory.filter(message => message.role === "user" || message.role === "assistant")),
      }, text => { setMessages([...updated, { role: "assistant", content: text }]); scroll(); });
      setMessages([...updated, { role: "assistant", content: reply }]);
      // A coach that carries a running memory ends every reply with a hidden
      // updated summary - persist it so the next conversation (even on a
      // different device) picks up where this one left off.
      const memoryMatch = reply.match(/\[MEMORY\]([\s\S]*?)\[\/MEMORY\]/i);
      if (memoryMatch && onMemoryUpdate) onMemoryUpdate(memoryMatch[1].trim());
    } catch (error) {
      const isConnectionFailure = !navigator.onLine || error instanceof TypeError;
      setMessages([...updated, { role: "assistant", error: true, content: isConnectionFailure ? "Connection error. Check your internet connection and try again." : (error.message || "Coach is unavailable right now. Your workout is still saved.") }]);
    }
    setLoading(false);
    setTimeout(scroll, 50);
  };

  const activate = () => {
    setStarted(true);
    if (compact) setExpanded(true);
    if (!openWithoutPrompt) send(openingMessage || "Give me a quick assessment of my day so far and what I should focus on.", { hidden: true });
  };

  // Apply a coach change and report only what the app confirms happened.
  const runAction = async (action, permanent) => {
    let result;
    try { result = await onAction(action, permanent); } catch (error) { result = { ok: false, message: `Not saved: ${error?.message || "something went wrong"}.` }; }
    setMessages(previous => [...previous, { role: "assistant", content: result?.message || (result?.ok ? "Done." : "Nothing was changed.") }]);
    setTimeout(scroll, 50);
  };

  const decideStructuredAction = async (action, decision) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const updateAction = changes => setActions(current => current.map(item => (item.id === action.id ? { ...item, ...changes } : item)));
    updateAction({ deciding: true, error: "" });
    // Apply (and for permanent changes, save) first; only mark the action
    // applied once that has succeeded.
    if (decision !== "reject") {
      const result = await onStructuredAction?.(action);
      if (result && !result.ok) {
        updateAction({ deciding: false, error: action.scope === "permanent" ? result.message : "" });
        if (action.scope !== "permanent") setMessages(previous => [...previous, { role: "assistant", content: result.message }]);
        return;
      }
      if (result?.message) setMessages(previous => [...previous, { role: "assistant", content: result.message }]);
    }
    // Record the decision. The change itself is already saved (or discarded).
    await fetch("/api/coach-action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ actionId: action.id, decision }),
    }).catch(() => null);
    updateAction({ deciding: false, status: decision === "reject" ? "rejected" : "applied" });
  };

  // A change the coach proposed: permanent ones in a Proposed change card
  // (APPROVE & SAVE / DISCARD), temporary ones as before.
  const actionCard = action => {
    if (action.scope === "permanent") {
      const card = action.lines ? action : { ...action, ...coachProposal(planSessions || coachContext?.programme, action) };
      const status = action.status === "applied" ? "saved" : action.status === "rejected" ? "discarded" : action.status === "replaced" ? "replaced" : card.changed === false ? "unusable" : action.deciding ? "saving" : "pending";
      return <ProposedChangeCard key={action.id} lines={card.lines} notes={card.notes} status={status} error={action.error} highlight={proposalHighlight}
        onApprove={() => decideStructuredAction(action, "approve")} onDiscard={() => decideStructuredAction(action, "reject")} />;
    }
    if (["rejected", "applied"].includes(action.status)) return null;
    return <div key={action.id} style={{ background: "rgba(0,200,255,.05)", border: "1px solid rgba(0,200,255,.25)", borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, color: NEON2, letterSpacing: 1, marginBottom: 5 }}>TEMPORARY CHANGE</div>
      <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.5, marginBottom: 8 }}>{action.payload?.reason || "Coach suggested a workout update."}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="t3d-btn t3d-btn-sm" disabled={action.deciding} onClick={() => decideStructuredAction(action, "apply")}>APPLY</button>
        <button className="t3d-btn t3d-btn-sm t3d-btn-red" disabled={action.deciding} onClick={() => decideStructuredAction(action, "reject")}>NO CHANGE</button>
      </div>
    </div>;
  };

  // A caller (e.g. the 1-week review banner) can hand this coach a message to
  // send right away, opening it fully expanded so the conversation is
  // immediately visible rather than needing the user to find and open it.
  useEffect(() => {
    if (!pendingPrompt || !restored) return;
    setStarted(true);
    if (compact) setExpanded(true);
    send(pendingPrompt);
    onConsumedPrompt?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, restored]);

  // Messages on screen with their place in the conversation (for the
  // changes proposed under them). The minimised chat shows the last two.
  const visibleEntries = messages.map((m, index) => ({ m, index })).filter(({ m }) => !m.hidden);
  const shownEntries = compact && !expanded ? visibleEntries.slice(-2) : visibleEntries;
  const shownIndexes = new Set(shownEntries.map(entry => entry.index));

  return (
    <div className={`t3d-card ${compact ? "t3d-compact-coach" : ""} ${expanded ? "t3d-coach-expanded" : ""}`} style={{ height: compact ? "auto" : "100%", display: "flex", flexDirection: "column", padding: compact ? 10 : 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="t3d-ctitle" style={{ marginBottom: compact ? 6 : 14, color: compact ? "#8AABB8" : undefined }}>{title || "AI COACH"}</div>
        {compact && started && <button type="button" className="t3d-btn t3d-btn-sm" style={{ padding: "4px 7px", fontSize: 7, marginBottom: 5 }} onClick={() => setExpanded(value => !value)}>{expanded ? "MINIMISE" : "OPEN"}</button>}
      </div>
      {!started ? (
        <div style={{ flex: 1, display: "flex", flexDirection: compact ? "row" : "column", alignItems: "center", justifyContent: compact ? "space-between" : "center", gap: compact ? 10 : 0, padding: compact ? 0 : "20px 0" }}>
          {!compact && <div style={{ fontSize: 30, marginBottom: 10 }}>🤖</div>}
          <div style={{ flex: 1, fontSize: compact ? 9 : 11, color: "#E0EAF0", marginBottom: compact ? 0 : 18, textAlign: compact ? "left" : "center", lineHeight: 1.5, letterSpacing: compact ? 0 : 1 }}>
            {introduction || "Ask your AI coach about your habits,\nworkouts and nutrition."}
          </div>
          <button className={`t3d-btn ${compact ? "t3d-btn-sm" : ""}`} onClick={activate}>{activationLabel || (openingMessage || openWithoutPrompt ? "OPEN COACH CHAT" : "REVIEW MY DAY SO FAR")}</button>
        </div>
      ) : (
        <>
          <div ref={messageListRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", maxHeight: compact ? (expanded ? "calc(100dvh - 190px)" : 112) : 260, marginBottom: compact ? 6 : 10, scrollbarWidth: "thin" }}>
            {shownEntries.map(({ m, index }, i) => <Fragment key={index}>{(() => {
              if (m.role === "note") return <div key={i} data-testid="coach-note" style={{ textAlign: "center", fontSize: 9, color: "#6F8792", letterSpacing: 1, margin: "6px 0" }}>{m.content}</div>;
              // Opens Change Plan with the request that led here typed in.
              const openChangePlan = () => onOpenChangePlan(messages.slice(0, index).reverse().find(message => message.role === "user" && !message.hidden)?.content || "");
              const changePlanButton = m.planChangeHint && onOpenChangePlan ? <button key={`cp-${i}`} className="t3d-btn t3d-btn-sm" style={{ margin: "0 0 8px", fontSize: 8 }} onClick={openChangePlan}>OPEN CHANGE PLAN</button> : null;
              if (changePlanButton && index === visibleEntries.at(-1)?.index) {
                return <div key={i}><div className="t3d-ai-msg" style={{ background: SURFACE2, border: "1px solid rgba(0,255,178,.1)" }}><div className="t3d-ai-tag" style={{ color: NEON }}>AI</div><span style={{ color: "#E0EAF0", fontSize: 11, whiteSpace: "pre-wrap" }}>{cleanAiText(m.content)}</span></div>{changePlanButton}</div>;
              }
              const actionMatch = m.role === "assistant" ? m.content.match(/\[ACTION:(rename_exercise|remove_exercise|remove_sets|add_sets|log_set)\|([^|\]]+)(?:\|([^|\]]+))?\]/i) : null;
              // Bigger, structured changes (a whole session/programme rewrite) travel as
              // JSON in a fenced block rather than the pipe-delimited marker above, which
              // can't safely hold arbitrary JSON (it contains "|" and "]" characters).
              // Accept the block even when the closing tag is missing or the JSON is in a code fence.
              const jsonActionMatch = m.role === "assistant" ? m.content.match(/\[ACTION_JSON:(replace_session)\]([\s\S]*?)(?:\[\/ACTION_JSON\]|\[MEMORY\]|$)/i) : null;
              const jsonActionPayload = jsonActionMatch ? extractJsonObject(jsonActionMatch[2]) : null;
              const strippedContent = m.content
                .replace(/\[ACTION:[^\]]+\]/gi, "")
                .replace(/\[ACTION_JSON:[^\]]+\][\s\S]*?(?:\[\/ACTION_JSON\]|(?=\[MEMORY\])|$)/gi, "")
                .replace(/\[MEMORY\][\s\S]*?(?:\[\/MEMORY\]|$)/gi, "");
              // Raw JSON is never shown in the chat; say plainly when a change could not be read.
              const hadRawJson = /```json[\s\S]*?```/i.test(strippedContent) || (Boolean(jsonActionMatch) && !Array.isArray(jsonActionPayload?.exercises));
              const visibleContent = cleanAiText(strippedContent.replace(/```json[\s\S]*?(?:```|$)/gi, "").trim())
                + (hadRawJson && m.role === "assistant" ? "\n\n(The coach sent a change the app could not read, so nothing was changed. Ask again if you want it.)" : "");
              return (
              <div key={i} className="t3d-ai-msg" style={{
                background: m.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2,
                border: `1px solid ${m.role === "user" ? "rgba(0,200,255,.15)" : "rgba(0,255,178,.1)"}`,
              }}>
                <div className="t3d-ai-tag" style={{ color: m.role === "user" ? NEON2 : NEON }}>
                  {m.role === "user" ? "YOU" : "AI"}
                </div>
                <span style={{ color: compact ? "#F1F6F8" : m.role === "user" ? "#C0D8E8" : "#8AABB8", fontSize: compact ? 12 : undefined, lineHeight: compact ? 1.65 : undefined, whiteSpace: "pre-wrap" }}>{visibleContent}</span>
                {actionMatch && onAction && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                    {actionMatch[1] === "log_set" ? (
                      <button className="t3d-btn t3d-btn-sm" style={{ padding: "4px 7px", fontSize: 7 }} onClick={() => runAction({ type: actionMatch[1], exercise: actionMatch[2].trim(), value: actionMatch[3]?.trim() }, false)}>LOG THIS SET</button>
                    ) : (
                      <>
                        <button className="t3d-btn t3d-btn-sm" style={{ padding: "4px 7px", fontSize: 7 }} onClick={() => runAction({ type: actionMatch[1], exercise: actionMatch[2].trim(), value: actionMatch[3]?.trim() }, false)}>THIS WORKOUT</button>
                        <button className="t3d-btn t3d-btn-sm" style={{ padding: "4px 7px", fontSize: 7 }} onClick={() => runAction({ type: actionMatch[1], exercise: actionMatch[2].trim(), value: actionMatch[3]?.trim() }, true)}>MAKE PERMANENT</button>
                      </>
                    )}
                  </div>
                )}
                {Array.isArray(jsonActionPayload?.exercises) && onAction && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                    <button className="t3d-btn t3d-btn-sm" style={{ padding: "4px 7px", fontSize: 7 }} onClick={() => runAction({ type: jsonActionMatch[1], payload: jsonActionPayload }, false)}>THIS WORKOUT</button>
                    <button className="t3d-btn t3d-btn-sm" style={{ padding: "4px 7px", fontSize: 7 }} onClick={() => runAction({ type: jsonActionMatch[1], payload: jsonActionPayload }, true)}>MAKE PERMANENT</button>
                  </div>
                )}
              </div>
            );})()}{coachingV12 && actions.filter(action => action.messageIndex === index).map(actionCard)}</Fragment>)}
            {loading && (
              <div className="t3d-ai-msg" style={{ background: SURFACE2, border: "1px solid rgba(0,255,178,.1)" }}>
                <div className="t3d-ai-tag" style={{ color: NEON }}>AI</div>
                <span className="t3d-cursor" style={{ color: "#E0EAF0", fontSize: 11 }}>Thinking</span>
              </div>
            )}
            {coachingV12 && (painActive || painNote) && (
              <div role="status" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: "1px solid rgba(255,181,71,.35)", background: "rgba(255,181,71,.06)", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: "#FFB547", lineHeight: 1.4 }}>{painNote || "Pain noted — the coach won't load that area until you say it's better."}</span>
                {painActive && <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 8, whiteSpace: "nowrap" }} onClick={async () => {
                  const resolved = await resolveActivePain();
                  if (resolved.ok) { setPainActive(false); setPainNote("Pain marked as resolved. Ease back in with light, pain-free sets."); }
                  else setPainNote(`Couldn't update that: ${resolved.error}`);
                }}>PAIN RESOLVED</button>}
              </div>
            )}
            {/* A change still waiting whose message isn't shown (the minimised chat shows the last two). */}
            {coachingV12 && actions.filter(action => !shownIndexes.has(action.messageIndex) && (action.scope === "permanent" ? action.status === "pending_approval" && action.changed !== false : !["rejected", "applied"].includes(action.status))).map(actionCard)}
            <div ref={endRef} />
          </div>
          {messages.at(-1)?.role === "assistant" && isYesNoQuestion(messages.at(-1)?.content) && (
            <div style={{ display: "flex", gap: 5, marginBottom: 5 }}>
              {["Yes", "No", "More detail"].map(reply => <button key={reply} className="t3d-btn t3d-btn-sm" style={{ padding: "4px 7px", fontSize: 7 }} onClick={() => send(reply)}>{reply.toUpperCase()}</button>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 7, marginBottom: 7 }}>
            <input className="t3d-ai-input" placeholder="Ask anything..." value={input}
              onChange={e => setInput(e.target.value)}
              onFocus={() => compact && setExpanded(true)}
              onKeyDown={e => e.key === "Enter" && send(input)} />
            <button className="t3d-btn t3d-btn-sm" onClick={() => send(input)} disabled={loading || !input.trim()}>SEND</button>
          </div>
        </>
      )}
    </div>
  );
}

// Task durations are whole minutes between 1 and 180.
const clampTaskMinutes = value => Math.min(180, Math.max(1, Math.round(Number(value)) || 1));

// ─── Routine coach: describe the applied schedule ─────────────────────────────
// After a coach change is applied and times are recalculated, ask the coach to
// describe that exact schedule, so its explanation matches what really changed.
async function describeAppliedRoutine({ conversation, before, after, pendingRemovals = [], fallback }) {
  const keyOf = task => task.id || task.name;
  const last = after[after.length - 1];
  const [hours, minutes] = String(last?.scheduledTime || "00:00").split(":").map(Number);
  const finishMinutes = hours * 60 + minutes + (Number(last?.duration) || 0);
  const finishTime = `${String(Math.floor(finishMinutes / 60) % 24).padStart(2, "0")}:${String(finishMinutes % 60).padStart(2, "0")}`;
  const durationChanges = after.flatMap(task => {
    const previous = before.find(item => keyOf(item) === keyOf(task));
    return previous && Number(previous.duration) !== Number(task.duration) ? [`${task.name} ${previous.duration} → ${task.duration} min`] : [];
  });
  const orderChanged = before.map(keyOf).join("|") !== after.filter(task => before.some(item => keyOf(item) === keyOf(task))).map(keyOf).join("|");
  const schedule = after.map(task => `${task.scheduledTime} ${task.name} (${task.duration} min)`).join("\n");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: await chatHeaders(),
      body: JSON.stringify({
        area: "routine_change_summary",
        context: `Order changed: ${orderChanged ? "yes" : "no"}.
Duration changes: ${durationChanges.join("; ") || "none"}.
${pendingRemovals.length ? `Proposed removals waiting for the user to confirm (not yet removed): ${pendingRemovals.map(item => item.name).join(", ")}.\n` : ""}Schedule now:
${schedule}
Finishes at ${finishTime}.`,
        messages: conversation.map(({ role, content }) => ({ role, content })),
      }),
    });
    if (!res.ok) throw new Error("Request failed");
    const data = await res.json();
    return data.content?.map(block => block.text || "").join("").trim() || fallback;
  } catch {
    return fallback;
  }
}

// ─── Schedule Review with Drag ────────────────────────────────────────────────
function ScheduleReview({ scheduledTasks, setScheduledTasks, wakeTime, recalcTimes, calcFinishTime, LOCKED_LAST, nonRemovableIds = [], onRemoveTask, onBack, onSave }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConversation, setAiConversation] = useState([]);
  const [aiFeedback, setAiFeedback] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiChangeStatus, setAiChangeStatus] = useState("");
  const [removalProposals, setRemovalProposals] = useState([]);
  const aiRequestActive = useRef(false);

  const draggable = scheduledTasks.filter(t => t.id !== "checkin");
  const locked = scheduledTasks.find(t => t.id === "checkin") || LOCKED_LAST;

  const moveTask = (from, to) => {
    if (aiLoading || from === to || to < 0 || to >= draggable.length) return;
    const newList = [...draggable];
    const [moved] = newList.splice(from, 1);
    newList.splice(to, 0, moved);
    setScheduledTasks(recalcTimes([...newList, locked]));
  };
  // Pointer Events (same approach as the routine editor) so dragging works
  // with touch as well as a mouse.
  const handlePointerDown = (e, i) => {
    if (aiLoading) return;
    e.preventDefault();
    setDragIdx(i);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e) => {
    if (dragIdx === null) return;
    e.preventDefault();
    const rowEl = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-review-index]");
    if (!rowEl) return;
    const target = Number(rowEl.dataset.reviewIndex);
    if (!Number.isNaN(target) && target !== dragIdx) {
      moveTask(dragIdx, target);
      setDragIdx(target);
    }
  };
  const handlePointerUp = () => setDragIdx(null);

  const optimiseWithAI = async (feedback = "") => {
    if (aiRequestActive.current) return;
    // Close the phone keyboard so the screen returns to its normal size.
    document.activeElement?.blur?.();
    const message = feedback.trim() || "Optimise my routine now using what you know. Apply the best task order and briefly explain the main change. Do not wait for me to answer questions.";
    const updated = [...aiConversation, { role: "user", content: message, hidden: !feedback.trim() }];
    aiRequestActive.current = true;
    setAiLoading(true);
    setAiError("");

    const tasks = draggable.map((task, index) => ({
      key: String(index), name: task.name, duration: task.duration,
      scheduledTime: task.scheduledTime, preferredTime: task.preferredTime || null,
      locked: nonRemovableIds.includes(task.id),
    }));
    try {
      let parsed;
      for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: await chatHeaders(),
        body: JSON.stringify({
          responseTokens: 2500,
          area: "routine_plan",
          context: `Wake-up: ${wakeTime}.
Current tasks: ${JSON.stringify(tasks)}.
Locked final step: ${JSON.stringify({ name: locked.name, duration: locked.duration })}.`,
          messages: updated.map(({ role, content }, index) => ({ role, content: attempt && index === updated.length - 1 ? content + "\nReturn a complete valid JSON object with every current task key once. Use string keys and a brief explanation. Your previous response could not be applied." : content })),
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      const reply = data.content?.map(block => block.text || "").join("") || "";
      try {
        const cleaned = reply.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(cleaned);
        const toKey = key => {
          const identifier = String(key);
          if (tasks.some(task => task.key === identifier)) return identifier;
          const matches = tasks.filter(task => task.name === identifier);
          return matches.length === 1 ? matches[0].key : identifier;
        };
        if (Array.isArray(parsed.tasks)) parsed.tasks = parsed.tasks.map(entry => ({ ...entry, key: toKey(entry?.key) }));
        const keys = (parsed.tasks || []).map(entry => entry.key);
        const expected = new Set(tasks.map(task => task.key));
        if (!Array.isArray(parsed.tasks) || keys.length !== tasks.length ||
            new Set(keys).size !== tasks.length || keys.some(key => !expected.has(key)) ||
            typeof parsed.explanation !== "string" || !parsed.explanation.trim()) {
          throw new Error("Invalid recommendation");
        }
        break;
      } catch {
        if (attempt === 1) throw new Error("Invalid recommendation");
      }
      }
      const reordered = parsed.tasks.map(entry => {
        const task = draggable[Number(entry.key)];
        const duration = Math.round(Number(entry.duration));
        return { ...task, duration: duration >= 1 && duration <= 180 ? duration : task.duration };
      });
      const proposals = (Array.isArray(parsed.proposeRemove) ? parsed.proposeRemove : []).flatMap(entry => {
        const task = draggable[Number(tasks.find(item => item.key === String(entry?.key) || item.name === entry?.key)?.key)];
        if (!task || nonRemovableIds.includes(task.id)) return [];
        return [{ id: task.id || task.name, name: task.name, reason: String(entry.reason || "") }];
      });
      const changed = reordered.some((task, index) => (task.id || task.name) !== (draggable[index].id || draggable[index].name) || Number(task.duration) !== Number(draggable[index].duration));
      const applied = recalcTimes([...reordered, locked]);
      if (changed) setScheduledTasks(applied);
      setRemovalProposals(proposals);
      setAiChangeStatus(changed ? "Draft updated. Review above, then lock it in." : proposals.length ? "No order or timing changes - see the coach's suggestion below." : "No changes recommended — your current draft is unchanged.");
      const explanation = changed || proposals.length
        ? await describeAppliedRoutine({ conversation: updated, before: recalcTimes([...draggable, locked]), after: applied, pendingRemovals: proposals, fallback: parsed.explanation })
        : parsed.explanation;
      setAiConversation([...updated, { role: "assistant", content: explanation }]);
      setAiFeedback("");
    } catch {
      setAiError("AI Coach could not revise your routine. The last successful update is still in place. Your message is kept — please try again.");
    } finally {
      aiRequestActive.current = false;
      setAiLoading(false);
    }
  };
  return (
    <div>
      <div className="t3d-ctitle">REVIEW AND REORDER YOUR ROUTINE</div>
      <div style={{ marginBottom: 12, fontSize: 10, color: "#E0EAF0", letterSpacing: 1 }}>
        Drag the ≡ handle or use the arrows to reorder. Check-in is locked last.
      </div>
      <div style={{ marginBottom: 8 }}>
        {draggable.map((t, i) => (
          <div key={t.id || i} data-review-index={i}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: "1px solid #1A2530", borderRadius: 4, background: dragIdx === i ? "rgba(0,255,178,.06)" : "transparent" }}>
            <div aria-label={`Drag to move ${t.name}`}
              onPointerDown={e => handlePointerDown(e, i)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ width: 40, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", color: "#8AABB8", fontSize: 22, cursor: aiLoading ? "default" : "grab", touchAction: "none", userSelect: "none" }}>≡</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#00C8FF", width: 42 }}>{t.scheduledTime}</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, overflowWrap: "anywhere" }}>{t.name}</div>
            <div style={{ fontSize: 10, color: "#E0EAF0", whiteSpace: "nowrap" }}>{t.duration} min</div>
            <button type="button" className="t3d-btn t3d-btn-sm" aria-label={`Move ${t.name} up`} disabled={aiLoading || i === 0}
              onClick={() => moveTask(i, i - 1)} style={{ minWidth: 44, minHeight: 44, padding: 4 }}>↑</button>
            <button type="button" className="t3d-btn t3d-btn-sm" aria-label={`Move ${t.name} down`} disabled={aiLoading || i === draggable.length - 1}
              onClick={() => moveTask(i, i + 1)} style={{ minWidth: 44, minHeight: 44, padding: 4 }}>↓</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", border: "1px solid rgba(0,200,255,.2)", borderRadius: 6, marginBottom: 16, background: "rgba(0,200,255,.04)" }}>
        <div style={{ fontSize: 14 }}>🔒</div>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#00C8FF", width: 45 }}>{locked.scheduledTime}</div>
        <div style={{ flex: 1, fontSize: 12, color: "#4A6070" }}>{locked.icon} {locked.name}</div>
        <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>LOCKED</div>
      </div>
      <div style={{ background: "rgba(0,200,255,.05)", border: "1px solid rgba(0,200,255,.2)", borderRadius: 6, padding: 12, marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#E0EAF0" }}>ROUTINE FINISHES AT</span>
        <span style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#00C8FF" }}>{calcFinishTime(wakeTime, scheduledTasks)}</span>
      </div>
      {aiChangeStatus && <p role="status" style={{ fontSize: 12, color: NEON, lineHeight: 1.5 }}>{aiChangeStatus}</p>}
      <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
        <div className="t3d-ai-tag" style={{ color: NEON }}>AI COACH</div>
        <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>
          The coach can reorder, retime or suggest removing tasks. Tell it what you need, or leave the box empty to let it optimise.
        </p>
        <div role="log" aria-label="Routine planning conversation" aria-live="polite"
          style={{ maxHeight: 320, overflowY: "auto", marginBottom: 12 }}>
          {aiConversation.filter(message => !message.hidden).map((message, index) => (
            <div key={index} className="t3d-ai-msg" style={{ background: message.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2 }}>
              <div className="t3d-ai-tag" style={{ color: message.role === "user" ? NEON2 : NEON }}>{message.role === "user" ? "YOU" : "AI COACH"}</div>
              <div style={{ whiteSpace: "pre-wrap", color: "#E0EAF0" }}>{message.role === "assistant" ? cleanAiText(message.content) : message.content}</div>
            </div>
          ))}
          {aiLoading && <p role="status" style={{ fontSize: 11, color: NEON }}>Thinking about your routine...</p>}
        </div>
        {removalProposals.map(proposal => (
          <div key={proposal.id} role="group" aria-label={`Remove ${proposal.name}?`} style={{ border: "1px solid rgba(255,181,71,.4)", background: "rgba(255,181,71,.06)", borderRadius: 6, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#E0EAF0", marginBottom: 4 }}>Coach suggests removing <strong>{proposal.name}</strong></div>
            {proposal.reason && <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.5, marginBottom: 8 }}>{proposal.reason}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="t3d-btn t3d-btn-sm t3d-btn-red" disabled={aiLoading} onClick={() => {
                const remaining = recalcTimes(scheduledTasks.filter(task => (task.id || task.name) !== proposal.id));
                setScheduledTasks(remaining);
                onRemoveTask?.(proposal.id);
                setRemovalProposals(current => current.filter(item => item.id !== proposal.id));
                setAiChangeStatus(`Removed ${proposal.name}. Routine now finishes at ${calcFinishTime(wakeTime, remaining)}.`);
              }}>REMOVE {proposal.name.toUpperCase()}</button>
              <button className="t3d-btn t3d-btn-sm" disabled={aiLoading} onClick={() => setRemovalProposals(current => current.filter(item => item.id !== proposal.id))}>KEEP IT</button>
            </div>
          </div>
        ))}
        <label style={{ display: "block", fontSize: 11, color: "#E0EAF0" }}>
          Anything to adjust?
          <textarea className="t3d-input" rows={2} value={aiFeedback} disabled={aiLoading}
            style={{ marginTop: 8, resize: "vertical" }}
            placeholder="e.g. Fit it into 75 minutes, or I need breakfast before the school run."
            onChange={event => setAiFeedback(event.target.value)} />
        </label>
        {aiError && <p role="alert" style={{ fontSize: 11, color: NEON3 }}>{aiError}</p>}
        <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 10, minHeight: 44 }} disabled={aiLoading}
          onClick={() => optimiseWithAI(aiFeedback)}>{aiLoading ? "THINKING..." : "ASK COACH"}</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="t3d-btn" style={{ width: "100%", padding: 14, background: "rgba(0,255,178,.12)", borderColor: "rgba(0,255,178,.5)" }} onClick={onSave} disabled={aiLoading}>
          LOCK IT IN →
        </button>
        <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ width: "100%", minHeight: 44 }} onClick={onBack} disabled={aiLoading}>← BACK TO TASKS</button>
      </div>
    </div>
  );
}

// ─── Morning Section ──────────────────────────────────────────────────────────
function MorningRoutineEditor({ wakeTime, setWakeTime, scheduledTasks, setScheduledTasks, dayGroups = [], onOpenRotationSetup, onSave, onRebuild, onCancel }) {
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");
  const [newTaskDuration, setNewTaskDuration] = useState(""); // empty: 10 minutes, shown faintly
  const [dragIdx, setDragIdx] = useState(null);
  const durationTimerRef = useRef(null);

  // AI Coach: lets the user ask for a reorder/retime of the routine in
  // plain language instead of dragging every task by hand.
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConversation, setAiConversation] = useState([]);
  const [aiFeedback, setAiFeedback] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiChangeStatus, setAiChangeStatus] = useState("");
  const aiRequestActive = useRef(false);

  const timeToMinutes = (time) => {
    if (!time) return 0;
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };

  const minutesToTime = (minutes) => {
    const mins = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const changeWakeTime = (newWakeTime) => {
    const oldMinutes = timeToMinutes(wakeTime);
    const newMinutes = timeToMinutes(newWakeTime);
    const difference = newMinutes - oldMinutes;

    setWakeTime(newWakeTime);

    setScheduledTasks(prev =>
      prev.map(task => ({
        ...task,
        scheduledTime: task.scheduledTime
          ? minutesToTime(timeToMinutes(task.scheduledTime) + difference)
          : task.scheduledTime
      }))
    );
  };

  const updateTask = (index, field, value) => {
    setScheduledTasks(prev =>
      prev.map((task, i) =>
        i === index
          ? {
              ...task,
              [field]:
                field === "duration"
                  ? value === "" ? "" : clampTaskMinutes(value)
                  : value
            }
          : task
      )
    );

    if (field === "duration" && value !== "" && Number(value) > 0) {
      setScheduledTasks(current => {
        const [wakeH, wakeM] = wakeTime.split(":").map(Number);
        let cursor = wakeH * 60 + wakeM;

        return current.map(task => {
          const h = Math.floor(cursor / 60) % 24;
          const m = cursor % 60;

          const scheduledTime =
            `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

          cursor += Number(task.duration) || 0;

          return {
            ...task,
            scheduledTime
          };
        });
      });
    }
  };

  const deleteTask = (index) => {
    setScheduledTasks(prev => {
      const filtered = prev.filter(
        (task, i) => i !== index || task.id === "checkin"
      );

      const [wakeH, wakeM] = wakeTime.split(":").map(Number);
      let cursor = wakeH * 60 + wakeM;

      return filtered.map(task => {
        const h = Math.floor(cursor / 60) % 24;
        const m = cursor % 60;

        const scheduledTime =
          `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

        cursor += Number(task.duration) || 0;

        return {
          ...task,
          scheduledTime
        };
      });
    });
  };

  const addTask = () => {
    if (!newTaskName.trim()) return;

    const checkin = scheduledTasks.find(t => t.id === "checkin");
    const otherTasks = scheduledTasks.filter(t => t.id !== "checkin");

    const newTask = {
      id: `custom-${Date.now()}`,
      name: newTaskName.trim(),
      duration: clampTaskMinutes(newTaskDuration || 10),
      type: "tick",
      icon: ""
    };

    const list = checkin
      ? [...otherTasks, newTask, checkin]
      : [...otherTasks, newTask];

    const [wakeH, wakeM] = wakeTime.split(":").map(Number);
    let cursor = wakeH * 60 + wakeM;

    const recalculated = list.map(task => {
      const h = Math.floor(cursor / 60) % 24;
      const m = cursor % 60;

      const scheduledTime =
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

      cursor += Number(task.duration) || 5;

      return {
        ...task,
        scheduledTime
      };
    });

    setScheduledTasks(recalculated);

    setNewTaskName("");
    setNewTaskTime("");
    setNewTaskDuration("");
  };

  const recalcFromWake = (list) => {
    const [wakeH, wakeM] = wakeTime.split(":").map(Number);
    let cursor = wakeH * 60 + wakeM;
    return list.map(task => {
      const h = Math.floor(cursor / 60) % 24;
      const m = cursor % 60;
      const scheduledTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      cursor += Number(task.duration) || 5;
      return { ...task, scheduledTime };
    });
  };

  const reorderTo = (fromIndex, toIndex) => {
    if (fromIndex === null || fromIndex === toIndex) return;
    const list = [...scheduledTasks];
    if (list[toIndex]?.id === "checkin") return;
    if (list[fromIndex]?.id === "checkin") return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    setScheduledTasks(recalcFromWake(list));
  };

  // Drag handle: uses Pointer Events (not the HTML5 drag-and-drop API used
  // previously) because native drag-and-drop only fires for a mouse - it
  // never fires from a touch gesture, so the handle silently did nothing on
  // phones. Pointer Events fire the same way for mouse, touch and pen.
  const handlePointerDown = (e, index) => {
    if (scheduledTasks[index]?.id === "checkin") return;
    e.preventDefault();
    setDragIdx(index);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (dragIdx === null) return;
    e.preventDefault();
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const rowEl = target?.closest?.("[data-row-index]");
    if (!rowEl) return;
    const targetIndex = Number(rowEl.dataset.rowIndex);
    if (!Number.isNaN(targetIndex) && targetIndex !== dragIdx) {
      reorderTo(dragIdx, targetIndex);
      setDragIdx(targetIndex);
    }
  };

  const handlePointerUp = () => setDragIdx(null);

  // Keyboard: the arrow keys move the task, and the focus stays on its handle.
  const handleHandleKey = (event, index) => {
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to >= scheduledTasks.length || scheduledTasks[to]?.id === "checkin" || scheduledTasks[index]?.id === "checkin") return;
    reorderTo(index, to);
    requestAnimationFrame(() => document.querySelector(`[data-row-index="${to}"] [data-move-handle]`)?.focus());
  };

  // AI Coach reorder/retime: returns the tasks in a new order, each keyed
  // back to the task it currently is, with an optional revised duration -
  // this lets the coach both restructure and retime the routine at once.
  const optimiseWithAI = async (feedback = "") => {
    if (aiRequestActive.current) return;
    // Close the phone keyboard so the screen returns to its normal size.
    document.activeElement?.blur?.();
    const message = feedback.trim() || "Look at my current routine and suggest a better order or timing. Explain the main change.";
    const updated = [...aiConversation, { role: "user", content: message, hidden: !feedback.trim() }];
    const editable = scheduledTasks.filter(t => t.id !== "checkin");
    const checkin = scheduledTasks.find(t => t.id === "checkin");
    aiRequestActive.current = true;
    setAiLoading(true);
    setAiError("");
    const tasks = editable.map((task, index) => ({
      key: String(index), name: task.name, duration: task.duration, scheduledTime: task.scheduledTime,
    }));
    try {
      let parsed;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: await chatHeaders(),
          body: JSON.stringify({
            responseTokens: 2500,
            area: "routine_refine",
            context: `Wake-up: ${wakeTime}.
Current tasks: ${JSON.stringify(tasks)}.`,
            messages: updated.map(({ role, content }, index) => ({ role, content: attempt && index === updated.length - 1 ? content + "\nReturn a complete valid JSON object with every current task key once. Your previous response could not be applied." : content })),
          }),
        });
        if (!res.ok) throw new Error("Request failed");
        const data = await res.json();
        const reply = data.content?.map(block => block.text || "").join("") || "";
        try {
          const cleaned = reply.replace(/```json|```/g, "").trim();
          parsed = JSON.parse(cleaned);
          const expected = new Set(tasks.map(t => t.key));
          const keys = (parsed.tasks || []).map(t => String(t.key));
          if (!Array.isArray(parsed.tasks) || keys.length !== tasks.length ||
              new Set(keys).size !== tasks.length || keys.some(key => !expected.has(key)) ||
              typeof parsed.explanation !== "string" || !parsed.explanation.trim()) {
            throw new Error("Invalid recommendation");
          }
          break;
        } catch {
          if (attempt === 1) throw new Error("Invalid recommendation");
        }
      }
      const reordered = parsed.tasks.map(entry => ({
        ...editable[Number(entry.key)],
        duration: Number(entry.duration) > 0 ? Number(entry.duration) : editable[Number(entry.key)].duration,
      }));
      const changed = parsed.tasks.some((entry, index) => String(entry.key) !== String(index) || Number(entry.duration) !== Number(editable[Number(entry.key)].duration));
      const finalList = checkin ? [...reordered, checkin] : reordered;
      let explanation = parsed.explanation;
      if (changed) {
        const applied = recalcFromWake(finalList);
        setScheduledTasks(applied);
        setAiChangeStatus("Routine updated and saved.");
        explanation = await describeAppliedRoutine({ conversation: updated, before: scheduledTasks, after: applied, fallback: parsed.explanation });
      } else {
        setAiChangeStatus("No changes recommended - your current routine is unchanged.");
      }
      setAiConversation([...updated, { role: "assistant", content: explanation }]);
      setAiFeedback("");
    } catch {
      setAiError("AI Coach could not update your routine. Your last saved version is still in place - please try again.");
    } finally {
      aiRequestActive.current = false;
      setAiLoading(false);
    }
  };

  return (
    <div className="t3d-fade">
      <div className="t3d-card">

        <h2 className="t3d-ctitle" style={{ marginBottom: 20 }}>
          EDIT MORNING ROUTINE
        </h2>

        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 10,
            color: "#E0EAF0",
            letterSpacing: 1,
            marginBottom: 8
          }}>
            WAKE UP TIME
          </div>

          <input
            type="time"
            value={wakeTime}
            onChange={e => changeWakeTime(e.target.value)}
            className="t3d-input"
            style={{
              maxWidth: 180,
              colorScheme: "dark"
            }}
          />

          <div style={{
            fontSize: 9,
            color: "#8AABB8",
            marginTop: 7
          }}>
            Changing your wake time moves the full routine with it.
          </div>
        </div>

        {onOpenRotationSetup && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", border: `1px solid ${BORDER}`, borderRadius: 7, marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: "#8AABB8" }}>
              ALTERNATING DAYS: {dayGroups.length > 1 ? dayGroups.map(g => g.name).join(" / ") : "OFF"}
            </div>
            <button className="t3d-btn t3d-btn-sm" onClick={onOpenRotationSetup}>MANAGE →</button>
          </div>
        )}

        <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 7, padding: 14, marginBottom: 20 }}>
          <div className="t3d-ai-tag" style={{ color: NEON }}>AI COACH</div>
          <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginTop: 6 }}>
            Ask the coach to reorder or retime your routine - changes save automatically.
          </p>
          {aiChangeStatus && <p role="status" style={{ fontSize: 11, color: NEON }}>{aiChangeStatus}</p>}
          {aiConversation.filter(message => !message.hidden).length > 0 && (
            <div role="log" aria-label="Routine coach conversation" aria-live="polite" style={{ maxHeight: 240, overflowY: "auto", marginBottom: 10 }}>
              {aiConversation.filter(message => !message.hidden).map((message, index) => (
                <div key={index} className="t3d-ai-msg" style={{ background: message.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2 }}>
                  <div className="t3d-ai-tag" style={{ color: message.role === "user" ? NEON2 : NEON }}>{message.role === "user" ? "YOU" : "AI COACH"}</div>
                  <div style={{ whiteSpace: "pre-wrap", color: "#E0EAF0" }}>{message.role === "assistant" ? cleanAiText(message.content) : message.content}</div>
                </div>
              ))}
              {aiLoading && <p role="status" style={{ fontSize: 11, color: NEON }}>Thinking about your routine...</p>}
            </div>
          )}
          <label style={{ display: "block", fontSize: 11, color: "#E0EAF0" }}>
            What would you like to change?
            <textarea className="t3d-input" rows={2} value={aiFeedback} disabled={aiLoading}
              style={{ marginTop: 8, resize: "vertical" }}
              placeholder="e.g. Move my workout earlier and give me more time for breakfast."
              onChange={event => setAiFeedback(event.target.value)} />
          </label>
          {aiError && <p role="alert" style={{ fontSize: 11, color: NEON3 }}>{aiError}</p>}
          <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 10 }} disabled={aiLoading || !aiFeedback.trim()}
            onClick={() => optimiseWithAI(aiFeedback)}>{aiLoading ? "THINKING..." : "SEND TO COACH"}</button>
        </div>

        <div style={{
          fontSize: 10,
          color: "#E0EAF0",
          letterSpacing: 1,
          marginBottom: 10
        }}>
          YOUR ROUTINE
        </div>

        <div style={{ marginBottom: 24 }}>
          {scheduledTasks.map((task, i) => {
            const locked = task.id === "checkin";

            return (
              <div
                key={task.id || i}
                data-row-index={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px 1fr 1fr 44px",
                  gap: 8,
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: `1px solid ${BORDER}`,
                  opacity: locked ? 0.7 : 1,
                  background: dragIdx === i ? "rgba(0,255,178,.04)" : "transparent"
                }}
              >
                <button
                  type="button"
                  data-move-handle
                  disabled={locked}
                  onPointerDown={e => handlePointerDown(e, i)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onKeyDown={e => handleHandleKey(e, i)}
                  aria-label={locked ? "Check-in stays last" : `Move ${task.name || `task ${i + 1}`}: drag, or use the up and down arrow keys`}
                  style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    minWidth: 44,
                    gridRow: "1 / span 2",
                    cursor: locked ? "default" : "grab",
                    color: "#8AABB8",
                    fontSize: 20,
                    minHeight: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    touchAction: "none",
                    userSelect: "none"
                  }}
                >
                  {locked ? "🔒" : "≡"}
                </button>

                {/* Name gets its own full-width line so it is readable on a phone. */}
                <div style={{ gridColumn: "2 / 4", minWidth: 0 }}>
                  <input
                    className="t3d-input"
                    aria-label={`Task ${i + 1} name`}
                    value={task.name}
                    disabled={locked}
                    onChange={e => updateTask(i, "name", e.target.value)}
                    style={{ padding: "9px 10px", width: "100%" }}
                  />
                  {!locked && dayGroups.length > 1 && task.routineDay && task.routineDay !== "daily" && (
                    <div style={{ fontSize: 8, color: "#8AABB8", marginTop: 4, letterSpacing: 1 }}>
                      {(dayGroups.find(g => g.id === task.routineDay)?.name || task.routineDay).toUpperCase()} ONLY
                    </div>
                  )}
                </div>

                {!locked ? (
                  <button
                    className="t3d-btn t3d-btn-sm t3d-btn-red"
                    aria-label={`Remove ${task.name}`}
                    onClick={() => deleteTask(i)}
                    style={{ minWidth: 44, minHeight: 44, padding: 8, gridRow: "1 / span 2", gridColumn: 4 }}
                  >
                    ×
                  </button>
                ) : (
                  <div style={{ gridRow: "1 / span 2", gridColumn: 4 }} />
                )}

                <label style={{ gridColumn: 2, fontSize: 8, color: "#6F8792", letterSpacing: 1 }}>
                  TIME
                  <input
                    type="time"
                    className="t3d-input"
                    aria-label={`${task.name || `Task ${i + 1}`} start time`}
                    value={task.scheduledTime || ""}
                    onChange={e => updateTask(i, "scheduledTime", e.target.value)}
                    style={{ padding: "9px 6px", colorScheme: "dark", marginTop: 3 }}
                  />
                </label>

                <label style={{ gridColumn: 3, fontSize: 8, color: "#6F8792", letterSpacing: 1 }}>
                  MINUTES
                  <input
                    type="number"
                    min="1"
                    max="180"
                    inputMode="numeric"
                    className="t3d-input"
                    aria-label={`${task.name || `Task ${i + 1}`} minutes`}
                    value={task.duration ?? ""}
                    onChange={e => updateTask(i, "duration", e.target.value)}
                    style={{ padding: "9px 6px", textAlign: "center", marginTop: 3 }}
                  />
                </label>
              </div>
            );
          })}
        </div>

        <div style={{
          padding: 14,
          border: `1px solid ${BORDER}`,
          borderRadius: 7,
          marginBottom: 20
        }}>
          <h2 className="t3d-ctitle">ADD TASK</h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 110px",
            gap: 8,
            marginBottom: 10
          }}>
            <input
              className="t3d-input"
              placeholder="Task name..."
              value={newTaskName}
              onChange={e => setNewTaskName(e.target.value)}
            />

            <div style={{ position: "relative" }}>
              <input
                type="number"
                min="1"
                max="180"
                aria-label="Minutes"
                className="t3d-input t3d-minutes"
                placeholder="10"
                value={newTaskDuration}
                onChange={e => setNewTaskDuration(e.target.value)}
                style={{ paddingRight: 32 }}
              />
              <span
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 8,
                  color: "#4A6070",
                  pointerEvents: "none"
                }}
              >
                min
              </span>
            </div>
          </div>

          <button
            className="t3d-btn t3d-btn-sm"
            onClick={addTask}
            disabled={!newTaskName.trim()}
          >
            + ADD TO ROUTINE
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="t3d-btn t3d-btn-sm"
            onClick={onCancel}
          >
            ← CANCEL
          </button>

          <button
            className="t3d-btn t3d-btn-sm t3d-btn-red"
            onClick={onRebuild}
          >
            CHANGE ROUTINE
          </button>

          <button
            className="t3d-btn"
            style={{
              flex: 1,
              background: "rgba(0,255,178,.12)",
              borderColor: "rgba(0,255,178,.5)"
            }}
            onClick={onSave}
          >
            SAVE CHANGES
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Alternating Days setup ────────────────────────────────────────────────────
// A dedicated, simpler screen for turning alternating days on/off, naming
// each rotation day, and choosing which tasks run on which day - replacing
// the per-task dropdown that used to be buried in Edit Routine.
function RotationSetupScreen({ dayGroups, setDayGroups, scheduledTasks, setScheduledTasks, trainingDays = [], onDone }) {
  const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const toggleWeekday = (groupId, day) => setDayGroups(groups => groups.map(group => {
    if (group.id !== groupId) return { ...group, weekdays: (group.weekdays || []).filter(item => item !== day) };
    const weekdays = group.weekdays || [];
    return { ...group, weekdays: weekdays.includes(day) ? weekdays.filter(item => item !== day) : WEEKDAYS.filter(item => item === day || weekdays.includes(item)) };
  }));
  // First day follows the training plan's session days; the second takes the rest.
  const matchTrainingPlan = () => setDayGroups(groups => groups.map((group, index) => (
    index === 0 ? { ...group, weekdays: WEEKDAYS.filter(day => trainingDays.includes(day)) }
      : index === 1 ? { ...group, weekdays: WEEKDAYS.filter(day => !trainingDays.includes(day)) }
        : { ...group, weekdays: [] }
  )));
  const enabled = dayGroups.length > 1;
  const editableTasks = scheduledTasks.filter(t => t.id !== "checkin");

  const toggleEnabled = () => {
    if (enabled) {
      setDayGroups([]);
      setScheduledTasks(tasks => tasks.map(t => ({ ...t, routineDay: "daily" })));
    } else {
      setDayGroups([{ id: "A", name: "Day A" }, { id: "B", name: "Day B" }]);
    }
  };

  const renameGroup = (id, name) => setDayGroups(groups => groups.map(g => g.id === id ? { ...g, name } : g));

  const addGroup = () => setDayGroups(groups => [...groups, { id: `day-${Date.now()}`, name: `Day ${groups.length + 1}` }]);

  const removeGroup = (id) => {
    if (dayGroups.length <= 2) return; // at least 2 days while alternating is on
    setDayGroups(groups => groups.filter(g => g.id !== id));
    setScheduledTasks(tasks => tasks.map(t => t.routineDay === id ? { ...t, routineDay: "daily" } : t));
  };

  const assignTask = (taskKey, groupId) => {
    setScheduledTasks(tasks => tasks.map(t => (t.id || t.name) === taskKey ? { ...t, routineDay: groupId } : t));
  };

  return (
    <div className="t3d-fade">
      <div className="t3d-card">
        <h2 className="t3d-ctitle" style={{ marginBottom: 16 }}>ALTERNATING DAYS</h2>
        <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginBottom: 20 }}>
          Turn this on to rotate between different versions of your morning - for example a Training Day and a Rest Day - instead of the same tasks every day. Changes save automatically.
        </p>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", border: `1px solid ${BORDER}`, borderRadius: 7, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#E0EAF0" }}>Use alternating days</div>
          <button className={`t3d-btn t3d-btn-sm ${enabled ? "" : "t3d-btn-red"}`} onClick={toggleEnabled}>{enabled ? "ON" : "OFF"}</button>
        </div>

        {enabled && (
          <>
            <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 10 }}>YOUR ROTATION</div>
            <div style={{ marginBottom: 20 }}>
              {dayGroups.map((group, index) => (
                <div key={group.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 9, color: "#4A6070", width: 16 }}>{index + 1}</div>
                    <input className="t3d-input" aria-label={`Rotation day ${index + 1} name`} value={group.name} onChange={e => renameGroup(group.id, e.target.value)} placeholder="e.g. Training Day" style={{ flex: 1 }} />
                    {dayGroups.length > 2 && (
                      <button className="t3d-btn t3d-btn-sm t3d-btn-red" aria-label={`Remove ${group.name}`} style={{ minWidth: 44, minHeight: 44 }} onClick={() => removeGroup(group.id)}>×</button>
                    )}
                  </div>
                  <div role="group" aria-label={`Weekdays for ${group.name}`} style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingLeft: 24 }}>
                    {WEEKDAYS.map(day => {
                      const selected = group.weekdays?.includes(day);
                      return (
                        <button key={day} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={Boolean(selected)} onClick={() => toggleWeekday(group.id, day)}
                          style={{ minWidth: 44, minHeight: 44, padding: "4px 6px", borderColor: selected ? NEON : BORDER, color: selected ? NEON : "#8AABB8", background: selected ? "rgba(0,255,178,.1)" : "transparent" }}>{day}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {trainingDays.length > 0 && (
                <button type="button" className="t3d-btn t3d-btn-sm" style={{ minHeight: 44, marginRight: 8 }} onClick={matchTrainingPlan}>
                  MATCH MY TRAINING PLAN ({trainingDays.join(", ")})
                </button>
              )}
              <button className="t3d-btn t3d-btn-sm" onClick={addGroup}>+ ADD ANOTHER DAY</button>
              <div style={{ fontSize: 9, color: "#8AABB8", marginTop: 10, lineHeight: 1.5 }}>
                Pick weekdays to tie a day to them (for example your training days). Days with no weekdays picked rotate in order, day after day ({dayGroups.map(g => g.name).join(", ")}, ...).
              </div>
            </div>

            <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 10 }}>WHICH DAYS EACH TASK RUNS ON</div>
            <div style={{ marginBottom: 24 }}>
              {editableTasks.map(task => (
                <div key={task.id || task.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 12, flex: 1, minWidth: 0 }}>{taskIcon(task)}{task.name}</div>
                  <select className="t3d-input" value={task.routineDay || "daily"} onChange={e => assignTask(task.id || task.name, e.target.value)} style={{ maxWidth: 170, fontSize: 10, padding: "6px 8px" }}>
                    <option value="daily">EVERY DAY</option>
                    {dayGroups.map(group => (
                      <option key={group.id} value={group.id}>{group.name.toUpperCase()} ONLY</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        <button className="t3d-btn" style={{ width: "100%", background: "rgba(0,255,178,.12)", borderColor: "rgba(0,255,178,.5)" }} onClick={onDone}>
          DONE
        </button>
      </div>
    </div>
  );
}

function wakeTimingSummary(timing) {
  if (!timing?.actual || !timing?.planned) return "Wake-up time not recorded";
  const minutes = time => {
    const [hours, mins] = time.split(":").map(Number);
    return hours * 60 + mins;
  };
  // Compare nearby clock times correctly across midnight.
  const difference = ((minutes(timing.actual) - minutes(timing.planned) + 2160) % 1440) - 720;
  // A gap this large is not an early or late wake-up, so do not describe it as one.
  if (Math.abs(difference) > 240) return `Started at ${timing.actual} (planned wake-up ${timing.planned})`;
  const comparison = difference === 0 ? "on time" : difference > 0
    ? `${difference} min later than planned` : `${Math.abs(difference)} min earlier than planned`;
  return `Wake-up: ${timing.actual} · Planned: ${timing.planned} · ${comparison}`;
}
function routineTimingSummary(timing) {
  const planned = Number(timing?.plannedMinutes);
  const actual = timing?.actualMinutes === null || timing?.actualMinutes === undefined ? null : Number(timing.actualMinutes);
  if (!planned) return "Routine timing not recorded";
  if (actual === null || Number.isNaN(actual)) return `Routine plan: ${planned} min · live timing was not recorded`;
  const difference = actual - planned;
  const comparison = Math.abs(difference) <= 1 ? "on time" : difference > 0 ? `${difference} min over` : `${Math.abs(difference)} min quicker`;
  return `Routine time: ${actual} min · plan ${planned} min · ${comparison}`;
}
function MorningSection({ user }) {
  const homeTimeZone = DEFAULT_HOME_TIME_ZONE;
  const today = useZonedDateKey(homeTimeZone);
  const previousTodayRef = useRef(today);
  const [view, setView] = useState("home");
  const [rotationFrom, setRotationFrom] = useState("home"); // Alternating Days goes back to where it was opened
  // Each screen change starts at the top, not wherever the last screen was scrolled to.
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  const [setupStep, setSetupStep] = useState(0);
  const [wakeTime, setWakeTime] = useState("06:00");
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [customTask, setCustomTask] = useState("");
  const [customTaskDuration, setCustomTaskDuration] = useState(""); // empty: 10 minutes, shown faintly
  const [scheduledTasks, setScheduledTasks] = useState([]);
  const [setupReviewVisited, setSetupReviewVisited] = useState(false);
  const DEFAULT_DAY_GROUPS = [{ id: "A", name: "Day A" }, { id: "B", name: "Day B" }];
  // Empty means alternating days are off.
  const [dayGroups, setDayGroups] = useState([]);
  const [confirmChangeRoutine, setConfirmChangeRoutine] = useState(false);
  const [editingDate, setEditingDate] = useState(null);
  const [trainingDays, setTrainingDays] = useState([]);
  const [openHistoryDate, setOpenHistoryDate] = useState(null);
  const [pendingLiveStart, setPendingLiveStart] = useState(null);
  // "end" | "delete" | { deleteDate } while a confirmation is open.
  const [morningConfirm, setMorningConfirm] = useState(null);
  const [morningActionError, setMorningActionError] = useState("");
  const [weightUnit, setWeightUnit] = useState(() => {
    try { return localStorage.getItem("track3d-weight-unit") === "st" ? "st" : "kg"; } catch { return "kg"; }
  });
  const chooseWeightUnit = unit => {
    setWeightUnit(unit);
    try { localStorage.setItem("track3d-weight-unit", unit); } catch { /* Unit preference is a convenience only. */ }
  };
  const [routineSavedNotice, setRoutineSavedNotice] = useState(false);
  const [routineSaveError, setRoutineSaveError] = useState("");
  const setupSnapshotRef = useRef(null);
  const [checkinStep, setCheckinStep] = useState(0);
  const [checkinData, setCheckinData] = useState({});
  const [tempInput, setTempInput] = useState("");
  const [photoAngleIdx, setPhotoAngleIdx] = useState(0);
  const [photoFiles, setPhotoFiles] = useState({ front: null, side: null, back: null });
  const [photoPreviews, setPhotoPreviews] = useState({ front: null, side: null, back: null });
  const [savingCheckin, setSavingCheckin] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [completedToday, setCompletedToday] = useState(false);
  const [skippedToday, setSkippedToday] = useState(false);
  const [olderCheckins, setOlderCheckins] = useState([]); // beyond the 30 loaded into history, for the streak only
  const [showMissedRoutineChoice, setShowMissedRoutineChoice] = useState(false);
  const [savingSkippedMorning, setSavingSkippedMorning] = useState(false);
  const [skipMorningError, setSkipMorningError] = useState("");
  const [reviewingMissed, setReviewingMissed] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [completedAction, setCompletedAction] = useState(null);
  const [editSubmissionData, setEditSubmissionData] = useState({});
  const [submissionError, setSubmissionError] = useState("");
  // Live Morning
  const [liveTaskIndex, setLiveTaskIndex] = useState(0);
  const [liveDeadline, setLiveDeadline] = useState(null);
  const [liveNow, setLiveNow] = useState(0);
  const liveSecondsLeft = liveDeadline ? Math.max(0, Math.ceil((liveDeadline - liveNow) / 1000)) : 0;
  const [liveStartedAt, setLiveStartedAt] = useState(null);
  const [liveInputActive, setLiveInputActive] = useState(false);

  // Set once the complete screen has saved the morning; the draft is then
  // cleared so the "active morning routine" banner goes away on its own.
  const [finalisedDraft, setFinalisedDraft] = useState(null);
  const morningDraft = useMemo(() => (
    ["liveMorning", "checkin", "wakeCheckin"].includes(view)
      && !(view === "checkin" && finalisedDraft && checkinStep >= finalisedDraft.step && JSON.stringify(checkinData) === finalisedDraft.key) ? {
      view, checkinStep, checkinData, tempInput, photoAngleIdx, photoFiles,
      liveTaskIndex, liveDeadline, liveStartedAt, liveInputActive,
    } : null
  ), [view, checkinStep, checkinData, tempInput, photoAngleIdx, photoFiles,
    liveTaskIndex, liveDeadline, liveStartedAt, liveInputActive, finalisedDraft]);
  // The live routine's tasks, for the in-progress banner line.
  const liveRoutineStepsRef = useRef([]);
  useSessionDraft(user?.id, `morning-${today}`, morningDraft, draft => {
    if (!["liveMorning", "checkin", "wakeCheckin"].includes(draft.view)) return;
    setCheckinStep(draft.checkinStep || 0);
    setCheckinData(draft.checkinData || {});
    setTempInput(draft.tempInput || "");
    setPhotoAngleIdx(draft.photoAngleIdx || 0);
    setPhotoFiles(draft.photoFiles || { front: null, side: null, back: null });
    setPhotoPreviews(Object.fromEntries(["front", "side", "back"].map(angle => [
      angle, draft.photoFiles?.[angle] ? URL.createObjectURL(draft.photoFiles[angle]) : null,
    ])));
    setLiveTaskIndex(draft.liveTaskIndex || 0);
    setLiveDeadline(draft.liveDeadline || null);
    setLiveStartedAt(draft.liveStartedAt || null);
    setLiveInputActive(Boolean(draft.liveInputActive));
    setLiveNow(Date.now());
    setView(draft.view);
  }, draft => (draft.view === "liveMorning"
    ? [`Task ${(draft.liveTaskIndex || 0) + 1} of ${liveRoutineStepsRef.current.length || "?"}`, liveRoutineStepsRef.current[draft.liveTaskIndex || 0]?.name].filter(Boolean).join(" · ")
    : "Check-in in progress"));
  const fileRef = useRef(null);

  const NON_NEGS = [
    { id: "sleep", name: "Log last night's sleep", type: "sleep", icon: "😴", duration: 1 },
    { id: "weight", name: "Check body weight", type: "number", unit: "kg", icon: "⚖️", duration: 2 },
    { id: "photos", name: "Take progress photos", type: "photos3", icon: "📸", duration: 3 },
  ];
  const LOCKED_LAST = { id: "checkin", name: "TRACK3D Morning Check-in", type: "tick", icon: "📱", duration: 2 };
  const PHOTO_ANGLES = ["front", "side", "back"];

  // Load routine and history from Supabase on mount
  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, today]);

  useEffect(() => {
    if (previousTodayRef.current === today) return;
    previousTodayRef.current = today;
    setView("home");
    setCompletedToday(false);
    setSkippedToday(false);
    setShowMissedRoutineChoice(false);
    setCompletedAction(null);
    setCheckinStep(0);
    setCheckinData({});
    setTempInput("");
    setPhotoAngleIdx(0);
    setPhotoFiles({ front: null, side: null, back: null });
    setPhotoPreviews({ front: null, side: null, back: null });
    setLiveTaskIndex(0);
    setLiveDeadline(null);
    setLiveStartedAt(null);
    setLiveInputActive(false);
  }, [today]);

  const loadData = async () => {
    setLoading(true);
    try {
      // The routine and the training plan load together, so each shares the
      // identical read the dashboard and Fitness make at the same moment.
      const [{ data: routineData }, { data: planData }] = await Promise.all([readMorningRoutine(user.id), readWorkoutSplit(user.id)]);

      if (routineData) {
        setWakeTime(routineData.wake_time || "06:00");
        // Older routines stored the sleep step as "Work out sleep duration".
        setScheduledTasks((routineData.tasks || []).map(task => task.id === "sleep" && task.name === "Work out sleep duration" ? { ...task, name: "Log last night's sleep" } : task));
        setDayGroups(Array.isArray(routineData.day_groups) && routineData.day_groups.length >= 2 ? routineData.day_groups : []);
        setIsSetup(true);
      }

      // Training plan days, so alternating days can follow the plan.
      setTrainingDays([...new Set((planData?.sessions || []).flatMap(session => session.days || []).map(day => String(day).toUpperCase()))]);

      // Load checkins
      const { data: checkinHistory } = await supabase
        .from("morning_checkins")
        .select("*")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(30);

      if (checkinHistory) {
        setHistory(checkinHistory);
        // A streak can run past the 30 most recent days, so read older dates too.
        if (checkinHistory.length >= 30) {
          const { data: older } = await supabase.from("morning_checkins").select("date,data")
            .eq("user_id", user.id).lt("date", checkinHistory[checkinHistory.length - 1].date)
            .order("date", { ascending: false }).limit(336);
          setOlderCheckins(older || []);
        } else {
          setOlderCheckins([]);
        }
        const todayEntry = checkinHistory.find(c => c.date === today);
        setCompletedToday(Boolean(todayEntry) && !todayEntry?.data?.inProgress);
        setSkippedToday(Boolean(todayEntry?.data?.routineSkipped));
      }
    } catch (e) {
      console.log("Load error:", e);
    }
    setLoading(false);
  };

  // Returns { ok, error }. Callers must not report "saved" unless ok is true.
  const saveRoutine = async (tasks, groups = dayGroups) => {
    if (!user) return { ok: false, error: "not signed in" };
    try {
      const { error } = await supabase.from("morning_routines").upsert({
        user_id: user.id,
        wake_time: wakeTime,
        tasks: tasks,
        day_groups: groups,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      setRoutineSaveError("");
      return { ok: true };
    } catch (error) {
      const message = error?.message || "connection problem";
      setRoutineSaveError(`Your routine could not be saved: ${message}. Please try again.`);
      return { ok: false, error: message };
    }
  };

  // Mini-save: while the Edit Routine or Alternating Days screen is open,
  // persist every change to the tasks, wake time or day groups as it
  // happens, instead of only on the final Save button - so leaving/closing
  // mid-edit doesn't lose the changes.
  useEffect(() => {
    if (!user || !["editRoutine", "rotationSetup"].includes(view)) return;
    saveRoutine(scheduledTasks, dayGroups);
  }, [scheduledTasks, wakeTime, dayGroups, view, user]);

  // created_at is only sent when today's row is first written, so later
  // saves (autosave, finishing, redo) keep the original time.
  const checkinRowSavedRef = useRef(null);
  const saveCheckin = async (data, score, { inProgress = false } = {}) => {
    if (!user) return;
    const withBasis = { ...data, scoreBasis: data.scoreBasis || scoreBasisOf(allSteps) };
    const rowExists = checkinRowSavedRef.current === today || history.some(entry => entry.date === today);
    const result = await supabase.from("morning_checkins").upsert({
      user_id: user.id,
      date: today,
      score: score,
      data: inProgress ? { ...withBasis, inProgress: true } : withBasis,
      ...(rowExists ? {} : { created_at: new Date().toISOString() }),
    }, { onConflict: "user_id,date" });
    if (!result.error) checkinRowSavedRef.current = today;
    return result;
  };

  // Mini-save: every time an answer lands in checkinData during the live
  // routine, persist it to Supabase straight away (marked inProgress so it
  // never counts as a finished day). This means leaving or refreshing mid
  // routine only ever loses the single in-flight step, not the whole morning.
  //
  // A completed row is never overwritten with an in-progress one: when today
  // is already finished (for example during "Do again"), answers stay in the
  // local draft only and are written once, when the new check-in completes.
  useEffect(() => {
    if (!user || loading || !checkinData || Object.keys(checkinData).length === 0) return;
    if (!["liveMorning", "checkin", "wakeCheckin"].includes(view)) return;
    // The complete screen writes the final row itself; do not race it.
    if (view === "checkin" && checkinStep >= checkinDoneIndex) return;
    const todayRow = history.find(entry => entry.date === today);
    if (todayRow && !todayRow.data?.inProgress) return;
    saveCheckin(checkinData, morningScore(checkinData), { inProgress: true }).catch(() => {});
  }, [checkinData, view, user, loading]);

  const calcFinishTime = (wake, tasks) => {
    if (!tasks?.length) return wake;

    const taskEnds = tasks
      .filter(t => t.scheduledTime)
      .map(t => {
        const [h, m] = t.scheduledTime.split(":").map(Number);
        return (h * 60) + m + (Number(t.duration) || 0);
      });

    if (!taskEnds.length) {
      const [h, m] = wake.split(":").map(Number);
      const totalMins = tasks.reduce((a, t) => a + (Number(t.duration) || 10), 0);
      const finishMins = h * 60 + m + totalMins;
      return `${String(Math.floor(finishMins / 60) % 24).padStart(2,"0")}:${String(finishMins % 60).padStart(2,"0")}`;
    }

    const finishMins = Math.max(...taskEnds);

    return `${String(Math.floor(finishMins / 60) % 24).padStart(2,"0")}:${String(finishMins % 60).padStart(2,"0")}`;
  };

  const toggleTask = (task) => {
    setSelectedTasks(prev =>
      prev.find(t => t.name === task.name)
        ? prev.filter(t => t.name !== task.name)
        : [...prev, { ...task, id: task.name, preferredTime: "" }]
    );
  };

  const updateSelectedTask = (index, field, value) => {
    setSelectedTasks(prev =>
      prev.map((task, i) =>
        i === index
          ? {
              ...task,
              [field]:
                field === "duration"
                  ? value === "" ? "" : clampTaskMinutes(value)
                  : value
            }
          : task
      )
    );
  };

  const addCustomTask = () => {
    if (!customTask.trim()) return;

    setSelectedTasks(prev => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        name: customTask.trim(),
        duration: clampTaskMinutes(customTaskDuration || 10),
        type: "tick",
        icon: ""
      }
    ]);

    setCustomTask("");
    setCustomTaskDuration("");
  };

  const buildSchedule = (orderedTasks) => {
    const [h, m] = wakeTime.split(":").map(Number);
    let cursor = h * 60 + m;

    const all = [
      ...(orderedTasks || [...NON_NEGS, ...selectedTasks]),
      LOCKED_LAST
    ];

    return all.map(task => {
      if (task.preferredTime) {
        const [preferredH, preferredM] = task.preferredTime.split(":").map(Number);
        const preferredMinutes = preferredH * 60 + preferredM;

        if (preferredMinutes > cursor) {
          cursor = preferredMinutes;
        }
      }

      const th = Math.floor(cursor / 60) % 24;
      const tm = cursor % 60;

      const time =
        `${String(th).padStart(2, "0")}:${String(tm).padStart(2, "0")}`;

      cursor += Number(task.duration) || 5;

      return {
        ...task,
        scheduledTime: time
      };
    });
  };
           

  const recalcTimes = (tasks) => {
    const [h, m] = wakeTime.split(":").map(Number);
    let cursor = h * 60 + m;
    return tasks.map(task => {
      const th = Math.floor(cursor / 60) % 24;
      const tm = cursor % 60;
      const time = `${String(th).padStart(2,"0")}:${String(tm).padStart(2,"0")}`;
      cursor += Number(task.duration) || 5;
      return { ...task, scheduledTime: time };
    });
  };

  // Keep Review times consecutive from the current wake time, and remember
  // that Review was opened so returning to Tasks keeps its order.
  useEffect(() => {
    if (view !== "setup") { setSetupReviewVisited(false); return; }
    if (setupStep !== 2) return;
    setSetupReviewVisited(true);
    setScheduledTasks(tasks => recalcTimes(tasks));
  }, [view, setupStep, wakeTime]);

  const startRoutineSetup = () => {
    const lockedIds = new Set([
      ...NON_NEGS.map(task => task.id),
      LOCKED_LAST.id
    ]);

    const existingHabits = scheduledTasks
      .filter(task => !lockedIds.has(task.id))
      .map(task => ({
        ...task,
        preferredTime: task.scheduledTime || ""
      }));

    setSelectedTasks(existingHabits);
    setupSnapshotRef.current = { scheduledTasks, wakeTime, returnView: view };
    setConfirmChangeRoutine(false);
    setSetupStep(0);
    setView("setup");
  };

  // Leave the setup wizard without changing the saved routine.
  const cancelRoutineSetup = () => {
    const snapshot = setupSnapshotRef.current;
    if (snapshot) {
      setScheduledTasks(snapshot.scheduledTasks);
      setWakeTime(snapshot.wakeTime);
    }
    setupSnapshotRef.current = null;
    setView(snapshot?.returnView === "editRoutine" ? "editRoutine" : "home");
  };

  const rotationGroups = dayGroups.length >= 2 ? dayGroups : DEFAULT_DAY_GROUPS;
  const epochDay = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  const todayDayCode = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${today}T12:00:00Z`).getUTCDay()];
  // Days tied to weekdays win; days without weekdays rotate by date as before.
  const weekdayGroup = rotationGroups.find(group => group.weekdays?.includes(todayDayCode));
  const rotatingGroups = rotationGroups.filter(group => !group.weekdays?.length);
  const rotationGroup = weekdayGroup
    || (rotatingGroups.length ? rotatingGroups[((epochDay % rotatingGroups.length) + rotatingGroups.length) % rotatingGroups.length] : null);
  const rotationDay = rotationGroup?.id || null;
  const dayGroupName = id => rotationGroups.find(g => g.id === id)?.name || `Day ${id}`;
  const alternatingOn = dayGroups.length >= 2;
  const activeScheduledTasks = alternatingOn
    ? scheduledTasks.filter(task => !task.routineDay || task.routineDay === "daily" || task.routineDay === rotationDay || task.id === "checkin")
    : scheduledTasks;
  const allSteps = scheduledTasks.length > 0 ? activeScheduledTasks : [...NON_NEGS, ...selectedTasks, LOCKED_LAST];

  const liveRoutineSteps = allSteps.filter(step => step.id !== "checkin");
  useEffect(() => { liveRoutineStepsRef.current = liveRoutineSteps; });
  const currentLiveTask = liveRoutineSteps[liveTaskIndex];
  // The routine's plan is every task, the check-in at the end included, so
  // it matches the minutes the task list adds up to. The live timer stops
  // before the check-in, which counts at its planned length.
  const routinePlannedMinutes = allSteps.reduce((total, step) => total + (Number(step.duration) || 0), 0);
  const checkinStepMinutes = Number(allSteps.find(step => step.id === "checkin")?.duration) || 0;
  const captureLiveRoutineTiming = () => ({
    plannedMinutes: routinePlannedMinutes,
    actualMinutes: liveStartedAt ? Math.max(1, Math.round((Date.now() - liveStartedAt) / 60000)) + checkinStepMinutes : null,
    completedAt: new Date().toISOString(),
  });

  const currentStep = allSteps[checkinStep];
  // The final "TRACK3D Morning Check-in" step is the check-in itself, so it is
  // never asked: reaching it completes the check-in.
  const lockedCheckinIndex = allSteps.findIndex(step => step.id === "checkin");
  const checkinDoneIndex = lockedCheckinIndex >= 0 && lockedCheckinIndex === allSteps.length - 1 ? lockedCheckinIndex : allSteps.length;

  // Check-in answers are keyed by step id (custom tasks use "custom-<timestamp>"),
  // so always show and send the task's name instead of its key.
  const morningStepName = key => {
    const step = [...scheduledTasks, ...NON_NEGS, ...selectedTasks, LOCKED_LAST].find(item => (item.id || item.name) === key);
    if (step) return step.name;
    return String(key).startsWith("custom-") ? "Custom task (since removed)" : key;
  };
  const morningCoachContext = (data, score, routineTimingText) => {
    const tasks = allSteps.filter(step => step.id !== "checkin").map(step => {
      const value = data[step.id || step.name];
      if (step.type === "tick") return { name: step.name, done: value === true ? true : value === false ? false : "not answered" };
      if (step.type === "photos3") return { name: step.name, done: Object.values(value || {}).some(item => item && !["skipped", "deferred"].includes(item)) };
      return { name: step.name, value: value || "not logged" };
    });
    const recentCheckins = history
      .filter(entry => entry.date !== today && !entry.data?.inProgress)
      .slice(0, 7)
      .map(entry => entry.data?.routineSkipped
        ? { date: entry.date, skipped: true }
        : { date: entry.date, score: entry.score, sleep: entry.data?.sleep || "not logged", weight: entry.data?.weight || "not logged" });
    return `Morning score: ${score}/10. Wake timing: ${wakeTimingSummary(data.wakeTiming)}. Routine timing: ${routineTimingText}.
Today's tasks (${tasks.length}): ${JSON.stringify(tasks)}.
Last ${recentCheckins.length} check-ins before today, newest first: ${recentCheckins.length ? JSON.stringify(recentCheckins) : "none recorded"}.`;
  };

  // Finalise the check-in as soon as the complete screen is reached, so
  // leaving by any route (not just "Back to Morning") records it as done.
  const checkinComplete = view === "checkin" && allSteps.length > 0 && checkinStep >= checkinDoneIndex;
  const finalisedCheckinRef = useRef(null);
  const finaliseCheckin = async () => {
    const draftKey = { key: JSON.stringify(checkinData), step: checkinStep };
    const score = morningScore(checkinData);
    const plannedRoutineMinutes = routinePlannedMinutes;
    const actualRoutineMinutes = checkinData.routineTiming?.actualMinutes || (liveStartedAt ? Math.max(1, Math.round((Date.now() - liveStartedAt) / 60000)) : null);
    setSavingCheckin(true);
    setSubmissionError("");
    const finalData = { ...checkinData, ...(lockedCheckinIndex >= 0 ? { checkin: true } : {}), routineTiming: { plannedMinutes: plannedRoutineMinutes, actualMinutes: actualRoutineMinutes, completedAt: new Date().toISOString() } };
    if (finalData.photos) {
      const uploaded = {};
      for (const angle of PHOTO_ANGLES) {
        const file = photoFiles[angle];
        if (!file) { uploaded[angle] = "skipped"; continue; }
        const path = `${user.id}/${today}/${angle}.jpg`;
        const { error } = await supabase.storage.from("checkin-photos").upload(path, file, { upsert: true });
        uploaded[angle] = error ? "skipped" : path;
      }
      finalData.photos = uploaded;
    }
    const { error } = await saveCheckin(finalData, score);
    setSavingCheckin(false);
    if (error) {
      setSubmissionError(error?.message ? `Your morning could not be saved: ${error.message}` : "Your morning could not be saved. Please try again.");
      return;
    }
    setCompletedToday(true);
    setSkippedToday(false);
    setFinalisedDraft(draftKey);
    setHistory(entries => [
      { ...(entries.find(entry => entry.date === today) || {}), user_id: user.id, date: today, score, data: finalData },
      ...entries.filter(entry => entry.date !== today),
    ]);
  };
  useEffect(() => {
    if (!checkinComplete) {
      if (view !== "checkin") finalisedCheckinRef.current = null;
      return;
    }
    if (!user || loading || savingCheckin) return;
    const key = JSON.stringify(checkinData);
    if (finalisedCheckinRef.current === key) return;
    finalisedCheckinRef.current = key;
    finaliseCheckin();
  }, [checkinComplete, checkinData, user, loading, savingCheckin, view]);
  const isRoughCheckin = view === "roughCheckin";
  const isLogCheckin = view === "logCheckin";

  // One scrolling form for logging a morning afterwards, a rough check-in,
  // redoing without the timer, and editing today's or a past entry.
  const openCheckinForm = (mode, { date = today, data = {} } = {}) => {
    setShowMissedRoutineChoice(false);
    setSkipMorningError("");
    setSubmissionError("");
    setEditingDate(date);
    setEditSubmissionData(data);
    setPhotoFiles({ front: null, side: null, back: null });
    setPhotoPreviews({ front: null, side: null, back: null });
    setView(mode === "rough" ? "roughCheckin" : mode === "edit" ? "editSubmission" : "logCheckin");
  };
  const startNormalMorningCheckin = () => openCheckinForm("log");
  const startRoughMorningCheckin = () => openCheckinForm("rough");

  const markMorningNotToday = async () => {
    if (savingSkippedMorning) return;
    setSavingSkippedMorning(true);
    setSkipMorningError("");
    try {
      const skippedData = {
        routineSkipped: true,
        skipReason: "routine_not_completed",
        recordedAt: new Date().toISOString(),
      };
      const { error } = await saveCheckin(skippedData, 0);
      if (error) throw error;
      setShowMissedRoutineChoice(false);
      setSkippedToday(true);
      setCompletedToday(true);
      await loadData();
    } catch {
      setSkipMorningError("We couldn't save this. Please try again.");
    } finally {
      setSavingSkippedMorning(false);
    }
  };

  useEffect(() => {
    if (!liveDeadline) return;
    const updateClock = () => setLiveNow(Date.now());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateClock);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", updateClock);
      document.removeEventListener("visibilitychange", updateClock);
    };
  }, [liveDeadline]);

  const startLiveTimer = (task) => {
    const now = Date.now();
    setLiveNow(now);
    setLiveDeadline(now + (Number(task?.duration) || 1) * 60000);
  };
  const recordLiveWakeTime = () => {
    const now = new Date();
    setCheckinData({
      wakeTiming: {
        actual: getZonedDateInfo(now, homeTimeZone).time,
        planned: wakeTime,
        source: "live",
        startedAt: now.toISOString(),
      },
    });
  };
  const moveToNextLiveTask = () => {
    const nextIndex = liveTaskIndex + 1;

    if (nextIndex >= liveRoutineSteps.length) {
      setLiveDeadline(null);
      setCheckinStep(allSteps.findIndex(step => step.id === "checkin"));
      setCheckinData(prev => {
        const updated = { ...prev, routineTiming: captureLiveRoutineTiming() };

        liveRoutineSteps.forEach(step => {
          const key = step.id || step.name;

          if (updated[key] === undefined && step.type === "tick") {
            updated[key] = true;
          }
        });

        return updated;
      });

      setTempInput("");
      setPhotoAngleIdx(0);
      setView("checkin");
      return;
    }

    setLiveTaskIndex(nextIndex);
    setTempInput("");
    setPhotoAngleIdx(0);
    startLiveTimer(liveRoutineSteps[nextIndex]);
  };

  const skipLiveTask = () => {
    if (!currentLiveTask) return;

    setCheckinData(prev => ({
      ...prev,
      [currentLiveTask.id || currentLiveTask.name]: false
    }));

    moveToNextLiveTask();
  };

  const completeLiveTask = () => {
    if (!currentLiveTask) return;

    setCheckinData(prev => ({
      ...prev,
      [currentLiveTask.id || currentLiveTask.name]: true
    }));
    // The same thing as a habit (Stretch / Mobility and "Stretch or move") ticks it too.
    window.dispatchEvent(new CustomEvent("track3d-task-done", { detail: { name: currentLiveTask.name } }));

    moveToNextLiveTask();
  };

  const finishLiveInputStep = () => {
    if (!liveInputActive) {
      setCheckinStep(s => reviewingMissed ? allSteps.length : s + 1);
      setReviewingMissed(false);
      return;
    }

    setLiveInputActive(false);

    const nextIndex = liveTaskIndex + 1;

    if (nextIndex >= liveRoutineSteps.length) {
      setLiveDeadline(null);
      setCheckinData(previous => ({ ...previous, routineTiming: captureLiveRoutineTiming() }));
      const checkinIndex = allSteps.findIndex(
        step => step.id === "checkin"
      );

      setCheckinStep(checkinIndex);
      setTempInput("");
      setView("checkin");
      return;
    }

    setLiveTaskIndex(nextIndex);
    startLiveTimer(liveRoutineSteps[nextIndex]);

    setTempInput("");
    setView("liveMorning");
  };

  // The steps a morning is scored against, saved with each check-in so that
  // editing a past day later scores it against that day's routine, not today's.
  const scoreBasisOf = steps => steps.map(step => ({ id: step.id || step.name, type: step.type }));
  const morningScore = (data, steps = data?.scoreBasis || allSteps) => {
    const total = steps.length;
    if (total === 0) return 0;
    let points = 0;
    steps.forEach(step => {
      const key = step.id || step.name;
      const val = data[key];
      if (step.type === "number" && val && val !== "") points++;
      else if (step.type === "sleep" && val && val !== "") points++;
      else if (step.type === "photos3" && val && Object.values(val).some(v => v && v !== "skipped")) points++;
      else if (step.type === "tick" && (val === true || step.id === "checkin")) points++;
    });
    return Math.round((points / total) * 10);
  };

  const finishTime = isSetup ? calcFinishTime(wakeTime, activeScheduledTasks) : "--:--";

  // 7-day chart data
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const dateStr = shiftDateKey(today, -(6 - i));
    const entry = history.find(h => h.date === dateStr && !h.data?.inProgress);
    return { date: dateStr, score: entry ? entry.score : null, label: dateKeyLabel(dateStr, { weekday: "short" }) };
  });

  // Inputs for sleep, number and photo steps. Shared by the check-in steps and
  // the live morning task card so input steps are answered in one place.
  const renderStepInputs = (step, onDone) => (
    <>
            {step.type === "number" && (
        <form style={{ width: "100%", maxWidth: 280 }} onSubmit={event => {
          event.preventDefault();
          if (!tempInput) return;
          setCheckinData(d => ({ ...d, [step.id]: tempInput }));
          setTempInput("");
          onDone();
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
            {step.id === "weight" ? (
              <WeightEntry kgValue={tempInput} onKgChange={setTempInput} unit={weightUnit} onUnitChange={chooseWeightUnit} />
            ) : (
              <>
                <input className="t3d-input" type="number" inputMode="decimal" placeholder={`Enter ${step.unit}...`}
                  value={tempInput} onChange={e => setTempInput(e.target.value)}
                  style={{ textAlign: "center", fontSize: 24, padding: 16 }} />
                <span style={{ color: "#E0EAF0", fontSize: 14 }}>{step.unit}</span>
              </>
            )}
          </div>
          <button type="submit" className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={!tempInput}>
            CONFIRM →
          </button>
          {step.id === "weight" && (
            <button
              type="button"
              onClick={() => {
                setCheckinData(d => ({ ...d, [step.id]: "" }));
                setTempInput("");
                onDone();
              }}
              style={{ background: "none", border: 0, color: "#6F8792", cursor: "pointer", fontSize: 10, marginTop: 8, padding: 5, textDecoration: "underline" }}
            >
              I&apos;M NOT SURE — SKIP
            </button>
          )}
        </form>
      )}

      {step.type === "sleep" && (
        <form style={{ width: "100%", maxWidth: 280 }} onSubmit={event => {
          event.preventDefault();
          if (!tempInput) return;
          setCheckinData(d => ({ ...d, [step.id]: tempInput }));
          setTempInput("");
          onDone();
        }}>
          <input className="t3d-input" aria-label="Hours slept" placeholder="e.g. 7h 30m" value={tempInput} enterKeyHint="done"
            onChange={e => setTempInput(e.target.value)}
            style={{ textAlign: "center", fontSize: 20, padding: 16, marginBottom: 16 }} />
          <button type="submit" className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={!tempInput}>
            CONFIRM →
          </button>
          <button
            type="button"
            onClick={() => {
              setCheckinData(d => ({ ...d, [step.id]: "" }));
              setTempInput("");
              onDone();
            }}
            style={{ background: "none", border: 0, color: "#6F8792", cursor: "pointer", fontSize: 10, marginTop: 8, padding: 5, textDecoration: "underline" }}
          >
            I&apos;M NOT SURE — SKIP
          </button>
        </form>
      )}

      {step.type === "photos3" && (() => {
        const angle = PHOTO_ANGLES[photoAngleIdx];
        const isLast = photoAngleIdx === PHOTO_ANGLES.length - 1;

        const finishPhotos = (filesOverride) => {
          const files = filesOverride || photoFiles;

          setCheckinData(d => ({
            ...d,
            photos: {
              front: files.front ? "captured" : "skipped",
              side: files.side ? "captured" : "skipped",
              back: files.back ? "captured" : "skipped",
            },
          }));

          onDone();
        };
        return (
          <div style={{ width: "100%", maxWidth: 280, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 2, marginBottom: 12 }}>
              PHOTO {photoAngleIdx + 1} OF 3 — {angle.toUpperCase()} ON
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => {
                const f = e.target.files[0];
                if (!f) return;
                setPhotoFiles(p => ({ ...p, [angle]: f }));
                setPhotoPreviews(p => ({ ...p, [angle]: URL.createObjectURL(f) }));
              }} />
            {photoPreviews[angle] ? (
              <div>
                <img src={photoPreviews[angle]} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: `2px solid ${NEON}`, marginBottom: 16 }} alt={angle} />
                <button className="t3d-btn" style={{ width: "100%", padding: 14 }}
                  onClick={() => isLast ? finishPhotos() : setPhotoAngleIdx(i => i + 1)}>
                  {isLast ? "CONFIRM →" : "NEXT ANGLE →"}
                </button>
              </div>
            ) : (
              <button className="t3d-btn" style={{ width: "100%", padding: 14, marginBottom: 12 }} onClick={() => fileRef.current?.click()}>
                📸 UPLOAD {angle.toUpperCase()} PHOTO
              </button>
            )}
            <div style={{ fontSize: 10, color: "#E0EAF0", margin: "16px 0 6px", lineHeight: 1.5 }}>
              You can skip photos or leave them until the final review.
            </div>
            <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginBottom: 7 }}
              onClick={() => {
                setCheckinData(data => ({ ...data, photos: Object.fromEntries(PHOTO_ANGLES.map(item => [item, photoFiles[item] ? "captured" : "deferred"])) }));
                onDone();
              }}>
              ADD PHOTOS AT THE END
            </button>
            <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", opacity: 0.6 }}
              onClick={() => finishPhotos()}>
              SKIP REMAINING PHOTOS
            </button>
          </div>
        );
      })()}

    </>
  );

  // Starting the guided morning records the wake-up time, so check first when
  // it is far from the planned wake-up (e.g. starting it late in the evening).
  const confirmLiveStart = start => {
    const [plannedH, plannedM] = wakeTime.split(":").map(Number);
    const [nowH, nowM] = getZonedDateInfo(new Date(), homeTimeZone).time.split(":").map(Number);
    const gap = Math.abs(((nowH * 60 + nowM) - (plannedH * 60 + plannedM) + 2160) % 1440 - 720);
    if (gap > 180) setPendingLiveStart(() => start);
    else start();
  };
  const startMyMorning = () => confirmLiveStart(() => {
    setLiveTaskIndex(0);
    startLiveTimer(liveRoutineSteps[0]);
    setLiveInputActive(false);
    setLiveStartedAt(Date.now());
    recordLiveWakeTime();
    setView("liveMorning");
  });
  // "Next up" on the dashboard starts (or finishes) this morning in one tap.
  // A tap made while this tab is still loading runs once it has loaded.
  const startMorningRef = useRef(null);
  const pendingMorningStartRef = useRef(false);
  useEffect(() => {
    startMorningRef.current = () => {
      if (loading) { pendingMorningStartRef.current = true; return; }
      if (view !== "home" || !isSetup) return;
      const todayEntry = history.find(entry => entry.date === today);
      if (todayEntry?.data?.inProgress) openCheckinForm("log", { data: { ...todayEntry.data } });
      else if (!todayEntry) startMyMorning();
    };
  });
  useEffect(() => {
    if (loading || !pendingMorningStartRef.current) return;
    pendingMorningStartRef.current = false;
    startMorningRef.current?.();
  }, [loading]);
  useEffect(() => {
    const start = event => { if (event.detail?.kind === "morning") startMorningRef.current?.(); };
    window.addEventListener("track3d-start", start);
    return () => window.removeEventListener("track3d-start", start);
  }, []);
  const liveStartDialog = pendingLiveStart ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div className="t3d-card" role="alertdialog" aria-modal="true" aria-labelledby="live-start-title" style={{ width: "100%", maxWidth: 360, borderColor: "#FFB547", textAlign: "center" }}>
        <div id="live-start-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#FFB547", letterSpacing: 2, marginBottom: 12 }}>START YOUR MORNING ROUTINE NOW?</div>
        <p style={{ fontSize: 11, color: "#A9BBC3", lineHeight: 1.6, marginBottom: 18 }}>
          {(() => {
            // One string: the compiler dropped the space after {time} when the text followed an expression.
            const now = getZonedDateInfo(new Date(), homeTimeZone).time;
            return `It is ${now} and your planned wake-up is ${wakeTime}. Starting now records ${now} as today's wake-up time. If you already did your morning, log it instead.`;
          })()}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="t3d-btn" style={{ minHeight: 44 }} onClick={() => { const start = pendingLiveStart; setPendingLiveStart(null); start(); }}>YES, START NOW</button>
          <button className="t3d-btn t3d-btn-sm" style={{ minHeight: 44 }} onClick={() => { setPendingLiveStart(null); startNormalMorningCheckin(); }}>LOG A MORNING I&apos;VE DONE</button>
          <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ minHeight: 44 }} onClick={() => setPendingLiveStart(null)}>CANCEL</button>
        </div>
      </div>
    </div>
  ) : null;

  // Finish now with whatever has been answered; unanswered tasks count as not done.
  const endMorningNow = () => {
    if (view === "liveMorning") {
      setLiveDeadline(null);
      setCheckinData(previous => ({ ...previous, routineTiming: captureLiveRoutineTiming() }));
    }
    setReviewingMissed(false);
    setLiveInputActive(false);
    setTempInput("");
    setCheckinStep(checkinDoneIndex);
    setView("checkin");
  };
  const resetMorningSession = () => {
    setCheckinData({});
    setCheckinStep(0);
    setTempInput("");
    setPhotoAngleIdx(0);
    setPhotoFiles({ front: null, side: null, back: null });
    setPhotoPreviews({ front: null, side: null, back: null });
    setLiveTaskIndex(0);
    setLiveDeadline(null);
    setLiveStartedAt(null);
    setLiveInputActive(false);
    setReviewingMissed(false);
  };
  // Discard the current session. Only an unfinished saved row is deleted; a
  // finished morning (for example during "Do again") is left as it was.
  // Removes a day's progress photos from storage once its check-in is
  // deleted. Returns an error message, or "" when nothing failed.
  const deleteDayPhotos = async date => {
    const folder = `${user.id}/${date}`;
    const { data: files, error: listError } = await supabase.storage.from("checkin-photos").list(folder);
    if (listError) return listError.message;
    if (!files?.length) return "";
    const { error } = await supabase.storage.from("checkin-photos").remove(files.map(file => `${folder}/${file.name}`));
    return error ? error.message : "";
  };
  const deleteMorningSession = async () => {
    setMorningActionError("");
    const todayRow = history.find(entry => entry.date === today);
    if (todayRow?.data?.inProgress) {
      const { error } = await supabase.from("morning_checkins").delete().eq("user_id", user.id).eq("date", today);
      if (error) { setMorningActionError(`Could not delete this session: ${error.message}`); return; }
      const photoError = await deleteDayPhotos(today);
      if (photoError) setMorningActionError(`The session was deleted, but its photos could not be removed: ${photoError}`);
    }
    checkinRowSavedRef.current = null;
    resetMorningSession();
    setMorningConfirm(null);
    setView("home");
    await loadData();
  };
  const deleteHistoryEntry = async date => {
    setMorningActionError("");
    const { error } = await supabase.from("morning_checkins").delete().eq("user_id", user.id).eq("date", date);
    if (error) { setMorningActionError(`Could not delete this day: ${error.message}`); return; }
    const photoError = await deleteDayPhotos(date);
    if (photoError) setMorningActionError(`The day was deleted, but its photos could not be removed: ${photoError}`);
    if (date === today) checkinRowSavedRef.current = null;
    setMorningConfirm(null);
    setOpenHistoryDate(null);
    if (date === today) resetMorningSession();
    await loadData();
  };
  const morningConfirmDialog = morningConfirm ? (() => {
    const deleteDate = morningConfirm.deleteDate;
    const redoing = !deleteDate && history.some(entry => entry.date === today && !entry.data?.inProgress);
    const title = morningConfirm === "end" ? "END MORNING NOW?" : deleteDate ? "DELETE THIS DAY?" : "DELETE THIS SESSION?";
    const body = morningConfirm === "end"
      ? "Your morning is saved with what you have done so far. Tasks you have not answered count as not done."
      : deleteDate
        ? "This permanently removes this day's check-in from your history."
        : redoing
          ? "This stops the redo. Your earlier check-in for today stays saved."
          : "This removes today's unfinished morning. You can start again afterwards.";
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
        <div className="t3d-card" role="alertdialog" aria-modal="true" aria-labelledby="morning-confirm-title" style={{ width: "100%", maxWidth: 360, borderColor: morningConfirm === "end" ? NEON : NEON3, textAlign: "center" }}>
          <div id="morning-confirm-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: morningConfirm === "end" ? NEON : NEON3, letterSpacing: 2, marginBottom: 12 }}>{title}</div>
          <p style={{ fontSize: 11, color: "#A9BBC3", lineHeight: 1.6, marginBottom: 18 }}>{body}</p>
          {morningActionError && <p role="alert" style={{ fontSize: 11, color: NEON3 }}>{morningActionError}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, minHeight: 44 }} onClick={() => { setMorningConfirm(null); setMorningActionError(""); }}>CANCEL</button>
            <button className={`t3d-btn t3d-btn-sm ${morningConfirm === "end" ? "" : "t3d-btn-red"}`} style={{ flex: 1, minHeight: 44 }}
              onClick={() => morningConfirm === "end" ? (setMorningConfirm(null), endMorningNow()) : deleteDate ? deleteHistoryEntry(deleteDate) : deleteMorningSession()}>
              {morningConfirm === "end" ? "END AND SAVE" : "DELETE"}
            </button>
          </div>
        </div>
      </div>
    );
  })() : null;
  // Session controls are plain grey so the main action on screen stands out.
  const secondaryButtonStyle = { background: "transparent", borderColor: "#31434F", color: "#C5D6DC" };
  const sessionControls = (canGoBack, onBack) => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="t3d-btn t3d-btn-sm" style={{ flex: 1, minHeight: 44, ...secondaryButtonStyle }} disabled={!canGoBack} onClick={onBack}>← BACK</button>
        <button type="button" className="t3d-btn t3d-btn-sm" style={{ flex: 1, minHeight: 44, ...secondaryButtonStyle }} onClick={() => setMorningConfirm("end")}>END MORNING</button>
      </div>
      <button type="button" onClick={() => setMorningConfirm("delete")}
        style={{ display: "block", margin: "10px auto 0", background: "none", border: 0, color: NEON3, cursor: "pointer", fontSize: 10, minHeight: 44, textDecoration: "underline" }}>
        Delete this session
      </button>
      {typeof morningConfirm === "string" && morningConfirmDialog}
    </div>
  );

  const scoreExplanation = (
    <details style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, margin: "8px auto", maxWidth: 430, textAlign: "left" }}>
      <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>How is the score worked out?</summary>
      Each task in your routine is worth an equal share of 10 points. A task counts when you tick it, log your sleep or weight, or add at least one progress photo. The check-in itself always counts. For example, with 10 tasks, skipping photos gives 9/10.
    </details>
  );

  const changeRoutineDialog = confirmChangeRoutine ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div className="t3d-card" role="alertdialog" aria-modal="true" aria-labelledby="change-routine-title" style={{ width: "100%", maxWidth: 360, borderColor: NEON3, textAlign: "center" }}>
        <div id="change-routine-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: NEON3, letterSpacing: 2, marginBottom: 12 }}>START YOUR ROUTINE AGAIN?</div>
        <p style={{ fontSize: 11, color: "#A9BBC3", lineHeight: 1.6, marginBottom: 18 }}>
          This rebuilds your routine from the wake-up step. Your current routine stays saved until you lock in the new one, and you can cancel at any step. To change a few tasks, use Edit Routine instead.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, minHeight: 44 }} onClick={() => setConfirmChangeRoutine(false)}>KEEP CURRENT</button>
          <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1, minHeight: 44 }} onClick={startRoutineSetup}>START AGAIN</button>
        </div>
      </div>
    </div>
  ) : null;

  if (loading) return (
    <div className="t3d-fade">
      <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 11, color: "#E0EAF0", letterSpacing: 2 }}>LOADING MORNING DATA...</div>
      </div>
    </div>
  );

  if (view === "wakeCheckin") {
    return (
      <div className="t3d-fade">
        <form className="t3d-card" onSubmit={event => {
          event.preventDefault();
          if (!checkinData.wakeTiming?.actual) return;
          setView("checkin");
        }}>
          <h2 className="t3d-ctitle">WHAT TIME DID YOU WAKE UP?</h2>
          <p style={{ fontSize: 12, color: "#8AABB8" }}>Your planned wake-up time was {wakeTime}. Enter when you actually woke up.</p>
          <label style={{ fontSize: 12 }}>
            Actual wake-up time
            <input className="t3d-input" type="time" required style={{ marginTop: 8, colorScheme: "dark" }}
              value={checkinData.wakeTiming?.actual || ""}
              onChange={event => setCheckinData(data => ({ ...data, wakeTiming: {
                actual: event.target.value, planned: wakeTime, source: "manual",
              } }))} />
          </label>
          {!checkinData.wakeTiming?.actual && (
            <button className="t3d-btn t3d-btn-sm" type="button" style={{ marginTop: 12 }}
              onClick={() => setCheckinData(data => ({ ...data, wakeTiming: { actual: wakeTime, planned: wakeTime, source: "manual" } }))}>
              I WOKE UP AT {wakeTime} AS PLANNED
            </button>
          )}
          <div style={{ display: "flex", gap: 14, marginTop: 20, alignItems: "center" }}>
            <button className="t3d-btn" type="submit" disabled={!checkinData.wakeTiming?.actual}
              style={{ flex: 1, padding: 14, background: checkinData.wakeTiming?.actual ? NEON : undefined, color: checkinData.wakeTiming?.actual ? "#06100D" : undefined, fontWeight: 800 }}>CONTINUE →</button>
            <button type="button" onClick={() => setView("home")} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 11, padding: 8, textDecoration: "underline" }}>Cancel</button>
          </div>
        </form>
      </div>
    );
  }
  // Correct a saved check-in or capture a lighter, all-at-once rough check-in.
  if (view === "editSubmission" || isRoughCheckin || isLogCheckin) {
    const formDate = editingDate || today;
    const isPastEntry = formDate !== today;
    const formSteps = allSteps.filter(step => step.id !== "checkin");
    const plannedRoutineMinutes = routinePlannedMinutes;
    const toggleStyle = selected => ({ flex: 1, minHeight: 44, borderColor: selected ? NEON : BORDER, color: selected ? NEON : "#8AABB8", background: selected ? "rgba(0,255,178,.1)" : "transparent" });
    // Logging a morning afterwards needs the wake-up time and an answer for
    // every task: nothing is assumed done or not done. The routine time is optional.
    const unansweredTicks = formSteps.filter(step => step.type === "tick" && typeof editSubmissionData[step.id || step.name] !== "boolean");
    const logMissing = isLogCheckin ? [
      ...(editSubmissionData.wakeTiming?.actual ? [] : ["your wake-up time"]),
      ...(unansweredTicks.length ? [`done or not done for ${unansweredTicks.length === 1 ? unansweredTicks[0].name : `${unansweredTicks.length} tasks`}`] : []),
    ] : [];
    return (
      <div className={`t3d-fade ${isRoughCheckin || isLogCheckin ? "t3d-rough-checkin" : ""}`}>
        <form className="t3d-card" onSubmit={async event => {
          event.preventDefault();
          if (savingCheckin || logMissing.length) return;
          setSavingCheckin(true);
          setSubmissionError("");
          try {
            const updatedData = {
              ...editSubmissionData,
              ...(isRoughCheckin ? { routineSkipped: false, roughCheckin: true } : {}),
              ...(isLogCheckin ? { routineSkipped: false, loggedAfter: true } : {}),
              ...(lockedCheckinIndex >= 0 ? { checkin: true } : {}),
            };
            // Saving the form finishes the entry, including an unfinished one from History.
            delete updatedData.inProgress;
            const updatedPhotos = { front: "skipped", side: "skipped", back: "skipped", ...editSubmissionData.photos };
            for (const angle of PHOTO_ANGLES) {
              const file = photoFiles[angle];
              if (!file) continue;
              const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
              const path = `${user.id}/${formDate}/${angle}.${extension}`;
              const { error: uploadError } = await supabase.storage.from("checkin-photos").upload(path, file, { upsert: true, contentType: file.type || undefined });
              if (uploadError) throw uploadError;
              updatedPhotos[angle] = path;
            }
            if (editSubmissionData.photos || PHOTO_ANGLES.some(angle => photoFiles[angle])) {
              updatedData.photos = updatedPhotos;
            }
            // A past day is scored against the routine saved with it. Older
            // entries saved before that keep their original score, because
            // the routine they were scored against is not known.
            const originalEntry = history.find(entry => entry.date === formDate);
            if (!isPastEntry && !updatedData.scoreBasis) updatedData.scoreBasis = scoreBasisOf(allSteps);
            const score = updatedData.scoreBasis
              ? morningScore(updatedData)
              : (originalEntry && !originalEntry.data?.inProgress ? originalEntry.score : morningScore(updatedData));
            const { error } = await supabase.from("morning_checkins").upsert({
              user_id: user.id,
              date: formDate,
              score,
              data: updatedData,
            }, { onConflict: "user_id,date" });
            if (error) throw error;
            await loadData();
            setView("home");
          } catch (error) {
            setSubmissionError(error?.message ? `Your changes could not be saved: ${error.message}` : "Your changes could not be saved. Please try again.");
          } finally {
            setSavingCheckin(false);
          }
        }}>
          <h2 className="t3d-ctitle">{isRoughCheckin ? "ROUGH MORNING CHECK-IN" : isLogCheckin ? "LOG THIS MORNING" : isPastEntry ? `EDIT ${new Date(`${formDate}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).toUpperCase()}` : "EDIT TODAY'S SUBMISSION"}</h2>
          <p style={{ fontSize: 12, color: "#8AABB8" }}>
            {isRoughCheckin
              ? "Add whatever you remember. It does not need to be perfect, and you can leave anything blank."
              : isLogCheckin
                ? "Fill in what you did this morning, then save."
                : "Correct your answers to reflect what actually happened."}
          </p>
          <label style={{ display: "block", fontSize: 12, margin: "16px 0" }}>
            Actual wake-up time{isLogCheckin ? " (required)" : ""}
            <input className="t3d-input" type="time" required={isLogCheckin} style={{ marginTop: 8, colorScheme: "dark" }}
              value={editSubmissionData.wakeTiming?.actual || ""}
              onChange={event => setEditSubmissionData(data => ({ ...data, wakeTiming: {
                ...data.wakeTiming,
                actual: event.target.value,
                planned: data.wakeTiming?.planned || wakeTime,
                source: "manual",
              } }))} />
          </label>
          <label style={{ display: "block", fontSize: 12, margin: "16px 0" }}>
            Routine time (minutes){isLogCheckin ? " (optional)" : ""}
            <input className="t3d-input" type="number" inputMode="numeric" min="1" max="600" style={{ marginTop: 8 }}
              placeholder={plannedRoutineMinutes ? `Planned: ${plannedRoutineMinutes} min` : "Minutes"}
              value={editSubmissionData.routineTiming?.actualMinutes ?? ""}
              onChange={event => setEditSubmissionData(data => ({ ...data, routineTiming: {
                ...data.routineTiming,
                plannedMinutes: data.routineTiming?.plannedMinutes || plannedRoutineMinutes,
                actualMinutes: event.target.value === "" ? null : Math.max(1, Math.round(Number(event.target.value)) || 1),
              } }))} />
          </label>
          <button type="button" className="t3d-btn t3d-btn-sm" style={{ minHeight: 44, width: "100%", marginBottom: 4 }}
            onClick={() => setEditSubmissionData(data => ({ ...data, ...Object.fromEntries(formSteps.filter(step => step.type === "tick").map(step => [step.id || step.name, true])) }))}>
            ✓ MARK ALL DONE
          </button>
          {formSteps.map(step => {
            const key = step.id || step.name;
            const value = editSubmissionData[key];
            return (
              <div key={key} style={{ padding: "14px 0", borderBottom: `1px solid ${BORDER}` }}>
                <label style={{ display: "block", fontSize: 12 }}>
                  {taskIcon(step)}{step.name}
                  {["sleep", "number"].includes(step.type) && step.id !== "weight" && (
                    <input className="t3d-input" style={{ marginTop: 8 }}
                      type={step.type === "number" ? "number" : "text"}
                      step={step.type === "number" ? "any" : undefined}
                      placeholder={step.type === "sleep" ? "e.g. 7h 30m" : step.unit}
                      value={typeof value === "string" || typeof value === "number" ? value : ""}
                      onChange={event => setEditSubmissionData(data => ({ ...data, [key]: event.target.value }))} />
                  )}
                </label>
                {step.id === "weight" && (
                  <div style={{ marginTop: 8 }}>
                    <WeightEntry kgValue={typeof value === "string" || typeof value === "number" ? String(value) : ""}
                      onKgChange={kg => setEditSubmissionData(data => ({ ...data, [key]: kg }))} unit={weightUnit} onUnitChange={chooseWeightUnit} />
                  </div>
                )}
                {step.type === "tick" && (
                  <div role="group" aria-label={step.name} style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-pressed={value === true} style={toggleStyle(value === true)}
                      onClick={() => setEditSubmissionData(data => ({ ...data, [key]: true }))}>✓ DONE</button>
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-pressed={value === false} style={{ ...toggleStyle(value === false), ...(value === false ? { borderColor: NEON3, color: NEON3, background: "rgba(255,45,120,.08)" } : {}) }}
                      onClick={() => setEditSubmissionData(data => ({ ...data, [key]: false }))}>✗ NOT DONE</button>
                  </div>
                )}
                {step.type === "photos3" && (
                  <div style={{ fontSize: 11, color: "#8AABB8", marginTop: 8 }}>
                    {PHOTO_ANGLES.map(angle => (
                      <div key={angle} style={{ marginBottom: 16 }}>
                        <label style={{ display: "block" }}>
                          {angle.toUpperCase()} — {photoFiles[angle] ? "New photo selected" : value?.[angle] && value[angle] !== "skipped" ? "Photo saved · choose a replacement below" : "No photo saved"}
                          <input type="file" accept="image/*" disabled={savingCheckin}
                            style={{ display: "block", marginTop: 8, maxWidth: "100%", fontSize: 11 }}
                            onChange={event => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              if (photoPreviews[angle]) URL.revokeObjectURL(photoPreviews[angle]);
                              setPhotoFiles(files => ({ ...files, [angle]: file }));
                              setPhotoPreviews(previews => ({ ...previews, [angle]: URL.createObjectURL(file) }));
                            }} />
                        </label>
                        {photoPreviews[angle] && (
                          <div style={{ marginTop: 8 }}>
                            <img src={photoPreviews[angle]} alt={`Selected ${angle} progress photo`}
                              style={{ width: 100, height: 120, objectFit: "cover", borderRadius: 6 }} />
                            <button className="t3d-btn t3d-btn-sm" type="button" disabled={savingCheckin}
                              style={{ display: "block", marginTop: 6 }} onClick={() => {
                                URL.revokeObjectURL(photoPreviews[angle]);
                                setPhotoFiles(files => ({ ...files, [angle]: null }));
                                setPhotoPreviews(previews => ({ ...previews, [angle]: null }));
                              }}>UNDO PHOTO CHANGE</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {isRoughCheckin ? "Photos are optional. Add only what you have." : "Photos you leave unchanged will be kept. New photos upload when you save."}
                  </div>
                )}
              </div>
            );
          })}
          {submissionError && <p role="alert" style={{ color: NEON3, fontSize: 12 }}>{submissionError}</p>}
          {logMissing.length > 0 && <p id="log-morning-missing" data-testid="log-morning-missing" style={{ color: "#FFB547", fontSize: 11, lineHeight: 1.5, margin: "16px 0 0" }}>To save, add {logMissing.join(", ").replace(/, ([^,]*)$/, " and $1")}.</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="t3d-btn" type="submit" disabled={savingCheckin || logMissing.length > 0} aria-describedby={logMissing.length ? "log-morning-missing" : undefined}>{savingCheckin ? "SAVING..." : isRoughCheckin ? "SAVE ROUGH CHECK-IN" : isLogCheckin ? "SAVE MORNING" : "SAVE CHANGES"}</button>
            <button className="t3d-btn t3d-btn-red" type="button" disabled={savingCheckin} onClick={() => setView("home")}>CANCEL</button>
          </div>
        </form>
      </div>
    );
  }
  // HOME view
  if (view === "home") {
    return (
      <div className="t3d-fade">
        {!isSetup ? (
          <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🌅</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, letterSpacing: 3, color: NEON, marginBottom: 8 }}>MORNING ROUTINE</div>
            <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 28, lineHeight: 1.7 }}>
              Build your optimal morning routine.<br />Track it every day. Win every morning.
            </div>
            <button className="t3d-btn" style={{ fontSize: 11, padding: "14px 28px" }} onClick={() => setView("setup")}>
              SET UP MY MORNING
            </button>
          </div>
        ) : (
          <>
            <div className="t3d-grid3">
              <div className="t3d-card" style={{ textAlign: "center" }}>
                <h2 className="t3d-ctitle">WAKE UP</h2>
                <div className="t3d-sval" style={{ color: NEON, fontSize: 24 }}>{wakeTime}</div>
              </div>
              <div className="t3d-card" style={{ textAlign: "center" }}>
                <h2 className="t3d-ctitle">FINISH BY</h2>
                <div className="t3d-sval" style={{ color: NEON2, fontSize: 24 }}>{finishTime}</div>
              </div>
              <div className="t3d-card" style={{ textAlign: "center" }}>
                <h2 className="t3d-ctitle">TASKS</h2>
                <div className="t3d-sval" style={{ color: "#FF8C00", fontSize: 24 }}>{allSteps.length}</div>
              </div>
            </div>

            {/* Check-in button or completed state */}
            <div className="t3d-card" style={{ marginBottom: 16, textAlign: "center", padding: 32 }}>
              {(() => {
                const oldestLoaded = history[history.length - 1]?.date;
                const streak = morningStreak([...history, ...olderCheckins.filter(entry => !oldestLoaded || entry.date < oldestLoaded)], today);
                if (!streak || skippedToday) return null;
                const doneToday = history.some(entry => entry.date === today && countsForMorningStreak(entry));
                const loggedToday = history.some(entry => entry.date === today && !entry.data?.inProgress);
                return (
                  <div data-testid="morning-streak" style={{ display: "inline-block", marginBottom: 18, padding: "6px 14px", border: "1px solid rgba(255,140,0,.45)", borderRadius: 20, background: "rgba(255,140,0,.07)", fontFamily: "'Orbitron',monospace", fontSize: 10, letterSpacing: 1.5, color: "#FF8C00" }}>
                    🔥 {streak}-DAY MORNING STREAK{doneToday ? "" : loggedToday ? ` · TODAY WAS UNDER ${STREAK_MIN_MORNING_SCORE}/10, SO IT DOESN'T COUNT` : " · FINISH TODAY TO KEEP IT GOING"}
                  </div>
                );
              })()}
              {completedToday ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>{skippedToday ? "↗" : "✅"}</div>
                  <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, color: NEON, letterSpacing: 2, marginBottom: 8 }}>
                    {skippedToday ? "RESET FOR TOMORROW" : (() => {
                      const todayEntry = history.find(h => h.date === today);
                      const todayData = todayEntry?.data;
                      // Under half the routine done: logged, not "complete".
                      return todayEntry && !countsForMorningStreak(todayEntry) ? "MORNING LOGGED" : todayData?.roughCheckin || todayData?.loggedAfter ? "MORNING LOGGED" : "MORNING COMPLETE";
                    })()}
                  </div>
                  {skippedToday ? (
                    <>
                      <p style={{ fontSize: 12, color: "#E0EAF0", lineHeight: 1.7, maxWidth: 430, margin: "0 auto 14px" }}>
                        You can&apos;t change the past, but you can change the future. Get after it tomorrow morning.
                      </p>
                      <button type="button" className="t3d-btn t3d-btn-sm" onClick={startRoughMorningCheckin}>
                        FILL IT IN ANYWAY
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: "#E0EAF0", letterSpacing: 1 }}>
                        Score: {history.find(h => h.date === today)?.score || 0}/10 · Come back tomorrow!
                      </div>
                      {scoreExplanation}
                      <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.7 }}>
                        {wakeTimingSummary(history.find(h => h.date === today)?.data?.wakeTiming)}
                      </p>
                      <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.7, marginTop: -6 }}>
                        {routineTimingSummary(history.find(h => h.date === today)?.data?.routineTiming)}
                      </p>
                  <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 14 }}>
                    <button type="button" onClick={() => { setCompletedAction(null); openCheckinForm("edit", { data: { ...(history.find(entry => entry.date === today)?.data || {}) } }); }}
                      style={{ background: "none", border: 0, color: "#8AABB8", fontSize: 11, textDecoration: "underline", minHeight: 44, padding: "8px 10px", cursor: "pointer" }}>
                      Edit submission
                    </button>
                    <button type="button" onClick={() => setCompletedAction(action => action === "redo" ? null : "redo")}
                      style={{ background: "none", border: 0, color: "#8AABB8", fontSize: 11, textDecoration: "underline", minHeight: 44, padding: "8px 10px", cursor: "pointer" }}>
                      Do again
                    </button>
                  </div>
                  {completedAction === "redo" && (
                    <div style={{ marginTop: 10, padding: 14, border: "1px solid #FFB547", background: "rgba(255,181,71,.08)", borderRadius: 8, textAlign: "left" }}>
                      <p style={{ fontSize: 12, color: "#E0EAF0", lineHeight: 1.6, margin: "0 0 10px" }}>
                        Choose Redo with guided timer or Redo without timer. Today&apos;s check-in stays saved until you finish the new one.
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="t3d-btn t3d-btn-sm" type="button" style={{ minHeight: 44 }} onClick={() => confirmLiveStart(() => {
                          setCompletedAction(null);
                          setSubmissionError("");
                          setCheckinData({});
                          setCheckinStep(0);
                          setTempInput("");
                          setPhotoAngleIdx(0);
                          setPhotoFiles({ front: null, side: null, back: null });
                          setPhotoPreviews({ front: null, side: null, back: null });
                          setLiveInputActive(false);
                          setLiveTaskIndex(0);
                          startLiveTimer(liveRoutineSteps[0]);
                          setLiveStartedAt(Date.now());
                          recordLiveWakeTime();
                          setView("liveMorning");
                        })}>REDO WITH GUIDED TIMER</button>
                        <button className="t3d-btn t3d-btn-sm" type="button" style={{ minHeight: 44 }} onClick={() => {
                          setCompletedAction(null);
                          openCheckinForm("log");
                        }}>REDO WITHOUT TIMER</button>
                        <button className="t3d-btn t3d-btn-sm t3d-btn-red" type="button" style={{ minHeight: 44 }} onClick={() => setCompletedAction(null)}>CANCEL</button>
                      </div>
                    </div>
                  )}
                      {(() => {
                        const todayEntry = history.find(h => h.date === today);
                        if (!todayEntry?.data) return null;
                        return (
                          <div style={{ textAlign: "left", margin: "12px 0" }}>
                            <AICoach
                              title="MORNING COACH"
                              introduction="Ask about today's result, timing, or what to improve tomorrow."
                              activationLabel="CHAT ABOUT THIS MORNING"
                              openingMessage="Give me a short, useful review of this morning. Lead with how I did against my planned timing, then one practical improvement for tomorrow. Do not ask me a generic question."
                              storageKey={`morning-review-${user.id}-${today}`}
                              area="morning_review"
                              context={morningCoachContext(todayEntry.data, todayEntry.score || 0, routineTimingSummary(todayEntry.data.routineTiming))}
                            />
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              ) : (
                <>
                  {(() => {
                    const unfinished = history.find(entry => entry.date === today && entry.data?.inProgress);
                    if (!unfinished) return null;
                    return (
                      <div style={{ marginBottom: 18, padding: 14, border: "1px solid #FFB547", background: "rgba(255,181,71,.08)", borderRadius: 8, textAlign: "left" }}>
                        <div style={{ color: "#FFB547", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>STARTED · NOT FINISHED</div>
                        <p style={{ fontSize: 11, color: "#C5D6DC", lineHeight: 1.6, margin: "6px 0 10px" }}>You started this morning but it was not finished. Finish it now, or delete it and start again.</p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className="t3d-btn t3d-btn-sm" style={{ minHeight: 44 }} onClick={() => openCheckinForm("log", { data: { ...unfinished.data } })}>FINISH NOW</button>
                          <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ minHeight: 44 }} onClick={() => setMorningConfirm("delete")}>DELETE SESSION</button>
                        </div>
                        {morningConfirm === "delete" && morningConfirmDialog}
                      </div>
                    );
                  })()}
                  <div style={{
                    fontSize: 12,
                    color: "#E0EAF0",
                    marginBottom: 8,
                    letterSpacing: 1
                  }}>
                    READY TO START YOUR MORNING?
                  </div>

                  <div style={{
                    fontSize: 10,
                    color: "#8AABB8",
                    marginBottom: 20,
                    lineHeight: 1.6
                  }}>
                    Just woken up? Start the guided routine. Already finished? Log it afterwards.
                  </div>

                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10
                  }}>
                    <button
                      className="t3d-big-btn"
                      style={{
                        background: "linear-gradient(90deg, rgba(0,255,178,.15), rgba(0,200,255,.15))",
                        border: `1px solid ${NEON}`,
                        color: NEON,
                        fontSize: 13,
                        letterSpacing: 2
                      }}
                      onClick={startMyMorning}
                    >
                      ▶ START MY MORNING NOW
                      <span style={{ display: "block", fontFamily: "'Inter',sans-serif", fontSize: 10, letterSpacing: 0, fontWeight: 400, marginTop: 6, color: "#C0D4DE" }}>Guides you through each task with a timer</span>
                    </button>

                    <button
                      className="t3d-btn"
                      style={{
                        width: "100%",
                        padding: 14
                      }}
                      onClick={startNormalMorningCheckin}
                    >
                      ✓ I&apos;VE ALREADY DONE IT — LOG IT
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMissedRoutineChoice(open => !open);
                        setSkipMorningError("");
                      }}
                      style={{
                        alignSelf: "center",
                        background: "none",
                        border: 0,
                        color: "#6F8792",
                        cursor: "pointer",
                        fontSize: 10,
                        padding: "3px 6px",
                        minHeight: 44,
                        textDecoration: "underline",
                      }}
                    >
                      I didn&apos;t complete my morning routine
                    </button>
                    {showMissedRoutineChoice && (
                      <div style={{ padding: "12px 14px", border: "1px solid rgba(255,181,71,.35)", background: "rgba(255,181,71,.06)", borderRadius: 8, textAlign: "left" }}>
                        <div style={{ color: "#FFB547", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>CHECK IN HONESTLY IF YOU CAN</div>
                        <p style={{ color: "#A9BBC3", fontSize: 11, lineHeight: 1.55, margin: "7px 0 11px" }}>
                          Even if it wasn&apos;t ideal, fill it in anyway. A rough check-in is more useful than no data.
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <button type="button" className="t3d-btn t3d-btn-sm" onClick={startRoughMorningCheckin}>
                            FILL IN A ROUGH CHECK-IN
                          </button>
                          <button
                            type="button"
                            disabled={savingSkippedMorning}
                            onClick={markMorningNotToday}
                            style={{ background: "none", border: 0, color: NEON3, cursor: savingSkippedMorning ? "wait" : "pointer", fontSize: 10, padding: 6, textDecoration: "underline" }}
                          >
                            {savingSkippedMorning ? "SAVING..." : "NOT TODAY"}
                          </button>
                        </div>
                        {skipMorningError && <div role="alert" style={{ color: NEON3, fontSize: 10, marginTop: 8 }}>{skipMorningError}</div>}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {changeRoutineDialog}
            {liveStartDialog}
            {routineSavedNotice && (
              <div role="status" style={{ marginBottom: 16, padding: "12px 14px", border: `1px solid ${NEON}`, background: "rgba(0,255,178,.08)", borderRadius: 7, color: NEON, fontSize: 12 }}>
                ✓ Routine saved
              </div>
            )}
            {/* Today's schedule */}
            <div className="t3d-card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h2 className="t3d-ctitle" style={{ margin: 0 }}>TODAY&apos;S SCHEDULE{alternatingOn && rotationDay ? ` · ${dayGroupName(rotationDay).toUpperCase()}` : ""}</h2>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
  <button
    className="t3d-btn t3d-btn-sm"
    style={{ minHeight: 44 }}
    onClick={() => setView("editRoutine")}
  >
    EDIT ROUTINE
  </button>

  <button
    className="t3d-btn t3d-btn-sm"
    style={{ minHeight: 44 }}
    onClick={() => { setRotationFrom("home"); setView("rotationSetup"); }}
  >
    ALTERNATING DAYS
  </button>

  <button
    className="t3d-btn t3d-btn-sm t3d-btn-red"
    style={{ minHeight: 44 }}
    onClick={() => setConfirmChangeRoutine(true)}
  >
    CHANGE ROUTINE
  </button>
</div>
              </div>
              {activeScheduledTasks.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: NEON2, width: 45 }}>{t.scheduledTime}</div>
                  <div style={{ flex: 1, fontSize: 12 }}>{taskIcon(t)}{t.name}{alternatingOn && t.routineDay && t.routineDay !== "daily" ? ` · ${dayGroupName(t.routineDay).toUpperCase()}` : ""}</div>
                  <div style={{ fontSize: 10, color: "#E0EAF0" }}>{t.duration}min</div>
                </div>
              ))}
            </div>

            {/* 7-day chart */}
            <div className="t3d-card" style={{ marginBottom: 16 }}>
              <h2 className="t3d-ctitle">7-DAY MORNING SCORES <span style={{ color: "#6F8792" }}>· OUT OF 10</span></h2>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80, padding: "0 4px" }}>
                {last7.map((d, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", position: "relative", height: 60, display: "flex", alignItems: "flex-end" }}>
                      <div style={{
                        width: "100%",
                        height: d.score !== null ? `${(d.score / 10) * 100}%` : "4px",
                        background: d.score !== null
                          ? d.score >= 7 ? NEON : d.score >= 4 ? "#FF8C00" : NEON3
                          : BORDER,
                        borderRadius: "3px 3px 0 0",
                        transition: "height .6s cubic-bezier(.16,1,.3,1)",
                        boxShadow: d.score !== null && d.score >= 7 ? `0 0 6px ${NEON}60` : "none",
                        minHeight: 4,
                      }} />
                    </div>
                    <div style={{ fontSize: 9, color: d.date === today ? NEON : "#6F8792", letterSpacing: 0.5 }}>{d.label}</div>
                    {d.score !== null && <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, color: "#E0EAF0" }}>{d.score}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* History accordion */}
            <div className="t3d-card">
              <h2 className="t3d-ctitle" style={{ margin: 0 }}>
              <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(h => !h)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", minHeight: 44, padding: 0, background: "none", border: 0, color: "inherit", font: "inherit", letterSpacing: "inherit", textTransform: "inherit", textAlign: "left", cursor: "pointer" }}>
                MORNING HISTORY
                <span aria-hidden="true" style={{ color: "#E0EAF0", fontSize: 14, transition: "transform .2s", transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
              </button>
            </h2>
              {historyOpen && (
                <div style={{ marginTop: 16 }}>
                  {history.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#E0EAF0", textAlign: "center", padding: "16px 0" }}>No history yet — complete your first morning check-in!</div>
                  ) : (
                    history.map(entry => {
                      const data = entry.data || {};
                      const unfinished = Boolean(data.inProgress);
                      const isOpen = openHistoryDate === entry.date;
                      const taskEntries = Object.entries(data).filter(([key]) => !HIDDEN_CHECKIN_KEYS.has(key));
                      return (
                        <div key={entry.date} style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <button type="button" aria-expanded={isOpen} onClick={() => setOpenHistoryDate(isOpen ? null : entry.date)}
                            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 44, padding: "10px 0", background: "none", border: 0, color: "inherit", cursor: "pointer", textAlign: "left" }}>
                            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#E0EAF0", width: 80 }}>
                              {new Date(`${entry.date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })}
                            </div>
                            <div style={{ flex: 1, fontSize: 10, color: "#8AABB8" }}>
                              {data.routineSkipped ? "Skipped" : unfinished ? "Started · not finished" : !countsForMorningStreak(entry) ? `Under half done · not in streak` : data.roughCheckin ? "Rough check-in" : data.loggedAfter ? "Logged afterwards" : "Completed"}
                            </div>
                            <div style={{
                              fontFamily: "'Orbitron',monospace", fontSize: 13, fontWeight: 700,
                              color: unfinished || data.routineSkipped ? "#6F8792" : entry.score >= 7 ? NEON : entry.score >= 4 ? "#FF8C00" : NEON3
                            }}>{unfinished || data.routineSkipped ? "—" : `${entry.score}/10`}</div>
                            <span aria-hidden="true" style={{ color: "#8AABB8", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                          </button>
                          {isOpen && (
                            <div style={{ padding: "0 0 14px", fontSize: 11, color: "#C5D6DC", lineHeight: 1.6 }}>
                              <div>{wakeTimingSummary(data.wakeTiming)}</div>
                              <div>{routineTimingSummary(data.routineTiming)}</div>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "8px 0" }}>
                                {taskEntries.map(([k, v]) => (
                                  <span key={k} style={{
                                    fontSize: 9, padding: "2px 6px", borderRadius: 10,
                                    background: v === true ? "rgba(0,255,178,.1)" : v === false ? "rgba(255,45,120,.1)" : "rgba(0,200,255,.1)",
                                    color: v === true ? NEON : v === false ? NEON3 : NEON2,
                                    border: `1px solid ${v === true ? "rgba(0,255,178,.2)" : v === false ? "rgba(255,45,120,.2)" : "rgba(0,200,255,.2)"}`,
                                  }}>
                                    {morningStepName(k)}: {v === true ? "✓" : v === false ? "✗" : k === "weight" && v ? `${v} kg` : String(v || "—")}
                                  </span>
                                ))}
                              </div>
                              <CheckinPhotoThumbs photos={data.photos} />
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                <button type="button" className="t3d-btn t3d-btn-sm" style={{ minHeight: 44 }}
                                  onClick={() => openCheckinForm("edit", { date: entry.date, data: { ...data } })}>
                                  {unfinished ? "FINISH THIS CHECK-IN" : "EDIT THIS DAY"}
                                </button>
                                <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ minHeight: 44 }}
                                  onClick={() => setMorningConfirm({ deleteDate: entry.date })}>
                                  DELETE THIS DAY
                                </button>
                              </div>
                              {morningConfirm?.deleteDate === entry.date && morningConfirmDialog}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // EDIT ROUTINE view
  if (view === "editRoutine") {
    return (
      <>
      {routineSaveError && <div role="alert" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid rgba(255,45,120,.4)", background: "rgba(255,45,120,.07)", borderRadius: 6, color: "#FF8AAD", fontSize: 11, lineHeight: 1.5 }}>{routineSaveError}</div>}
      <MorningRoutineEditor
        wakeTime={wakeTime}
        setWakeTime={setWakeTime}
        scheduledTasks={scheduledTasks}
        setScheduledTasks={setScheduledTasks}
        dayGroups={dayGroups}
        onOpenRotationSetup={() => { setRotationFrom("editRoutine"); setView("rotationSetup"); }}
        onCancel={() => setView("home")}
        onRebuild={() => setConfirmChangeRoutine(true)}
        onSave={async () => {
          const saved = await saveRoutine(scheduledTasks);
          if (!saved.ok) return;
          setView("home");
          setRoutineSavedNotice(true);
          setTimeout(() => setRoutineSavedNotice(false), 4000);
        }}
      />
      {changeRoutineDialog}
      </>
    );
  }

  // ALTERNATING DAYS view - a dedicated, simpler screen for setting up and
  // naming rotation days, instead of a dropdown buried on every task row.
  if (view === "rotationSetup") {
    return (
      <RotationSetupScreen
        dayGroups={dayGroups}
        setDayGroups={setDayGroups}
        scheduledTasks={scheduledTasks}
        setScheduledTasks={setScheduledTasks}
        trainingDays={trainingDays}
        onDone={() => setView(rotationFrom)}
      />
    );
  }

  // SETUP view
  if (view === "setup") {
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          {routineSaveError && <div role="alert" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid rgba(255,45,120,.4)", background: "rgba(255,45,120,.07)", borderRadius: 6, color: "#FF8AAD", fontSize: 11, lineHeight: 1.5 }}>{routineSaveError}</div>}
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            {["WAKE TIME", "TASKS", "REVIEW"].map((s, i) => (
              <div key={i} style={{
                flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 5, fontSize: 9,
                letterSpacing: 1, fontFamily: "'Orbitron',monospace",
                background: setupStep === i ? "rgba(0,255,178,.08)" : "transparent",
                border: `1px solid ${setupStep === i ? NEON : BORDER}`,
                color: setupStep === i ? NEON : "#E0EAF0"
              }}>{s}</div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -12, marginBottom: 12 }}>
            <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ minHeight: 44 }} onClick={cancelRoutineSetup}>CANCEL</button>
          </div>
          {setupStep === 0 && (
            <div>
              <h2 className="t3d-ctitle">WHAT TIME DO YOU WANT TO WAKE UP?</h2>
              <div style={{ display: "flex", justifyContent: "center", margin: "32px 0" }}>
                <input type="time" value={wakeTime} onChange={e => setWakeTime(e.target.value)}
                  style={{ background: SURFACE2, border: `1px solid ${NEON}`, borderRadius: 8, padding: "16px 24px", color: NEON, fontSize: 28, outline: "none", textAlign: "center", colorScheme: "dark", minWidth: 180 }} />
              </div>
              <div style={{ fontSize: 11, color: "#E0EAF0", textAlign: "center", marginBottom: 24 }}>
                Your morning routine will be scheduled from this time
              </div>
              <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={() => setSetupStep(1)}>NEXT →</button>
            </div>
          )}

          {setupStep === 1 && (
            <div>
              <h2 className="t3d-ctitle">CHOOSE YOUR MORNING HABITS</h2>

              {/* Selected habits */}
              <div style={{ display: "none" }}>
                <div style={{
                  fontFamily: "'Orbitron',monospace",
                  fontSize: 9,
                  letterSpacing: 2,
                  color: "#E0EAF0",
                  marginBottom: 5
                }}>
                  YOUR MORNING HABITS
                </div>

                <div style={{
                  fontSize: 10,
                  color: "#4A6070",
                  marginBottom: 12
                }}>
                  Set a duration and an optional start time.
                </div>

                {selectedTasks.length === 0 && (
                  <div style={{
                    border: `1px dashed ${BORDER}`,
                    borderRadius: 6,
                    padding: 14,
                    color: "#4A6070",
                    fontSize: 10,
                    marginBottom: 12
                  }}>
                    Select habits below or make your own.
                  </div>
                )}

                {selectedTasks.map((task, i) => (
                  <div
                    key={task.id || i}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                      padding: "9px 0",
                      borderBottom: `1px solid ${BORDER}`
                    }}
                  >
                    <div style={{
                      flex: "1 1 180px",
                      fontSize: 11,
                      color: "#E0EAF0"
                    }}>
                      {taskIcon(task)}{task.name}
                    </div>

                    <input
                      type="time"
                      className="t3d-input"
                      value={task.preferredTime || ""}
                      onChange={e =>
                        updateSelectedTask(i, "preferredTime", e.target.value)
                      }
                      style={{
                        width: 115,
                        colorScheme: "dark"
                      }}
                    />

                    <div style={{
                      position: "relative",
                      width: 90
                    }}>
                      <input
                        type="number"
                        min="1"
                        className="t3d-input"
                        aria-label={`${task.name} minutes`}
                        value={task.duration ?? ""}
                        onChange={e =>
                          updateSelectedTask(i, "duration", e.target.value)
                        }
                        style={{
                          paddingRight: 30,
                          textAlign: "center"
                        }}
                      />

                      <span style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: 8,
                        color: "#4A6070",
                        pointerEvents: "none"
                      }}>
                        min
                      </span>
                    </div>

                    <button
                      type="button"
                      className="t3d-btn t3d-btn-sm t3d-btn-red"
                      aria-label={`Remove ${task.name}`}
                      onClick={() =>
                        setSelectedTasks(prev =>
                          prev.filter((_, index) => index !== i)
                        )
                      }
                      style={{ minWidth: 44, minHeight: 44, padding: "8px 10px" }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* Compulsory habits */}
                <div style={{
                  marginTop: 18,
                  fontSize: 9,
                  color: "#4A6070",
                  letterSpacing: 1,
                  marginBottom: 7
                }}>
                  INCLUDED WITH EVERY ROUTINE
                </div>

                {[...NON_NEGS, LOCKED_LAST].map((task, i) => (
                  <div
                    key={task.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 0",
                      borderBottom: `1px solid ${BORDER}`,
                      opacity: 0.7
                    }}
                  >
                    <div style={{ fontSize: 13 }}>🔒</div>

                    <div style={{
                      flex: 1,
                      fontSize: 11,
                      color: "#8AABB8"
                    }}>
                      {task.icon} {task.name}
                    </div>

                    <div style={{
                      fontSize: 9,
                      color: "#4A6070"
                    }}>
                      {task.id === "checkin"
                        ? "ALWAYS LAST"
                        : `${task.duration} min`}
                    </div>
                  </div>
                ))}
              </div>

              {/* Popular habits */}
              <div style={{ marginBottom: 26 }}>
                <div style={{
                  fontFamily: "'Orbitron',monospace",
                  fontSize: 9,
                  letterSpacing: 2,
                  color: "#E0EAF0",
                  marginBottom: 5
                }}>
                  POPULAR MORNING HABITS
                </div>

                <div style={{
                  fontSize: 10,
                  color: "#4A6070",
                  marginBottom: 10
                }}>
                  Select from the most popular morning habits.
                </div>

                <div>
                  {SUGGESTED_TASKS.map((t, i) => (
                    <button
                      type="button"
                      key={i}
                      aria-pressed={Boolean(selectedTasks.find(s => s.name === t.name))}
                      className={`t3d-task-chip ${
                        selectedTasks.find(s => s.name === t.name)
                          ? "selected"
                          : ""
                      }`}
                      onClick={() => toggleTask(t)}
                    >
                      {selectedTasks.find(s => s.name === t.name)
                        ? "✓ "
                        : "+ "}
                      {t.name} ({t.duration}m)
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom habit */}
              <div style={{ marginBottom: 24 }}>
                <div style={{
                  fontFamily: "'Orbitron',monospace",
                  fontSize: 9,
                  letterSpacing: 2,
                  color: "#E0EAF0",
                  marginBottom: 5
                }}>
                  MAKE YOUR OWN HABIT
                </div>

                <div style={{
                  fontSize: 10,
                  color: "#4A6070",
                  marginBottom: 10
                }}>
                  Create a habit that is specific to your morning.
                </div>

                <div style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap"
                }}>
                  <input
                    className="t3d-input"
                    placeholder="Habit name..."
                    value={customTask}
                    onChange={e => setCustomTask(e.target.value)}
                    onKeyDown={e =>
                      e.key === "Enter" && addCustomTask()
                    }
                    style={{ flex: "1 1 220px" }}
                  />



                  <div style={{
                    position: "relative",
                    width: 95
                  }}>
                    <input
                      type="number"
                      min="1"
                      max="180"
                      aria-label="Minutes"
                      className="t3d-input t3d-minutes"
                      placeholder="10"
                      value={customTaskDuration}
                      onChange={e =>
                        setCustomTaskDuration(e.target.value)
                      }
                      style={{
                        paddingRight: 30,
                        textAlign: "center"
                      }}
                    />

                    <span style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: 8,
                      color: "#4A6070",
                      pointerEvents: "none"
                    }}>
                      min
                    </span>
                  </div>

                  <button
                    className="t3d-btn t3d-btn-sm"
                    onClick={addCustomTask}
                    disabled={!customTask.trim()}
                  >
                    + ADD
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontFamily: "'Orbitron',monospace",
                  fontSize: 9,
                  letterSpacing: 2,
                  color: "#E0EAF0",
                  marginBottom: 8
                }}>
                  CURRENTLY SELECTED
                </div>

                {selectedTasks.length === 0 && (
                  <div style={{
                    fontSize: 9,
                    color: "#4A6070",
                    marginBottom: 8
                  }}>
                    No extra habits selected yet.
                  </div>
                )}

                {selectedTasks.map((task, i) => (
                  <div
                    key={task.id || i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 0",
                      borderBottom: `1px solid ${BORDER}`
                    }}
                  >
                    <div style={{
                      flex: 1,
                      fontSize: 10,
                      color: "#E0EAF0"
                    }}>
                      {taskIcon(task)}{task.name}
                    </div>

                    <div style={{
                      fontSize: 9,
                      color: "#8AABB8"
                    }}>
                      {task.duration} min
                    </div>

                    <button
                      className="t3d-btn t3d-btn-sm t3d-btn-red"
                      aria-label={`Remove ${task.name}`}
                      onClick={() =>
                        setSelectedTasks(prev =>
                          prev.filter((_, index) => index !== i)
                        )
                      }
                      style={{ minWidth: 44, minHeight: 44, padding: "4px 8px", fontSize: 14 }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {[...NON_NEGS, LOCKED_LAST].map(task => (
                  <div
                    key={task.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 0",
                      borderBottom: `1px solid ${BORDER}`,
                      opacity: 0.55
                    }}
                  >
                    <div style={{ fontSize: 10 }}>🔒</div>

                    <div style={{
                      flex: 1,
                      fontSize: 10,
                      color: "#8AABB8"
                    }}>
                      {task.icon} {task.name}
                    </div>

                    <div style={{
                      fontSize: 8,
                      color: "#4A6070"
                    }}>
                      {task.id === "checkin"
                        ? "LAST"
                        : `${task.duration} min`}
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.6, marginTop: 8 }}>
                  🔒 Sleep, weight, photos and the check-in are in every routine: they are what TRACK3D uses to track your progress and score your morning.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="t3d-btn t3d-btn-sm"
                  onClick={() => setSetupStep(0)}
                >
                  ← BACK
                </button>

                <button
                  className="t3d-btn"
                  style={{ flex: 1, padding: 12 }}
                  disabled={selectedTasks.some(
                    task =>
                      task.duration === "" ||
                      Number(task.duration) <= 0
                  )}
                  onClick={() => {
                    const chosen = [...NON_NEGS, ...selectedTasks];
                    let ordered = chosen;
                    if (setupReviewVisited) {
                      // Keep the order from Review; only drop removed tasks and append new ones.
                      const keyOf = task => task.id || task.name;
                      const chosenByKey = new Map(chosen.map(task => [keyOf(task), task]));
                      const kept = scheduledTasks
                        .filter(task => task.id !== "checkin" && chosenByKey.has(keyOf(task)))
                        .map(task => chosenByKey.get(keyOf(task)));
                      const keptKeys = new Set(kept.map(keyOf));
                      ordered = [...kept, ...chosen.filter(task => !keptKeys.has(keyOf(task)))];
                    }
                    setScheduledTasks(buildSchedule(ordered));
                    setSetupStep(2);
                  }}
                >
                  NEXT →
                </button>
              </div>
            </div>
          )}

          {(setupStep === 2 || setupReviewVisited) && (
            <div hidden={setupStep !== 2}>
            <ScheduleReview
              scheduledTasks={scheduledTasks}
              setScheduledTasks={setScheduledTasks}
              wakeTime={wakeTime}
              recalcTimes={recalcTimes}
              calcFinishTime={calcFinishTime}
              LOCKED_LAST={LOCKED_LAST}
              nonRemovableIds={NON_NEGS.map(task => task.id)}
              onRemoveTask={taskId => setSelectedTasks(current => current.filter(task => (task.id || task.name) !== taskId))}
              onBack={() => setSetupStep(1)}
              onSave={async () => {
                const saved = await saveRoutine(scheduledTasks);
                if (!saved.ok) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
                setupSnapshotRef.current = null;
                setIsSetup(true);
                setView("home");
                window.scrollTo({ top: 0, behavior: "smooth" });
                setRoutineSavedNotice(true);
                setTimeout(() => setRoutineSavedNotice(false), 4000);
              }}
            />
            </div>
          )}
        </div>
      </div>
    );
  }

  // LIVE MORNING view
  if (view === "liveMorning" && currentLiveTask) {
    const totalPlannedSeconds = liveRoutineSteps.reduce(
      (sum, task) => sum + ((Number(task.duration) || 0) * 60),
      0
    );

    const completedPlannedSeconds = liveRoutineSteps
      .slice(0, liveTaskIndex)
      .reduce(
        (sum, task) => sum + ((Number(task.duration) || 0) * 60),
        0
      );

    const currentTaskPlannedSeconds =
      (Number(currentLiveTask.duration) || 1) * 60;

    const plannedElapsedSeconds =
      completedPlannedSeconds +
      Math.max(0, currentTaskPlannedSeconds - liveSecondsLeft);

    const actualElapsedSeconds = liveStartedAt
      ? Math.floor((liveNow - liveStartedAt) / 1000)
      : 0;

    const differenceSeconds =
      actualElapsedSeconds - plannedElapsedSeconds;

    const differenceMinutes = Math.floor(
      Math.abs(differenceSeconds) / 60
    );

    const status =
      differenceMinutes < 2
        ? "ON TRACK ✓"
        : differenceSeconds > 0
          ? `${differenceMinutes} MIN BEHIND`
          : `${differenceMinutes} MIN AHEAD`;

    const remainingRoutineSeconds = Math.max(
      0,
      totalPlannedSeconds - plannedElapsedSeconds
    );

    const formatDuration = seconds => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;

      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    };

    const currentKey =
      currentLiveTask.id || currentLiveTask.name;

    const needsInput = ["sleep", "number", "photos3"].includes(
      currentLiveTask.type
    );

    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div style={{
            textAlign: "center",
            marginBottom: 26
          }}>
            <div style={{
              fontFamily: "'Orbitron',monospace",
              fontSize: 10,
              letterSpacing: 3,
              color: NEON,
              marginBottom: 8
            }}>
              MORNING IN PROGRESS
            </div>

            <div style={{
              fontFamily: "'Orbitron',monospace",
              fontSize: 32,
              fontWeight: 700,
              color: "#E0EAF0",
              marginBottom: 8
            }}>
              {formatDuration(liveSecondsLeft)}
            </div>

            <div style={{
              fontSize: 10,
              color: "#8AABB8",
              letterSpacing: 1
            }}>
              ESTIMATED FINISH {new Date(liveNow + (remainingRoutineSeconds + (Number(allSteps.find(step => step.id === "checkin")?.duration) || 0) * 60) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>

          <div style={{
            border: `1px solid ${NEON}`,
            background: "rgba(0,255,178,.05)",
            borderRadius: 8,
            padding: 20,
            marginBottom: 16
          }}>
            <div style={{
              fontFamily: "'Orbitron',monospace",
              fontSize: 9,
              letterSpacing: 2,
              color: "#4A6070",
              marginBottom: 10
            }}>
              CURRENT
            </div>

            <div style={{
              fontSize: 34,
              marginBottom: 10
            }}>
              {taskIcon(currentLiveTask)}
            </div>

            <div style={{
              fontFamily: "'Orbitron',monospace",
              fontSize: 15,
              color: "#E0EAF0",
              marginBottom: 6
            }}>
              {currentLiveTask.name}
            </div>

            <div style={{
              fontSize: 10,
              color: "#8AABB8"
            }}>
              Planned: {currentLiveTask.duration} min
            </div>
            {needsInput && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 16 }}>
                {renderStepInputs(currentLiveTask, moveToNextLiveTask)}
              </div>
            )}
          </div>

          {liveRoutineSteps[liveTaskIndex + 1] && (
            <div style={{
              padding: 14,
              border: `1px solid ${BORDER}`,
              borderRadius: 7,
              marginBottom: 16
            }}>
              <div style={{
                fontFamily: "'Orbitron',monospace",
                fontSize: 9,
                letterSpacing: 2,
                color: "#4A6070",
                marginBottom: 7
              }}>
                NEXT
              </div>

              <div style={{
                fontSize: 11,
                color: "#E0EAF0"
              }}>
                {taskIcon(liveRoutineSteps[liveTaskIndex + 1])}                {liveRoutineSteps[liveTaskIndex + 1].name}
                {" · "}
                {liveRoutineSteps[liveTaskIndex + 1].duration} min
              </div>
            </div>
          )}

          <div style={{
            textAlign: "center",
            padding: 12,
            borderRadius: 6,
            marginBottom: 18,
            background:
              status.includes("BEHIND")
                ? "rgba(255,45,120,.07)"
                : status.includes("AHEAD")
                  ? "rgba(0,200,255,.07)"
                  : "rgba(0,255,178,.07)",
            border:
              status.includes("BEHIND")
                ? "1px solid rgba(255,45,120,.25)"
                : status.includes("AHEAD")
                  ? "1px solid rgba(0,200,255,.25)"
                  : "1px solid rgba(0,255,178,.25)",
            color:
              status.includes("BEHIND")
                ? NEON3
                : status.includes("AHEAD")
                  ? NEON2
                  : NEON
          }}>
            <div style={{
              fontFamily: "'Orbitron',monospace",
              fontSize: 11,
              letterSpacing: 2
            }}>
              {status}
            </div>
          </div>

          <div style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap"
          }}>
            {needsInput ? null : (
              <button
                className="t3d-btn"
                style={{
                  flex: 1,
                  padding: 13,
                  background: "linear-gradient(90deg, #00FFB2, #00D99A)",
                  borderColor: NEON,
                  color: "#06100D",
                  fontWeight: 900
                }}
                onClick={completeLiveTask}
              >
                ✓ DONE
              </button>
            )}

            {/* Input steps already have their own skip on the task card. */}
            {!needsInput && (
              <button
                className="t3d-btn t3d-btn-red"
                style={{
                  padding: "13px 18px"
                }}
                onClick={skipLiveTask}
              >
                SKIP
              </button>
            )}
          </div>
          {sessionControls(liveTaskIndex > 0, () => {
            const previousIndex = liveTaskIndex - 1;
            setTempInput("");
            setPhotoAngleIdx(0);
            setLiveTaskIndex(previousIndex);
            startLiveTimer(liveRoutineSteps[previousIndex]);
          })}
        </div>
      </div>
    );
  }

  // CHECK-IN view
  if (view === "checkin" && currentStep && checkinStep < checkinDoneIndex) {
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div className="t3d-progress-dots">
            {allSteps.slice(0, checkinDoneIndex).map((_, i) => (
              <div key={i} className={`t3d-dot-step ${i === checkinStep ? "active" : i < checkinStep ? "done" : ""}`} />
            ))}
          </div>
          <div style={{ textAlign: "center", marginBottom: 8, fontSize: 10, color: "#E0EAF0", letterSpacing: 2 }}>
            STEP {checkinStep + 1} OF {checkinDoneIndex}
          </div>
          <div className="t3d-checkin-step">
            {taskIcon(currentStep) && <div aria-hidden="true" style={{ fontSize: 40, marginBottom: 16 }}>{taskIcon(currentStep)}</div>}
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, letterSpacing: 2, color: "#E0EAF0", marginBottom: 8 }}>
              {currentStep.name}
            </div>

            {renderStepInputs(currentStep, finishLiveInputStep)}

            {currentStep.type === "tick" && (
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <button className="t3d-tick-btn"
                  onClick={() => { setCheckinData(d => ({ ...d, [currentStep.id || currentStep.name]: true })); window.dispatchEvent(new CustomEvent("track3d-task-done", { detail: { name: currentStep.name } })); setCheckinStep(s => reviewingMissed ? allSteps.length : s + 1); setReviewingMissed(false); }}>
                  ✓
                </button>
                <button className="t3d-cross-btn"
                  onClick={() => { setCheckinData(d => ({ ...d, [currentStep.id || currentStep.name]: false })); setCheckinStep(s => reviewingMissed ? allSteps.length : s + 1); setReviewingMissed(false); }}>
                  ✗
                </button>
              </div>
            )}
          </div>
          {sessionControls(checkinStep > 0, () => { setTempInput(""); setPhotoAngleIdx(0); setReviewingMissed(false); setCheckinStep(step => Math.max(0, step - 1)); })}
          <button
            type="button"
            onClick={() => setView("home")}
            style={{ display: "block", margin: "18px auto 0", background: "none", border: 0, color: "#6F8792", cursor: "pointer", fontSize: 10, padding: 6, textDecoration: "underline" }}
          >
            ← RETURN TO MORNING SECTION
          </button>
        </div>
      </div>
    );
  }

  // COMPLETE view
  if (view === "checkin" && checkinStep >= checkinDoneIndex) {
    const score = morningScore(checkinData);
    const quote = MORNING_QUOTES[Math.floor(Math.random() * MORNING_QUOTES.length)];
    const editableSteps = allSteps.map((step, index) => ({ step, index })).filter(({ step }) => step.id !== "checkin");
    const plannedRoutineMinutes = routinePlannedMinutes;
    const actualRoutineMinutes = checkinData.routineTiming?.actualMinutes || (liveStartedAt ? Math.max(1, Math.round((Date.now() - liveStartedAt) / 60000)) : null);
    const routineTimingText = routineTimingSummary({ plannedMinutes: plannedRoutineMinutes, actualMinutes: actualRoutineMinutes });

    return (
      <div className="t3d-fade">
        <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌟</div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, letterSpacing: 3, color: NEON, marginBottom: 8 }}>MORNING COMPLETE</div>
          <div style={{ margin: "24px auto" }}>
            <ScoreRing score={score} max={10} size={120} />
          </div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: "#E0EAF0", letterSpacing: 2, marginBottom: 8 }}>
            MORNING SCORE
          </div>
          {scoreExplanation}
          <p style={{ fontSize: 12, color: NEON2, lineHeight: 1.7 }}>
            {wakeTimingSummary(checkinData.wakeTiming)}
          </p>
          <p style={{ fontSize: 11, color: "#C5D6DC", lineHeight: 1.7, marginTop: -4 }}>
            {routineTimingText}
          </p>
          <div style={{ fontSize: 13, color: "#8AABB8", fontStyle: "italic", marginBottom: 32, lineHeight: 1.7, padding: "0 20px" }}>
            "{quote}"
          </div>
          <details style={{ textAlign: "left", padding: 12, marginBottom: 16, border: `1px solid ${BORDER}`, borderRadius: 7, background: "rgba(0,200,255,.03)" }}>
            <summary style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: NEON2, letterSpacing: 1, cursor: "pointer" }}>EDIT THIS CHECK-IN</summary>
              <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.5, margin: "9px 0" }}>Change any answer or add/change photos before saving.</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {editableSteps.map(({ step, index }) => (
                  <button key={step.id || step.name} className="t3d-btn t3d-btn-sm" onClick={() => {
                    setReviewingMissed(true);
                    setTempInput("");
                    if (step.type === "photos3") setPhotoAngleIdx(0);
                    setCheckinStep(index);
                  }}>{step.type === "photos3" ? "EDIT PHOTOS" : `EDIT ${step.name}`}</button>
                ))}
              </div>
          </details>
          <div style={{ marginBottom: 24 }}>
            {Object.entries(checkinData).filter(([key]) => !HIDDEN_CHECKIN_KEYS.has(key) || key === "photos").map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 11 }}>
                <span style={{ color: "#4A6070" }}>{morningStepName(k)}</span>
                <span style={{ color: v === true ? NEON : v === false ? NEON3 : NEON2 }}>
                  {v === true ? "✓" : v === false ? "✗" :
                    (v && typeof v === "object") ? `${Object.values(v).filter(p => p === "captured").length}/3 captured` : v}
                </span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "left", marginBottom: 16 }}>
            <AICoach
              title="MORNING COACH"
              introduction="Ask about today's result, timing, or what to improve tomorrow."
              activationLabel="CHAT ABOUT THIS MORNING"
              openingMessage="Give me a short, useful review of this morning. Lead with how I did against my planned timing, then one practical improvement for tomorrow. Do not ask me a generic question."
              storageKey={`morning-review-${user.id}-${today}`}
              area="morning_review"
              context={morningCoachContext(checkinData, score, routineTimingText)}
            />
          </div>
          {submissionError && <div style={{ color: NEON3, fontSize: 11, marginBottom: 12, textAlign: "center" }}>{submissionError}</div>}
          {submissionError && !savingCheckin && (
            <button className="t3d-btn" style={{ width: "100%", padding: 14, marginBottom: 10 }} onClick={() => finaliseCheckin()}>
              TRY SAVING AGAIN
            </button>
          )}
          <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={() => setView("home")}>
            BACK TO MORNING
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── End of Day Check-in ──────────────────────────────────────────────────────
function EndOfDayCheckin({ user, onComplete }) {
  const [step, setStep] = useState(0);
  const [mood, setMood] = useState(null);
  const [energy, setEnergy] = useState(null);
  const [steps, setSteps] = useState("");
  const [futureYou, setFutureYou] = useState(null);
  const [aiRoundup, setAiRoundup] = useState("");
  const [aiRoundupError, setAiRoundupError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [goals, setGoals] = useState([]);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  // Decided once, when goals finish loading - so if the user adds a goal
  // while on the goals step, the step doesn't vanish out from under them.
  const [needsGoalsPrompt, setNeedsGoalsPrompt] = useState(false);
  const [newGoalText, setNewGoalText] = useState("");

  const today = homeDateKey(user);

  useEffect(() => {
    if (!user) return;
    supabase.from("daily_goals").select("*").eq("user_id", user.id).eq("date", today).order("created_at", { ascending: true })
      .then(({ data }) => {
        setGoals((data || []).map(g => ({ id: g.id, text: g.text, done: g.done })));
        setNeedsGoalsPrompt(!data || data.length === 0);
        setGoalsLoaded(true);
      })
      .catch(() => setGoalsLoaded(true));
  }, [user, today]);

  const saveGoal = (goal) => {
    supabase.from("daily_goals").upsert({
      id: goal.id, user_id: user.id, date: today, text: goal.text, done: Boolean(goal.done),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date,id" }).then(({ error }) => { if (error) console.log("Goal save error:", error); });
  };

  const addGoal = () => {
    const text = newGoalText.trim();
    if (!text || goals.length >= 3) return;
    const goal = { id: String(Date.now()), text, done: false };
    setGoals(current => [...current, goal]);
    setNewGoalText("");
    saveGoal(goal);
  };

  const toggleGoal = (id) => {
    setGoals(current => {
      const updated = current.map(g => g.id === id ? { ...g, done: !g.done } : g);
      const changed = updated.find(g => g.id === id);
      if (changed) saveGoal(changed);
      return updated;
    });
  };

  const EMOJI_SCALE = ["😞","😕","😐","🙂","😄"];
  const ENERGY_SCALE = ["🪫","😴","⚡","🔋","🚀"];

  const getAIRoundup = async () => {
    setAiLoading(true);
    setAiRoundupError("");
    try {
      // Gather all today's data (same order as the queries below)
      const [morning, nutrition, fitness, debrief, calendar, eodHistory] = await Promise.all([
        supabase.from("morning_checkins").select("score,data").eq("user_id", user.id).eq("date", today).maybeSingle(),
        supabase.from("nutrition_logs").select("total_calories,total_protein,meals_completed,off_plan_food").eq("user_id", user.id).eq("date", today).maybeSingle(),
        // Every workout finished today (there can be more than one).
        supabase.from("workout_logs").select("session_name,total_volume,duration_mins,exercises,created_at").eq("user_id", user.id).eq("date", today).eq("in_progress", false),
        supabase.from("daily_debrief").select("overall_score,task_scores").eq("user_id", user.id).eq("date", today).maybeSingle(),
        supabase.from("calendar_tasks").select("title,status").eq("user_id", user.id).eq("date", today),
        supabase.from("end_of_day").select("mood,energy,steps,future_you,date").eq("user_id", user.id).order("date", { ascending: false }).limit(7),
      ]);

      // Build context
      const morningScore = morning.data?.score ?? "not completed";
      const nutritionData = nutrition.data ? `${nutrition.data.total_calories} kcal, ${nutrition.data.total_protein}g protein, ${countCompletedMeals(nutrition.data.meals_completed)} meals on plan${nutrition.data.off_plan_food ? `, off plan: ${nutrition.data.off_plan_food}` : ""}` : "not logged";
      const workoutsToday = (fitness.data || []).map(log => ({ ...log, duration_mins: settledWorkoutDuration(log) })).filter(log => Number(log.total_volume) > 0 || (Number(log.duration_mins) || 0) >= 2);
      const fitnessData = workoutsToday.length ? workoutsToday.map(log => `${log.session_name}, ${log.duration_mins} mins, ${Math.round(log.total_volume || 0)}kg volume`).join("; ") : "no workout logged";
      const calendarTasks = debrief.data ? `calendar score ${debrief.data.overall_score}/10` : calendar.data?.length ? `${calendar.data.filter(t=>t.status==="done").length}/${calendar.data.length} tasks done` : "no tasks";

      // Pattern detection from last 7 days
      const history = eodHistory.data || [];
      const avgMood = history.length ? (history.reduce((a,d)=>a+(d.mood||0),0)/history.length).toFixed(1) : null;
      const avgEnergy = history.length ? (history.reduce((a,d)=>a+(d.energy||0),0)/history.length).toFixed(1) : null;
      const patterns = history.length >= 3 ? `Last ${history.length} days - avg mood: ${avgMood}/5, avg energy: ${avgEnergy}/5` : "not enough history for patterns yet";
      const goalsData = goals.length
        ? `${goals.filter(g => g.done).length} of ${goals.length} completed - ${goals.map(g => `"${g.text}" (${g.done ? "done" : "not done"})`).join(", ")}`
        : "no goals set for today";

      const text = await streamCoachText({
          area: "end_of_day",
          messages: [{ role: "user", content: `Today's data:
- Morning score: ${morningScore}/10
- ${wakeTimingSummary(morning.data?.data?.wakeTiming)}
- Wake-up time source: ${morning.data?.data?.wakeTiming?.source || "not recorded"}
- Nutrition: ${nutritionData}
- Fitness: ${fitnessData}
- Calendar: ${calendarTasks}
- Top goals for today: ${goalsData}
- Mood today: ${mood}/5
- Energy today: ${energy}/5
- Steps: ${steps || "not logged"}
- Future you happy with today: ${futureYou}
- Pattern history: ${patterns}

Give me my daily roundup and spot any patterns.` }],
      }, setAiRoundup);
      setAiRoundup(text);
    } catch (e) {
      console.log("Roundup error:", e?.message);
      setAiRoundup("");
      setAiRoundupError("Couldn't write your roundup.");
    }
    setAiLoading(false);
  };

  const saveAndFinish = async () => {
    setSaving(true);
    await supabase.from("end_of_day").upsert({
      user_id: user.id, date: today,
      mood, energy, steps: parseInt(steps)||0,
      future_you: futureYou, ai_roundup: aiRoundup,
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id,date" });
    setSaving(false);
    onComplete();
  };

  const RatingRow = ({ value, setValue, emojis, label }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 12, textAlign: "center" }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        {emojis.map((emoji, i) => (
          <button key={i} onClick={() => setValue(i+1)}
            style={{ width: 52, height: 52, borderRadius: 10, border: `2px solid ${value===i+1?NEON:BORDER}`, background: value===i+1?"rgba(0,255,178,.12)":SURFACE2, fontSize: 24, cursor: "pointer", transition: "all .18s", transform: value===i+1?"scale(1.15)":"scale(1)" }}>
            {emoji}
          </button>
        ))}
      </div>
      {value && <div style={{ textAlign: "center", fontSize: 10, color: NEON, marginTop: 8, letterSpacing: 1 }}>{value}/5</div>}
    </div>
  );

  const steps_arr = [
    // If Top Goals were never entered today, prompt for them here instead of
    // letting the day close with no record of what mattered most.
    ...(needsGoalsPrompt ? [{
      q: "WHAT WERE YOUR TOP GOALS TODAY?",
      content: (
        <div>
          <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginBottom: 16, textAlign: "center" }}>
            What were the 3 most important things you wanted to get done today? Tick off any you finished.
          </div>
          {goals.map(g => (
            <div key={g.id} className="t3d-hrow" onClick={() => toggleGoal(g.id)} style={{ cursor: "pointer" }}>
              <div className={`t3d-hcheck ${g.done ? "done" : ""}`}>{g.done ? "✓" : ""}</div>
              <div className="t3d-hname" style={{ color: g.done ? "#E0EAF0" : "#4A6070", textDecoration: g.done ? "line-through" : "none" }}>{g.text}</div>
            </div>
          ))}
          {goals.length < 3 && (
            <div style={{ display: "flex", gap: 8, marginTop: goals.length ? 12 : 0 }}>
              <input className="t3d-input" placeholder="e.g. Finish the client proposal" value={newGoalText}
                onChange={e => setNewGoalText(e.target.value)} onKeyDown={e => e.key === "Enter" && addGoal()} style={{ flex: 1 }} />
              <button className="t3d-btn t3d-btn-sm" disabled={!newGoalText.trim()} onClick={addGoal}>+ ADD</button>
            </div>
          )}
          <div style={{ fontSize: 9, color: "#4A6070", marginTop: 12, textAlign: "center" }}>You can also leave this blank and skip.</div>
        </div>
      ),
      valid: true, next: () => setStep(s => s + 1),
    }] : []),
    { q: "HOW WAS YOUR MOOD TODAY?", content: <RatingRow value={mood} setValue={setMood} emojis={EMOJI_SCALE} label="1 = very low, 5 = excellent" />, valid: mood !== null, next: () => setStep(s => s + 1) },
    { q: "HOW WERE YOUR ENERGY LEVELS?", content: <RatingRow value={energy} setValue={setEnergy} emojis={ENERGY_SCALE} label="1 = exhausted, 5 = full of energy" />, valid: energy !== null, next: () => setStep(s => s + 1) },
    { q: "HOW MANY STEPS DID YOU DO?", content: (
      <div style={{ textAlign: "center" }}>
        <input className="t3d-input" type="number" placeholder="e.g. 8500"
          value={steps} onChange={e => setSteps(e.target.value)}
          style={{ textAlign: "center", fontSize: 28, padding: 16, maxWidth: 200, margin: "0 auto", display: "block" }} />
        <div style={{ fontSize: 10, color: "#E0EAF0", marginTop: 10 }}>Goal: 10,000 steps</div>
        {steps && (
          <div style={{ marginTop: 8, fontSize: 11, color: parseInt(steps)>=10000?NEON:"#FF8C00" }}>
            {parseInt(steps)>=10000?"🎯 Goal hit!":"🎯 " + (10000-parseInt(steps)).toLocaleString() + " short of goal"}
          </div>
        )}
      </div>
    ), valid: true, next: () => setStep(s => s + 1) },
    { q: "WOULD FUTURE YOU BE HAPPY WITH TODAY?", content: (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { val: "yes", label: "Yes — I gave it my all", icon: "🔥", color: NEON },
          { val: "mostly", label: "Mostly — a few things I'd change", icon: "👍", color: "#FF8C00" },
          { val: "no", label: "No — tomorrow I do better", icon: "💪", color: NEON2 },
        ].map(opt => (
          <button key={opt.val} onClick={() => setFutureYou(opt.val)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 8, border: `2px solid ${futureYou===opt.val?opt.color:BORDER}`, background: futureYou===opt.val?`${opt.color}15`:SURFACE2, cursor: "pointer", transition: "all .18s" }}>
            <span style={{ fontSize: 20 }}>{opt.icon}</span>
            <span style={{ fontSize: 12, color: futureYou===opt.val?opt.color:"#8AABB8" }}>{opt.label}</span>
          </button>
        ))}
      </div>
    ), valid: futureYou !== null, next: async () => { setStep(s => s + 1); await getAIRoundup(); } },
  ];

  // Wait for the goals check before rendering steps, so the step list
  // (and therefore its length/indices) doesn't shift under the user mid-flow.
  if (!goalsLoaded) return (
    <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 11, color: "#E0EAF0", letterSpacing: 2 }}>LOADING...</div>
    </div></div>
  );

  const currentStep = steps_arr[step];

  // Complete screen
  if (step === steps_arr.length) {
    return (
      <div className="t3d-fade">
        <div className="t3d-card" style={{ padding: 28 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🌙</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, color: NEON, letterSpacing: 3, marginBottom: 4 }}>DAY COMPLETE</div>
            <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</div>
          </div>

          {/* Summary stats */}
          <div className="t3d-grid3" style={{ marginBottom: 20 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28 }}>{EMOJI_SCALE[mood-1]}</div>
              <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1, marginTop: 4 }}>MOOD {mood}/5</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28 }}>{ENERGY_SCALE[energy-1]}</div>
              <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1, marginTop: 4 }}>ENERGY {energy}/5</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: parseInt(steps)>=10000?NEON:"#FF8C00" }}>{parseInt(steps||0).toLocaleString()}</div>
              <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1, marginTop: 4 }}>STEPS</div>
            </div>
          </div>

          {/* Future you */}
          <div style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 16, textAlign: "center", fontSize: 12, color: "#8AABB8" }}>
            {futureYou === "yes" ? "🔥 Future you is proud of today!" : futureYou === "mostly" ? "👍 Good day — room to grow tomorrow." : "💪 Tomorrow you come back stronger."}
          </div>

          {/* AI Roundup */}
          {aiLoading ? (
            <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 16, marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#E0EAF0" }}>🤖 Analysing your full day...</div>
            </div>
          ) : aiRoundup ? (
            <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 16, marginBottom: 16 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: NEON, letterSpacing: 2, marginBottom: 8 }}>AI DAILY ROUNDUP</div>
              <div style={{ fontSize: 12, color: "#8AABB8", lineHeight: 1.7 }}>{aiRoundup}</div>
            </div>
          ) : aiRoundupError ? (
            <div role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid rgba(255,181,71,.4)", background: "rgba(255,181,71,.06)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: "#FFB547" }}>{aiRoundupError}</span>
              <button className="t3d-btn t3d-btn-sm" onClick={getAIRoundup}>TRY AGAIN</button>
            </div>
          ) : null}

          <button className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={saving || aiLoading}
            onClick={saveAndFinish}>
            {saving ? "SAVING..." : "FINISH DAY ✓"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="t3d-fade">
      <div className="t3d-card">
        {/* Progress dots */}
        <div className="t3d-progress-dots" style={{ marginBottom: 20 }}>
          {steps_arr.map((_, i) => <div key={i} className={`t3d-dot-step ${i===step?"active":i<step?"done":""}`} />)}
        </div>

        <div style={{ textAlign: "center", marginBottom: 8, fontSize: 10, color: "#E0EAF0", letterSpacing: 2 }}>
          STEP {step+1} OF {steps_arr.length}
        </div>

        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#E0EAF0", letterSpacing: 2, textAlign: "center", marginBottom: 28 }}>
          {currentStep.q}
        </div>

        <div style={{ marginBottom: 28 }}>
          {currentStep.content}
        </div>

        <button className="t3d-btn" style={{ width: "100%", padding: 14 }}
          disabled={!currentStep.valid}
          onClick={currentStep.next}>
          {step === steps_arr.length - 1 ? "SEE MY ROUNDUP →" : "NEXT →"}
        </button>
      </div>
    </div>
  );
}



// ─── Daily activity helper (shared by heatmap, history view & weekly report) ──
const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

async function fetchDailyActivity(user, days) {
  const userId = user.id;
  const today = homeDateKey(user);
  const dates = Array.from({ length: days }, (_, i) => shiftDateKey(today, -(days - 1 - i)));
  const earliest = dates[0];
  const [morning, nutrition, workout, eod] = await Promise.all([
    supabase.from("morning_checkins").select("date,score").eq("user_id", userId).gte("date", earliest),
    supabase.from("nutrition_logs").select("date").eq("user_id", userId).gte("date", earliest),
    supabase.from("workout_logs").select("date").eq("user_id", userId).gte("date", earliest).eq("in_progress", false),
    supabase.from("end_of_day").select("date").eq("user_id", userId).gte("date", earliest),
  ]);
  const morningMap = Object.fromEntries((morning.data || []).map(r => [r.date, r.score]));
  const nutritionSet = new Set((nutrition.data || []).map(r => r.date));
  const workoutSet = new Set((workout.data || []).map(r => r.date));
  const eodSet = new Set((eod.data || []).map(r => r.date));
  return dates.map(date => {
    const flags = [date in morningMap, nutritionSet.has(date), workoutSet.has(date), eodSet.has(date)];
    return {
      date,
      morningScore: date in morningMap ? morningMap[date] : null,
      nutrition: nutritionSet.has(date),
      workout: workoutSet.has(date),
      eod: eodSet.has(date),
      activity: flags.filter(Boolean).length,
    };
  });
}

// ─── Progress Photos gallery ───────────────────────────────────────────────────
function ProgressPhotos({ user }) {
  const [angle, setAngle] = useState("front");
  const [entries, setEntries] = useState([]);
  const [idx, setIdx] = useState(0);
  const [urlCache, setUrlCache] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!user) return; load(); }, [user]);
  useEffect(() => { setIdx(0); }, [angle]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("morning_checkins").select("date,data").eq("user_id", user.id).order("date", { ascending: false }).limit(90);
    setEntries((data || []).filter(e => e.data?.photos));
    setLoading(false);
  };

  // Placeholder values such as "captured", "deferred" or "skipped" are not stored files.
  const isPhotoPath = value => typeof value === "string" && value.includes("/");
  const filtered = entries.filter(e => isPhotoPath(e.data.photos[angle]));
  const current = filtered[Math.min(idx, Math.max(filtered.length - 1, 0))];

  useEffect(() => {
    if (!current) return;
    const path = current.data.photos[angle];
    if (urlCache[path]) return;
    supabase.storage.from("checkin-photos").createSignedUrl(path, 3600).then(({ data }) => {
      setUrlCache(c => ({ ...c, [path]: data?.signedUrl || "unavailable" }));
    }).catch(() => setUrlCache(c => ({ ...c, [path]: "unavailable" })));
  }, [current, angle]);

  if (loading) return (
    <div className="t3d-card" style={{ marginBottom: 16, textAlign: "center", padding: 24 }}>
      <div style={{ fontSize: 11, color: "#E0EAF0" }}>LOADING PHOTOS...</div>
    </div>
  );

  return (
    <div className="t3d-card" style={{ marginBottom: 16 }}>
      <div className="t3d-ctitle">PROGRESS PHOTOS</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["front", "side", "back"].map(a => (
          <button key={a} className="t3d-btn t3d-btn-sm" style={{
            flex: 1,
            background: angle === a ? "rgba(0,255,178,.12)" : "transparent",
            borderColor: angle === a ? NEON : BORDER,
            color: angle === a ? NEON : "#E0EAF0",
          }} onClick={() => { setAngle(a); setIdx(0); }}>{a.toUpperCase()}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", fontSize: 11, color: "#E0EAF0" }}>
          {`No ${angle} photos yet. They'll show up here after you add photos in a morning check-in.`}
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 10 }}>
            {dateKeyLabel(current.date, { day: "numeric", month: "short", year: "numeric" })}
          </div>
          <div style={{ width: "100%", maxWidth: 280, height: 340, margin: "0 auto 14px", borderRadius: 8, overflow: "hidden", border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", background: SURFACE2 }}>
            {urlCache[current.data.photos[angle]] === "unavailable" ? (
              <div style={{ fontSize: 10, color: "#8AABB8", padding: 16, lineHeight: 1.6 }}>This photo could not be loaded.</div>
            ) : urlCache[current.data.photos[angle]] ? (
              <img src={urlCache[current.data.photos[angle]]} alt={angle} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ fontSize: 10, color: "#E0EAF0" }}>LOADING...</div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, alignItems: "center" }}>
            <button className="t3d-btn t3d-btn-sm" disabled={idx >= filtered.length - 1} onClick={() => setIdx(i => i + 1)}>◀ OLDER</button>
            <div style={{ fontSize: 10, color: "#E0EAF0" }}>{idx + 1} / {filtered.length}</div>
            <button className="t3d-btn t3d-btn-sm" disabled={idx <= 0} onClick={() => setIdx(i => i - 1)}>NEWER ▶</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard History sub-view ────────────────────────────────────────────────
function DashboardHistory({ user, onBack }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchDailyActivity(user, 90).then(a => { setActivity(a); setLoading(false); });
  }, [user]);

  if (loading) return (
    <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 11, color: "#E0EAF0" }}>LOADING HISTORY...</div>
    </div></div>
  );

  return (
    <div className="t3d-fade">
      <button className="t3d-btn t3d-btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>← BACK</button>
      <div className="t3d-card" style={{ marginBottom: 16 }}>
        <div className="t3d-ctitle">90-DAY ACTIVITY</div>
        <div className="t3d-hmap">
          {activity.map((d, i) => (
            <div key={i} className="t3d-hcell" title={d.date} style={{ background: heatColor(d.activity) }} />
          ))}
        </div>
      </div>
      <div className="t3d-card">
        <div className="t3d-ctitle">DAY BY DAY</div>
        {activity.slice().reverse().map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 11 }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#E0EAF0", width: 80 }}>
              {new Date(d.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </div>
            <div style={{ flex: 1, display: "flex", gap: 6 }}>
              <span style={{ color: d.morningScore != null ? NEON : "#2A3A48" }}>☀ {d.morningScore != null ? `${d.morningScore}/10` : "—"}</span>
              <span style={{ color: d.nutrition ? NEON2 : "#2A3A48" }}>◎ {d.nutrition ? "✓" : "—"}</span>
              <span style={{ color: d.workout ? "#FF8C00" : "#2A3A48" }}>⚡ {d.workout ? "✓" : "—"}</span>
              <span style={{ color: d.eod ? NEON3 : "#2A3A48" }}>🌙 {d.eod ? "✓" : "—"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Weekly Report ──────────────────────────────────────────────────────────────
// Every number comes from data the app already stores; the AI only writes
// the Biggest Win / Focus / Verdict lines, from those same numbers.
async function loadWeeklyReportData(user, week) {
  const todayKey = getZonedDateInfo(new Date(), resolveHomeTimeZone(user)).dateKey;
  const historyFrom = shiftDateKey(todayKey, -366);
  const previousStart = shiftDateKey(week.start, -7);
  const [workouts, split, habits, completions, checkins, routine, nutritionLogs, nutritionPlan, stored] = await Promise.all([
    supabase.from("workout_logs").select("id,date,session_name,total_volume,duration_mins,exercises,in_progress,created_at").eq("user_id", user.id).gte("date", previousStart).lte("date", week.end).or(`in_progress.eq.false,date.lt.${todayKey}`),
    readWorkoutSplit(user.id),
    readHabits(user.id),
    readHabitCompletions(user.id, historyFrom, todayKey),
    supabase.from("morning_checkins").select("date,score,data").eq("user_id", user.id).gte("date", historyFrom).order("date", { ascending: false }),
    readMorningRoutine(user.id),
    supabase.from("nutrition_logs").select("date,total_calories,total_protein").eq("user_id", user.id).gte("date", week.start).lte("date", week.end),
    readNutritionPlan(user.id),
    supabase.from("weekly_reports").select("*").eq("user_id", user.id).eq("week_start", week.start).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const failed = [workouts, habits, completions, checkins, nutritionLogs].find(result => result.error);
  if (failed) throw failed.error;
  const metrics = buildWeeklyMetrics({
    week, todayKey,
    workoutLogs: (workouts.data || []).map(log => ({ ...log, duration_mins: settledWorkoutDuration(log), in_progress: !isFinishedWorkout(log, todayKey) })),
    sessions: split.data?.sessions || [],
    // Sessions only count as planned from the day this plan started.
    planStartKey: split.data?.programme_started_at ? getZonedDateInfo(new Date(split.data.programme_started_at), resolveHomeTimeZone(user)).dateKey : null,
    habits: habits.data || [],
    habitCompletions: completions.data || [],
    checkins: checkins.data || [],
    hasMorningRoutine: Boolean(routine.data),
    nutritionLogs: nutritionLogs.data || [],
    nutritionPlan: nutritionPlan.data || null,
  });
  // A saved report for the week means it has been opened before (on any device).
  return { metrics, summary: parseCoachSummary(stored.data?.patterns), hasStoredReport: Boolean(stored.data) };
}

const formatWeekRange = week => {
  const label = key => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).toUpperCase();
  return `${label(week.start)} – ${label(week.end)}`;
};

function ReportTile({ label, value, sub, progress, color = NEON, testId }) {
  return (
    <div data-testid={testId} style={{ padding: "14px 12px", background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 8, minWidth: 0, height: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 8, color: "#8AABB8", letterSpacing: 1.5, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color, overflowWrap: "anywhere" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#8AABB8", marginTop: 5, lineHeight: 1.4 }}>{sub}</div>}
      {progress !== undefined && progress !== null && (
        <div className="t3d-pbar"><div className="t3d-pfill" style={{ width: `${Math.max(0, Math.min(progress, 1)) * 100}%`, background: color }} /></div>
      )}
    </div>
  );
}

const signed = value => `${value > 0 ? "+" : ""}${value}`;

// Dashboard card: a short teaser that opens the full recap. A new report
// (finished week, not opened yet) is shown at the top with a yellow "!".
function WeeklyReport({ week, metrics, loadError, isNew = false, onOpen }) {
  const workouts = metrics?.workouts;
  const habits = metrics?.habits;
  const morning = metrics?.morning;
  const headline = [
    workouts && { label: "WORKOUTS", value: workouts.planned ? `${workouts.completed}/${workouts.planned}` : workouts.completed },
    workouts?.completed > 0 && { label: "NEW PBS", value: workouts.personalBests.length, color: "#FFB547" },
    habits?.completionPct !== null && habits && { label: "HABITS", value: `${habits.completionPct}%`, color: NEON2 },
    morning && { label: "MORNINGS", value: `${morning.completed}/${morning.days}`, color: "#FF8C00" },
  ].filter(Boolean).slice(0, 3);

  return (
    <div className="t3d-card" data-testid="weekly-report-card" data-new={isNew ? "true" : undefined} style={{ marginBottom: 16, ...(isNew ? { borderColor: "#FFB547", boxShadow: "0 0 18px rgba(255,181,71,.12)" } : {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {isNew && <span data-testid="weekly-new-badge" aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", background: "#FFB547", color: "#1A1000", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13, flexShrink: 0 }}>!</span>}
          <div className="t3d-ctitle" style={{ margin: 0, color: isNew ? "#FFB547" : undefined }}>{isNew ? "NEW WEEKLY REPORT" : "YOUR WEEK"}</div>
          {isNew && <span className="t3d-sr-only">New report ready.</span>}
        </div>
        <div style={{ fontSize: 9, color: "#6F8792", letterSpacing: 1 }}>{formatWeekRange(week)}{week.inProgress ? " · SO FAR" : ""}</div>
      </div>
      {loadError ? (
        <div style={{ fontSize: 11, color: "#8AABB8" }}>Your weekly report could not be loaded right now.</div>
      ) : !metrics ? (
        <div style={{ fontSize: 11, color: "#8AABB8" }}>Loading your week...</div>
      ) : !metrics.hasData ? (
        <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>Nothing tracked for this week yet. Log a workout, a morning or your habits and your weekly recap will build from there.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${headline.length}, minmax(0,1fr))`, gap: 10 }}>
          {headline.map(item => (
            <div key={item.label} style={{ textAlign: "center", padding: "10px 6px", background: SURFACE2, borderRadius: 6 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: item.color || NEON }}>{item.value}</div>
              <div style={{ fontSize: 8, color: "#8AABB8", letterSpacing: 1, marginTop: 4 }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}
      {metrics?.hasData && workouts?.perfectWeek && (
        <div data-testid="perfect-week-badge" style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,210,63,.5)", background: "rgba(255,210,63,.08)", color: "#FFD23F", fontSize: 11, textAlign: "center" }}>
          🏆 Perfect training week: every session smashed, not a set missed.
        </div>
      )}
      <button className="t3d-btn" style={{ width: "100%", marginTop: 14, ...(isNew ? { borderColor: "#FFB547", color: "#FFB547" } : {}) }} onClick={onOpen}>OPEN WEEKLY REPORT →</button>
    </div>
  );
}

// Full-screen weekly recap.
function WeeklyRecap({ user, onBack }) {
  const todayKey = getZonedDateInfo(new Date(), resolveHomeTimeZone(user)).dateKey;
  const [offset, setOffset] = useState(0);
  const week = useMemo(() => reportWeek(todayKey, offset), [todayKey, offset]);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const autoRequested = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    setData(null); setLoadError(""); setSummaryError("");
    loadWeeklyReportData(user, week)
      .then(result => { if (!cancelled) setData(result); })
      .catch(error => { console.log("Weekly report load error:", error?.message); if (!cancelled) setLoadError("Check your connection and try again."); });
    return () => { cancelled = true; };
  }, [user, week]);

  const generateSummary = async () => {
    if (!data?.metrics?.hasData || generating) return;
    setGenerating(true);
    setSummaryError("");
    try {
      const facts = weeklyFactsForCoach(data.metrics);
      const res = await fetch("/api/chat", {
        method: "POST", headers: await chatHeaders(),
        body: JSON.stringify({
          area: "weekly_summary",
          messages: [{ role: "user", content: `Week ${week.start} to ${week.end}${week.inProgress ? " (still in progress)" : ""}:\n- ${facts.join("\n- ")}` }],
        }),
      });
      if (!res.ok) throw new Error(`coach unavailable (${res.status})`);
      const json = await res.json();
      const parsed = extractJsonObject(json.content?.map(block => block.text || "").join("") || "");
      if (!parsed?.biggest_win && !parsed?.verdict) throw new Error("the coach reply could not be read");
      // Saved with the facts it was written from, so changed figures get a new one.
      const factsKey = weeklyFactsKey(data.metrics);
      const summary = { biggestWin: cleanAiText(parsed.biggest_win), focus: cleanAiText(parsed.focus), verdict: cleanAiText(parsed.verdict), factsKey };
      setData(current => ({ ...current, summary }));
      const { error } = await supabase.from("weekly_reports").upsert({
        user_id: user.id, report_date: week.end, week_start: week.start, week_end: week.end,
        patterns: formatCoachSummary(summary, factsKey), diet_suggestions: null,
      }, { onConflict: "user_id,report_date" });
      if (error) {
        console.log("Weekly report save error:", error.message);
        setSummaryError("Your coach summary is below, but it couldn't be saved, so it will be written again next time you open this week.");
      }
    } catch (error) {
      console.log("Weekly summary error:", error?.message);
      setSummaryError("The coach summary couldn't be written just now. Your numbers above are unaffected — try again in a moment.");
    } finally {
      setGenerating(false);
    }
  };

  // A summary written from other numbers than the report now shows (or
  // before summaries kept their facts) is out of date.
  const summaryStale = Boolean(data?.summary && data?.metrics?.hasData && data.summary.factsKey !== weeklyFactsKey(data.metrics));
  // A finished week with data gets its coach summary automatically, and a new
  // one when the old one is out of date (once per visit).
  useEffect(() => {
    if (!data?.metrics?.hasData || (data.summary && !summaryStale) || week.inProgress || autoRequested.current.has(week.start)) return;
    autoRequested.current.add(week.start);
    generateSummary();
  }, [data, week, summaryStale]);

  const metrics = data?.metrics;
  const { workouts, habits, morning, bodyWeight, nutrition } = metrics || {};
  const reveal = index => ({ animationDelay: `${0.06 * index}s` });

  return (
    <div className="t3d-fade" data-testid="weekly-recap">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <button className="t3d-btn t3d-btn-sm" onClick={onBack}>← BACK</button>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button className="t3d-btn t3d-btn-sm" aria-label="Previous week" onClick={() => setOffset(value => Math.min(value + 1, 52))}>‹</button>
          <span style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, minWidth: 108, textAlign: "center" }}>{formatWeekRange(week)}</span>
          <button className="t3d-btn t3d-btn-sm" aria-label="Next week" disabled={offset === 0} onClick={() => setOffset(value => Math.max(value - 1, 0))}>›</button>
        </div>
      </div>

      <div className="t3d-card t3d-reveal" style={{ textAlign: "center", padding: "28px 18px", background: "linear-gradient(160deg, rgba(0,255,178,.08), rgba(0,200,255,.04) 60%, transparent)", borderColor: "rgba(0,255,178,.3)" }}>
        <div style={{ fontSize: 9, color: "#8AABB8", letterSpacing: 3, marginBottom: 8 }}>{week.inProgress ? "THIS WEEK SO FAR" : offset === 0 ? "LAST WEEK" : "WEEKLY REPORT"}</div>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 22, color: NEON, letterSpacing: 4 }}>YOUR WEEK</div>
        {workouts?.completed > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 40, color: "#E0EAF0", lineHeight: 1 }}>{workouts.volume.toLocaleString()}<span style={{ fontSize: 14, color: "#8AABB8" }}> KG</span></div>
            <div style={{ fontSize: 10, color: "#8AABB8", letterSpacing: 1, marginTop: 6 }}>
              LIFTED ACROSS {workouts.completed} WORKOUT{workouts.completed === 1 ? "" : "S"}
              {workouts.activities > 0 && ` · PLUS ${workouts.activities} ${workouts.activities === 1 ? "ACTIVITY" : "ACTIVITIES"}`}
              {workouts.volumeChangePct !== null && <span style={{ color: workouts.volumeChangePct >= 0 ? NEON : "#FFB547" }}> · {signed(workouts.volumeChangePct)}% VS PREVIOUS WEEK</span>}
            </div>
          </div>
        )}
      </div>

      {loadError && <div className="t3d-card" role="alert" style={{ color: "#FF8AAD", fontSize: 11 }}>Your report couldn&apos;t be loaded. {loadError}</div>}
      {!metrics && !loadError && <div className="t3d-card" style={{ textAlign: "center", fontSize: 11, color: "#8AABB8" }}>Loading your week...</div>}
      {metrics && !metrics.hasData && (
        <div className="t3d-card" style={{ textAlign: "center", padding: 24, fontSize: 12, color: "#C5D6DC", lineHeight: 1.7 }}>
          Nothing was tracked this week, so there is no recap to show.<br /><span style={{ color: "#8AABB8", fontSize: 11 }}>Workouts, mornings, habits and nutrition logs all feed into this report.</span>
        </div>
      )}

      {metrics?.hasData && (
        <>
          {/* The reward for a week with every session done and no set missed. */}
          {workouts?.perfectWeek && (
            <div className="t3d-card t3d-reveal" data-testid="perfect-week" role="status" style={{ ...reveal(1), marginBottom: 14, textAlign: "center", padding: "20px 16px", borderColor: "#FFD23F", background: "linear-gradient(160deg, rgba(255,210,63,.14), rgba(255,140,0,.05) 70%)" }}>
              <div aria-hidden="true" style={{ fontSize: 34, lineHeight: 1, marginBottom: 8 }}>🏆</div>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 15, color: "#FFD23F", letterSpacing: 3 }}>PERFECT TRAINING WEEK</div>
              <div style={{ fontSize: 12, color: "#E0EAF0", marginTop: 8, lineHeight: 1.6 }}>Well done: every session smashed, not a set missed. {workouts.completed} of {workouts.planned} workouts, every planned set logged.</div>
            </div>
          )}
          {!workouts?.perfectWeek && workouts?.allSessionsDone && workouts.setsMissed > 0 && (
            <div className="t3d-card t3d-reveal" data-testid="sessions-done" style={{ ...reveal(1), marginBottom: 14, textAlign: "center", fontSize: 11, color: "#C5D6DC", lineHeight: 1.6 }}>
              <span style={{ color: NEON }}>✓ Every planned session done.</span> {workouts.setsMissed} planned set{workouts.setsMissed === 1 ? "" : "s"} skipped: log every set next week for a perfect week 🏆
            </div>
          )}
          <div className="t3d-grid2" style={{ marginBottom: 14 }}>
            {workouts && (
              <div className="t3d-reveal" style={reveal(1)}>
                <ReportTile testId="tile-workouts" label="WORKOUTS COMPLETED" value={workouts.planned ? `${workouts.completed} / ${workouts.planned}` : workouts.completed}
                  sub={`${workouts.planned ? (workouts.completed >= workouts.planned ? "Every planned session done" : workouts.missed ? `${workouts.missed} planned session${workouts.missed === 1 ? "" : "s"} missed` : week.inProgress ? "On track so far" : "No planned sessions missed") : "No weekly plan to compare against"}${workouts.activities ? ` · plus ${workouts.activities} ${workouts.activities === 1 ? "activity" : "activities"} (${workouts.activityMinutes} min)` : ""}`}
                  progress={workouts.planned ? workouts.completed / workouts.planned : null} />
              </div>
            )}
            {workouts?.completed > 0 && (
              <div className="t3d-reveal" style={reveal(2)}>
                <ReportTile testId="tile-pbs" label="NEW PBS" value={workouts.personalBests.length} color="#FFB547"
                  sub={workouts.personalBests.length ? `${workouts.minutes} min trained` : `None this week · ${workouts.minutes} min trained`} />
              </div>
            )}
            {workouts?.completed > 0 && (
              <div className="t3d-reveal" style={reveal(3)}>
                <ReportTile testId="tile-volume" label="TRAINING VOLUME" value={`${workouts.volume.toLocaleString()}kg`} color={NEON2}
                  sub={workouts.volumeChangePct !== null ? `${signed(workouts.volumeChangePct)}% vs previous week (${workouts.previousVolume.toLocaleString()}kg)` : "First tracked week — nothing to compare yet"} />
              </div>
            )}
            {habits && habits.completionPct !== null && (
              <div className="t3d-reveal" style={reveal(4)}>
                <ReportTile testId="tile-habits" label="HABIT COMPLETION" value={`${habits.completionPct}%`} color={NEON2} progress={habits.completionPct / 100}
                  sub={`${habits.done} of ${habits.possible} habit-days`} />
              </div>
            )}
            {habits && (
              <div className="t3d-reveal" style={reveal(5)}>
                <ReportTile testId="tile-habit-streak" label={week.inProgress ? "HABIT STREAK" : "HABIT STREAK AT WEEK END"} value={`🔥 ${habits.currentStreak}d`} color="#FF8C00"
                  sub={`${habits.currentStreakHabit ? `${habits.currentStreakHabit} · ` : ""}best ${week.inProgress ? "ever " : "by then "}${habits.bestStreak}d`} />
              </div>
            )}
            {morning && (
              <div className="t3d-reveal" style={reveal(6)}>
                <ReportTile testId="tile-mornings" label="MORNING ROUTINES" value={`${morning.completed} / ${morning.days}`} color="#FF8C00" progress={morning.days ? morning.completed / morning.days : 0}
                  sub={`${morning.averageScore !== null ? `Avg score ${morning.averageScore}/10 · ` : ""}${week.inProgress ? "streak now" : "streak at week end"} ${morning.currentStreak}d`} />
              </div>
            )}
            {nutrition && (
              <div className="t3d-reveal" style={reveal(7)}>
                <ReportTile testId="tile-nutrition" label={nutrition.onTargetDays !== null ? "NUTRITION ON TARGET" : "NUTRITION LOGGED"} color={NEON}
                  value={`${nutrition.onTargetDays !== null ? nutrition.onTargetDays : nutrition.loggedDays} / ${nutrition.days}`}
                  progress={nutrition.days ? (nutrition.onTargetDays ?? nutrition.loggedDays) / nutrition.days : 0}
                  sub={nutrition.averageCalories !== null ? `Avg ${nutrition.averageCalories.toLocaleString()} kcal · ${nutrition.averageProtein}g protein` : "No meals logged this week"} />
              </div>
            )}
            {bodyWeight && (
              <div className="t3d-reveal" style={reveal(8)}>
                <ReportTile testId="tile-weight" label="BODY WEIGHT" value={`${signed(bodyWeight.change)}kg`} color="#E0EAF0"
                  sub={`${bodyWeight.first}kg → ${bodyWeight.last}kg · ${bodyWeight.weighIns} weigh-ins`} />
              </div>
            )}
          </div>

          {workouts?.personalBests.length > 0 && (
            <div className="t3d-card t3d-reveal" data-testid="recap-pbs" style={{ ...reveal(9), borderColor: "rgba(255,181,71,.45)", background: "linear-gradient(135deg, rgba(255,181,71,.1), rgba(255,181,71,.02))" }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#FFB547", letterSpacing: 2, marginBottom: 6 }}>🏆 PERSONAL BESTS</div>
              {workouts.personalBests.map((pb, index) => (
                <div key={`${pb.exercise}-${pb.date}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "7px 0", borderTop: `1px solid ${BORDER}` }}>
                  <strong style={{ color: "#E0EAF0" }}>{pb.exercise}</strong>
                  <span style={{ color: "#FFB547", whiteSpace: "nowrap" }}>{pb.type === "weight_pb" ? `${pb.weight}kg × ${pb.reps}` : `${pb.reps} reps @ ${pb.weight}kg`} · {pb.label}</span>
                </div>
              ))}
            </div>
          )}

          <div className="t3d-card t3d-reveal" data-testid="recap-coach" style={reveal(10)}>
            <div className="t3d-ctitle">COACH'S TAKE</div>
            {generating ? (
              <div role="status" style={{ fontSize: 11, color: NEON }}>{data.summary ? "Coach is updating this for your latest numbers..." : "Coach is reviewing your week..."}</div>
            ) : data.summary && summaryStale ? (
              <div data-testid="coach-stale">
                <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginTop: 0 }}>Your numbers have changed since the coach wrote this, so it is hidden until it is updated.</p>
                <button className="t3d-btn" style={{ width: "100%" }} onClick={generateSummary}>UPDATE COACH&apos;S TAKE</button>
              </div>
            ) : data.summary ? (
              <div style={{ display: "grid", gap: 10 }}>
                {[["BIGGEST WIN", data.summary.biggestWin, "#FFB547"], ["FOCUS FOR NEXT WEEK", data.summary.focus, NEON2], ["COACH'S VERDICT", data.summary.verdict, NEON]].filter(([, text]) => text).map(([label, text, color]) => (
                  <div key={label} style={{ padding: "12px 14px", borderLeft: `3px solid ${color}`, background: SURFACE2, borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color, letterSpacing: 2, marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#D5E0E4", lineHeight: 1.6 }}>{text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginTop: 0 }}>{week.inProgress ? "The week is not over yet. You can get a coach summary of the week so far." : "Get your Biggest Win, one focus for next week and the coach's verdict."}</p>
                <button className="t3d-btn" style={{ width: "100%" }} onClick={generateSummary}>GENERATE WEEKLY REPORT</button>
              </div>
            )}
            {summaryError && <p role="alert" style={{ fontSize: 10, color: "#FFB547", marginBottom: 0 }}>{summaryError}</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

// One line on what each coach style sounds like.
const COACH_STYLE_SUMMARIES = {
  strict: "Short and firm: the gap, then the next step",
  balanced: "Clear reasoning, then the next step",
  supportive: "Encouraging: what went well, then one small step",
};

// ─── Profile form (dashboard "Complete your profile" to-do) ──────────────────
// Height, date of birth and sex in one short form. Date of birth is saved
// rather than age, so age stays right. Any part can be saved on its own
// (for example just the training experience); only what is filled in is
// saved, and the form says what is still missing.
function ProfileForm({ user, profile, today, onSaved, onCancel }) {
  const [heightCm, setHeightCm] = useState(profile?.heightCm ? String(profile.heightCm) : "");
  const [dateOfBirth, setDateOfBirth] = useState(profile?.dateOfBirth || "");
  const [sex, setSex] = useState(sexLabel(profile?.sex));
  const [experienceLevel, setExperienceLevel] = useState(profile?.experienceLevel || "");
  const [personality, setPersonality] = useState(profile?.personality || "balanced");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const problem = profileProblem({ heightCm, dateOfBirth, sex, experienceLevel }, today, { partial: true });
  const missing = missingProfileFields({ heightCm, dateOfBirth, sex, experienceLevel });
  const profileValues = profileUpdate({ heightCm, dateOfBirth, sex });
  const profileChanged = Object.keys(profileChanges(profile || {}, { heightCm, dateOfBirth, sex })).length > 0;
  const coachChanged = (experienceLevel || null) !== (profile?.experienceLevel || null) || personality !== (profile?.personality || "balanced");
  const canSave = !problem && !saving && (profileChanged || coachChanged);
  const touched = Boolean(heightCm || dateOfBirth || sex);
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setStatus("");
    const values = profileValues;
    const updatedAt = new Date().toISOString();
    // Training experience and coach style are read by every coach from
    // coach_profiles. Each table is only written when something in it changed.
    const [profileResult, coachResult] = await Promise.all([
      profileChanged ? supabase.from("user_profiles").upsert({ user_id: user.id, ...values, updated_at: updatedAt }, { onConflict: "user_id" }) : { error: null },
      coachChanged ? supabase.from("coach_profiles").upsert({ user_id: user.id, ...(experienceLevel ? { experience_level: experienceLevel } : {}), personality, updated_at: updatedAt }, { onConflict: "user_id" }) : { error: null },
    ]);
    setSaving(false);
    const error = profileResult.error || coachResult.error;
    if (error) {
      console.error("Profile save error:", error.message);
      setStatus(profileSaveError(error));
      return;
    }
    const changes = [
      personality !== (profile?.personality || "balanced") && `Coach style: ${COACH_PERSONALITIES[personality]?.label || personality}`,
      experienceLevel !== profile?.experienceLevel && profile?.experienceLevel && `Level: ${experienceLevel.toUpperCase()}`,
    ].filter(Boolean);
    if (changes.length) window.dispatchEvent(new CustomEvent("track3d-coach-settings", { detail: { note: changes.join("; ") } }));
    // Fields left empty keep what is stored (a save never clears them).
    const savedFields = normaliseProfile(values, experienceLevel || profile?.experienceLevel);
    onSaved({
      heightCm: savedFields.heightCm ?? profile?.heightCm ?? null,
      dateOfBirth: savedFields.dateOfBirth ?? profile?.dateOfBirth ?? null,
      sex: savedFields.sex ?? profile?.sex ?? null,
      experienceLevel: savedFields.experienceLevel,
      personality,
    });
  };
  return (
    <div data-testid="profile-form" style={{ padding: "12px 0 4px" }}>
      <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.5, marginBottom: 10 }}>Used to work out your calorie targets. Only you can see it.</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 8, marginBottom: 10 }}>
        <label style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>HEIGHT (cm)
          <input className="t3d-input" type="number" inputMode="decimal" aria-label="Height (cm)" placeholder="e.g. 178" value={heightCm} onChange={event => setHeightCm(event.target.value)} style={{ marginTop: 5 }} />
        </label>
        <label style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>DATE OF BIRTH
          <input className="t3d-input" type="date" aria-label="Date of birth" min="1900-01-01" max={today} value={dateOfBirth} onChange={event => setDateOfBirth(event.target.value)} style={{ marginTop: 5 }} />
        </label>
      </div>
      <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 }}>SEX</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {PROFILE_SEX.map(option => (
          <button key={option.id} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={sex === option.label} onClick={() => setSex(option.label)}
            style={{ flex: 1, fontSize: 9, whiteSpace: "normal", background: sex === option.label ? "rgba(0,255,178,.12)" : "transparent", borderColor: sex === option.label ? NEON : BORDER, color: sex === option.label ? NEON : "#8AABB8" }}>{option.label.toUpperCase()}</button>
        ))}
      </div>
      {sex === "Prefer not to say" && <div style={{ fontSize: 10, color: "#8AABB8", marginBottom: 6 }}>{PREFER_NOT_TO_SAY_NOTE}</div>}
      <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1, margin: "12px 0 6px" }}>TRAINING EXPERIENCE <span style={{ color: "#8AABB8", letterSpacing: 0 }}>· how much your coaches explain</span></div>
      <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
        {EXPERIENCE_CHOICES.map(choice => (
          <button key={choice.id} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={experienceLevel === choice.id} onClick={() => setExperienceLevel(choice.id)}
            style={{ textAlign: "left", whiteSpace: "normal", padding: "8px 10px", fontSize: 9, background: experienceLevel === choice.id ? "rgba(0,255,178,.12)" : "transparent", borderColor: experienceLevel === choice.id ? NEON : BORDER, color: experienceLevel === choice.id ? NEON : "#8AABB8" }}>
            {choice.label.toUpperCase()}
            <span style={{ display: "block", marginTop: 2, color: "#8AABB8", fontFamily: "'Inter',sans-serif", fontSize: 10, fontWeight: 400, letterSpacing: 0 }}>{choice.description}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1, margin: "12px 0 6px" }}>COACH STYLE <span style={{ color: "#8AABB8", letterSpacing: 0 }}>· used by every coach</span></div>
      <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
        {Object.entries(COACH_PERSONALITIES).map(([key, option]) => (
          <button key={key} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={personality === key} onClick={() => setPersonality(key)}
            style={{ textAlign: "left", whiteSpace: "normal", padding: "8px 10px", fontSize: 9, background: personality === key ? "rgba(0,255,178,.12)" : "transparent", borderColor: personality === key ? NEON : BORDER, color: personality === key ? NEON : "#8AABB8" }}>
            {option.label}
            <span style={{ display: "block", marginTop: 2, color: "#8AABB8", fontFamily: "'Inter',sans-serif", fontSize: 10, fontWeight: 400, letterSpacing: 0 }}>{COACH_STYLE_SUMMARIES[key]}</span>
          </button>
        ))}
      </div>
      {touched && problem && <div style={{ fontSize: 10, color: "#FFB547", margin: "6px 0" }}>{problem}</div>}
      {!problem && missing.length > 0 && (
        <div data-testid="profile-missing" style={{ fontSize: 10, color: "#8AABB8", margin: "6px 0", lineHeight: 1.5 }}>
          You can save now. Still to add: {missing.join(", ")}{missing.some(field => field !== "training experience") ? " (your calorie targets use height, date of birth and sex)" : ""}.
        </div>
      )}
      {status && <div role="alert" style={{ fontSize: 10, color: "#FFB547", margin: "6px 0" }}>{status}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={onCancel}>CANCEL</button>
        <button className="t3d-btn" style={{ flex: 1, padding: 10 }} disabled={!canSave} onClick={save}>{saving ? "SAVING..." : "SAVE PROFILE"}</button>
      </div>
    </div>
  );
}

function Dashboard({ habits, setHabits, user, onNavigate, profile, onProfileSaved, workoutBannerShown = false, onOpenProfile = null }) {
  // Badges earned since this device last showed them. The first time, earlier
  // badges are summed up in one line instead of each being announced.
  const [badgeNews, setBadgeNews] = useState(null); // { badges, firstTime, earnedIds }
  useEffect(() => {
    if (!user) return;
    fetchAchievements(user).then(list => {
      const seen = readSeenBadges(user.id);
      const earned = list.filter(badge => badge.earned);
      if (seen === null) {
        if (earned.length) setBadgeNews({ badges: [], firstTime: true, earnedIds: earned.map(badge => badge.id) });
        else markBadgesSeen(user.id, []);
        return;
      }
      const fresh = unseenAchievements(list, seen);
      if (fresh.length) setBadgeNews({ badges: fresh, firstTime: false, earnedIds: fresh.map(badge => badge.id) });
    }).catch(() => { /* badges are a bonus: the dashboard works without them */ });
  }, [user]);
  const closeBadgeNews = (openProfile = false) => {
    if (!badgeNews) return;
    markBadgesSeen(user.id, badgeNews.earnedIds);
    setBadgeNews(null);
    if (openProfile) onOpenProfile?.();
  };
  const done = habits.filter(h => h.done).length;
  const [eodDone, setEodDone] = useState(false);
  const [showEod, setShowEod] = useState(false);
  const [view, setView] = useState("home");
  const [activity7, setActivity7] = useState([]);
  const [todayData, setTodayData] = useState({ morning: null, nutrition: null, nutritionPlan: null, sessions: [], workouts: [] });
  const [goals, setGoals] = useState([]);
  const [goalsReady, setGoalsReady] = useState(false);
  const prevGoalsRef = useRef(null);
  const [newGoalText, setNewGoalText] = useState("");
  const homeTimeZone = resolveHomeTimeZone(user);
  const homeDate = getZonedDateInfo(new Date(), homeTimeZone);
  const today = homeDate.dateKey;
  // The "Complete your profile" to-do (the profile itself is loaded by the app).
  const [profileFormOpen, setProfileFormOpen] = useState(false);

  // Weekly report card. A finished week's report that has not been opened
  // goes to the top of the dashboard until it is opened.
  const reportWeekNow = reportWeek(today);
  const [weeklyData, setWeeklyData] = useState(null);
  const [weeklyLoadError, setWeeklyLoadError] = useState(false);
  const weeklySeenKey = `track3d-weekly-seen-${user?.id}`;
  const [weeklySeen, setWeeklySeen] = useState(() => { try { return localStorage.getItem(weeklySeenKey); } catch { return null; } });
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadWeeklyReportData(user, reportWeek(today))
      .then(result => { if (!cancelled) setWeeklyData(result); })
      .catch(() => { if (!cancelled) setWeeklyLoadError(true); });
    return () => { cancelled = true; };
  }, [user, today]);
  const weeklyIsNew = isNewWeeklyReport({ week: reportWeekNow, metrics: weeklyData?.metrics, hasStoredReport: weeklyData?.hasStoredReport, seenWeekStart: weeklySeen });
  const openWeeklyReport = () => {
    if (weeklyIsNew) {
      try { localStorage.setItem(weeklySeenKey, reportWeekNow.start); } catch { /* the saved report also marks it as seen */ }
      setWeeklySeen(reportWeekNow.start);
    }
    setView("weekly");
  };
  const weeklyCard = <WeeklyReport week={reportWeekNow} metrics={weeklyData?.metrics} loadError={weeklyLoadError} isNew={weeklyIsNew} onOpen={openWeeklyReport} />;

  // Load today's Top Goals, then mini-save any add/edit/tick as it happens.
  useEffect(() => {
    if (!user) return;
    setGoalsReady(false);
    supabase.from("daily_goals").select("*").eq("user_id", user.id).eq("date", today).order("created_at", { ascending: true })
      .then(({ data }) => {
        const loaded = (data || []).map(g => ({ id: g.id, text: g.text, done: g.done }));
        prevGoalsRef.current = loaded;
        setGoals(loaded);
        setGoalsReady(true);
      });
  }, [user, today]);

  useEffect(() => {
    if (!user || !goalsReady) return;
    const previous = prevGoalsRef.current || [];
    const currentIds = new Set(goals.map(g => g.id));
    previous.filter(g => !currentIds.has(g.id)).forEach(g => {
      supabase.from("daily_goals").delete().eq("user_id", user.id).eq("date", today).eq("id", g.id)
        .then(({ error }) => { if (error) console.log("Goal delete error:", error); });
    });
    goals.forEach(g => {
      const prevMatch = previous.find(p => p.id === g.id);
      if (!prevMatch || prevMatch.text !== g.text || Boolean(prevMatch.done) !== Boolean(g.done)) {
        supabase.from("daily_goals").upsert({
          id: g.id, user_id: user.id, date: today, text: g.text, done: Boolean(g.done),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,date,id" }).then(({ error }) => { if (error) console.log("Goal save error:", error); });
      }
    });
    prevGoalsRef.current = goals;
  }, [goals, goalsReady, today, user]);

  const addGoal = () => {
    const text = newGoalText.trim();
    if (!text || goals.length >= 3) return;
    setGoals(current => [...current, { id: String(Date.now()), text, done: false }]);
    setNewGoalText("");
  };

  useEffect(() => {
    if (!user) return;
    fetchDailyActivity(user, 7).then(setActivity7);
    // Until all of today's data is in, the cards say "Loading..." rather than
    // showing defaults such as "Rest day" or "Set your daily calorie target".
    Promise.all([
      supabase.from("morning_checkins").select("score,data").eq("user_id", user.id).eq("date", today).maybeSingle(),
      supabase.from("nutrition_logs").select("*").eq("user_id", user.id).eq("date", today).maybeSingle(),
      // The whole plan, for the dashboard's log-as-you-go list.
      readNutritionPlan(user.id),
      readWorkoutSplit(user.id),
      // This week's workouts (with sets), so the coach knows what was lifted.
      supabase.from("workout_logs").select("id,session_name,date,in_progress,total_volume,duration_mins,exercises,created_at").eq("user_id", user.id).gte("date", shiftDateKey(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7))).lte("date", today),
      readMorningRoutine(user.id),
      supabase.from("end_of_day").select("id").eq("user_id", user.id).eq("date", today).maybeSingle(),
    ]).then(([morning, nutrition, nutritionPlan, split, workouts, routine, endOfDay]) => {
      setEodDone(Boolean(endOfDay.data));
      setTodayData({
        loaded: true,
        hasRoutine: Boolean(routine.data),
        wakeTime: routine.data?.wake_time || "",
        hasPlan: Boolean(split.data?.sessions?.length),
        morning: morning.data || null,
        nutrition: nutrition.data || null,
        nutritionPlan: nutritionPlan.data || null,
        sessions: split.data?.sessions || [],
        // Sessions abandoned straight after starting (nothing lifted, under 2 minutes) are not workouts.
        workouts: (workouts.data || []).map(log => ({ ...log, duration_mins: settledWorkoutDuration(log) })).filter(log => log.date === today && !log.in_progress && (Number(log.total_volume) > 0 || (Number(log.duration_mins) || 0) >= 2)),
        weekWorkouts: (workouts.data || []).filter(log => isFinishedWorkout(log, today)).map(log => ({ ...log, duration_mins: settledWorkoutDuration(log), in_progress: false })),
        activeWorkout: (workouts.data || []).find(log => log.date === today && log.in_progress) || null,
      });
    }).catch(error => {
      console.error("Dashboard load error:", error);
      setTodayData(current => ({ ...current, failed: true }));
    });
  }, [user, today]);

  const todaySession = todayData.sessions.find(session => (session.days || []).some(day => String(day).toUpperCase().startsWith(homeDate.dayCode)));
  // Today's meals for the dashboard log: the day type saved with today's log
  // (if the Nutrition page set it), otherwise whether a workout is scheduled.
  const dashboardTrainingDay = typeof todayData.nutrition?.is_training_day === "boolean" ? todayData.nutrition.is_training_day : Boolean(todaySession);
  const dashboardMeals = mealsForDay(todayData.nutritionPlan, today, dashboardTrainingDay);
  const dashMeals = useDashboardMealLog({
    user, today, meals: dashboardMeals, log: todayData.nutrition, loaded: todayData.loaded, isTrainingDay: dashboardTrainingDay,
    onLogged: log => setTodayData(current => ({ ...current, nutrition: log })),
  });
  const mealLogRef = useRef(null);
  // Any workout completed today counts, even if the plan (and its session
  // names) changed after it was done.
  const fitnessDone = Boolean(todaySession && todayData.workouts.length > 0);
  const activeWorkout = todayData.activeWorkout;
  const completedWorkoutNames = [...new Set(todayData.workouts.map(log => log.session_name).filter(Boolean))];
  const morningInProgress = Boolean(todayData.morning?.data?.inProgress);
  const morningSkipped = Boolean(todayData.morning?.data?.routineSkipped);
  const morningDone = Boolean(todayData.morning) && !morningInProgress;
  const caloriesEaten = todayData.nutrition?.total_calories || 0;
  // Today's target: rest days with their own meals have a lighter one.
  const dashboardTargets = dayTargets(todayData.nutritionPlan, dashboardTrainingDay);
  // Meals to swap in from LOG AS YOU GO, as on the Nutrition page.
  const dashboardLibrary = mergeMealLibrary(todayData.nutritionPlan?.meal_library || [], todayData.nutritionPlan?.meals || []);
  const addDashboardLibraryMeal = async meal => {
    if (!user || !todayData.nutritionPlan) return;
    const next = mergeMealLibrary(todayData.nutritionPlan.meal_library || [], [{ ...meal, id: globalThis.crypto?.randomUUID?.() || `meal-${Date.now()}`, ingredients: [] }]);
    const { error } = await supabase.from("nutrition_plans").update({ meal_library: next, updated_at: new Date().toISOString() }).eq("user_id", user.id);
    if (error) { console.error("Meal library save error:", error.message); return; }
    setTodayData(current => ({ ...current, nutritionPlan: current.nutritionPlan ? { ...current.nutritionPlan, meal_library: next } : current.nutritionPlan }));
  };
  const calorieGoal = dashboardTargets.calories || 0;
  // The score is the average of what applies today; its parts are shown under it.
  const { score, parts: scoreParts } = dailyScore({
    habitsDone: done, habitsTotal: habits.length,
    hasRoutine: todayData.hasRoutine, morningDone, morningScore: todayData.morning?.score,
    caloriesEaten, calorieGoal,
    workoutScheduled: Boolean(todaySession), workoutDone: fitnessDone,
  });
  // Real figures for the dashboard coach; anything missing is "not logged".
  const coachDayContext = [
    `- Morning routine: ${morningSkipped ? "skipped today" : morningDone ? `done, score ${todayData.morning?.score ?? 0}/10` : morningInProgress ? "started, not finished" : "not logged"}`,
    `- Workout: ${activeWorkout ? `${activeWorkout.session_name} in progress` : completedWorkoutNames.length ? `completed ${completedWorkoutNames.join(" + ")}` : todaySession ? `${todaySession.name} scheduled, not logged yet` : todayData.sessions.length ? "no session scheduled today" : "no training plan set up"}`,
    ...todayData.workouts.flatMap(log => {
      const lines = bestSetsSummary(log.exercises || []);
      const pbs = workoutPersonalBests(log.exercises || []);
      return [
        ...(lines.length ? [`- ${log.session_name} lifts: ${lines.join("; ")}`] : []),
        `- ${log.session_name} PBs: ${pbs.length ? pbs.map(pb => `${pb.exercise} ${pb.weight}kg × ${pb.reps} (${pb.label})`).join("; ") : "none today"}`,
      ];
    }),
    `- Workouts this week: ${(() => { const week = weeklyWorkoutProgress(todayData.weekWorkouts || [], today, todayData.sessions, null, { countCurrent: false }); return `${week.planned ? `${week.completed} of ${week.planned} planned` : `${week.completed}`}${week.activities ? `, plus ${week.activities} other ${week.activities === 1 ? "activity" : "activities"} (not weight training)` : ""}`; })()}`,
    `- Nutrition: ${todayData.nutrition ? `${todayData.nutrition.total_calories || 0} kcal, ${todayData.nutrition.total_protein || 0}g protein logged` : "not logged"}${calorieGoal ? ` (app target ${calorieGoal} kcal${dashboardTargets.restDay ? " for a rest day" : ""}${todayData.nutritionPlan?.protein_target ? `, ${todayData.nutritionPlan.protein_target}g protein` : ""})` : " (no calorie target set)"}`,
    ...(todayData.nutrition?.off_plan_food && Number(todayData.nutrition.off_plan_calories) > 0 ? [`- Off-plan food: ${todayData.nutrition.off_plan_food} (${todayData.nutrition.off_plan_calories} kcal, included above)`] : []),
    ...(unloggedFoodFromLog(todayData.nutrition).length ? [`- Food eaten with no calories entered (the calorie total above is incomplete): ${unloggedFoodFromLog(todayData.nutrition).join("; ")}`] : []),
    `- Habits: ${habits.length ? `${done}/${habits.length} done${habits.some(h => h.done) ? ` (done: ${habits.filter(h => h.done).map(h => h.name).join(", ")})` : ""}${habits.some(h => !h.done) ? ` (pending: ${habits.filter(h => !h.done).map(h => h.name).join(", ")})` : ""}` : "none set up"}`,
    `- Daily score: ${score}/100 (calculated from the items above)`,
  ].join("\n");

  if (view === "history") return <DashboardHistory user={user} onBack={() => setView("home")} />;
  if (view === "weekly") return <WeeklyRecap user={user} onBack={() => setView("home")} />;
  if (showEod) return <EndOfDayCheckin user={user} onComplete={() => { setEodDone(true); setShowEod(false); }} />;
  const nextUp = nextUpItems({
    hour: Number(homeDate.time.slice(0, 2)),
    morning: { hasRoutine: todayData.hasRoutine, done: morningDone, inProgress: morningInProgress, wakeTime: todayData.wakeTime },
    // The banner above already continues an active workout.
    workout: workoutBannerShown
      ? { inProgressName: null, scheduledName: null, done: true }
      : { inProgressName: activeWorkout?.session_name || null, scheduledName: todaySession?.name || null, scheduledActivity: isActivitySession(todaySession), done: fitnessDone },
    meals: dashboardMeals.map((meal, index) => ({ name: meal.name, time: meal.time, index, logged: isMealAnswered(dashMeals.results[index]), flexible: isFlexibleMeal(meal) })),
    habits,
    endOfDayDone: eodDone,
  }).map(item => (item.id === "meal" && dashboardMeals[item.mealIndex] && isFlexibleMeal(dashboardMeals[item.mealIndex]) ? { ...item, action: "ENTER IT →" } : item));
  // One tap: start the morning or workout on its tab, log the meal, tick the
  // habit, or open the end-of-day check-in.
  const runNextUp = item => {
    if (item.id === "morning" || item.id === "workout") {
      onNavigate(item.id === "morning" ? "morning" : "fitness");
      window.dispatchEvent(new CustomEvent("track3d-start", { detail: { kind: item.id } }));
    } else if (item.id === "meal") {
      if (isFlexibleMeal(dashboardMeals[item.mealIndex])) mealLogRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      else dashMeals.markEaten(item.mealIndex);
    } else if (item.id === "habit") {
      setHabits(current => current.map(habit => (habit.id === item.habitId ? { ...habit, done: true } : habit)));
    } else if (item.id === "endOfDay") {
      setShowEod(true);
    }
  };
  const firstRunSteps = [
    { label: "Complete your profile", done: isProfileComplete(profile), profile: true },
    { label: "Set up your morning", done: todayData.hasRoutine, section: "morning" },
    { label: "Build your training plan", done: todayData.hasPlan, section: "fitness" },
    { label: "Set your calorie target", done: Boolean(calorieGoal), section: "nutrition" },
  ];
  const showGetStarted = todayData.loaded && profile && firstRunSteps.some(step => !step.done);
  // Shown in today's cards until the day's data is in.
  const dayWaiting = <div style={{ fontSize: 11, color: "#8AABB8" }}>{todayData.failed ? "Couldn't load today. Reload the page to try again." : "Loading..."}</div>;
  return (
    <div className="t3d-fade">
      {weeklyIsNew && weeklyCard}
      {badgeNews && !badgeNews.firstTime && <NewBadgesNotice badges={badgeNews.badges} onSeeAll={() => closeBadgeNews(true)} onDismiss={() => closeBadgeNews(false)} />}
      {badgeNews?.firstTime && (
        <div data-testid="badges-intro" role="status" style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 8, border: "1px solid rgba(255,210,63,.6)", background: "linear-gradient(160deg, rgba(255,210,63,.14), rgba(255,140,0,.04))" }}>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#FFD23F", letterSpacing: 2, marginBottom: 6 }}>🏅 ACHIEVEMENTS ARE HERE</div>
          <div style={{ fontSize: 12, color: "#E0EAF0", lineHeight: 1.5 }}>You&apos;ve already earned {badgeNews.earnedIds.length} {badgeNews.earnedIds.length === 1 ? "badge" : "badges"} for your training, mornings, habits and nutrition so far.</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" className="t3d-btn t3d-btn-sm" style={{ borderColor: "#FFD23F", color: "#FFD23F" }} onClick={() => closeBadgeNews(true)}>SEE ALL BADGES</button>
            <button type="button" className="t3d-btn t3d-btn-sm" style={{ borderColor: BORDER, color: "#8AABB8" }} onClick={() => closeBadgeNews(false)}>DISMISS</button>
          </div>
        </div>
      )}
      {/* Next up: the next thing due today, one tap to start it. A new user
          with nothing due yet sees GET STARTED first instead. */}
      {!(showGetStarted && !nextUp.length) && <div className="t3d-card" data-testid="next-up" style={{ marginBottom: 16, borderColor: "rgba(0,255,178,.35)", background: "linear-gradient(160deg, rgba(0,255,178,.06), transparent 70%)" }}>
        <div className="t3d-ctitle">NEXT UP</div>
        {!todayData.loaded ? (
          <div style={{ fontSize: 11, color: "#8AABB8" }}>{todayData.failed ? "Couldn't load your day. Reload the page to try again." : "Loading your day..."}</div>
        ) : nextUp.length ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <div data-testid="next-up-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: "#E0EAF0", letterSpacing: 1, overflowWrap: "anywhere" }}>{nextUp[0].title}</div>
                <div style={{ fontSize: 11, color: "#8AABB8", marginTop: 4 }}>{nextUp[0].detail}</div>
              </div>
              <button className="t3d-big-btn" data-testid="next-up-action" style={{ flex: "0 1 220px", margin: 0, background: "linear-gradient(90deg, #00FFB2, #00D99A)", border: `1px solid ${NEON}`, color: "#06100D", fontSize: 12, fontWeight: 900, letterSpacing: 2 }} onClick={() => runNextUp(nextUp[0])}>{nextUp[0].action}</button>
            </div>
            {nextUp.length > 1 && (
              <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 8, color: "#6F8792", letterSpacing: 1.5, marginBottom: 2 }}>THEN</div>
                {nextUp.slice(1).map(item => (
                  <div key={`${item.id}-${item.mealIndex ?? item.habitId ?? ""}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: "#C5D6DC" }}>{item.title} <span style={{ color: "#6F8792" }}>· {item.detail}</span></div>
                    <button className="t3d-btn t3d-btn-sm" style={{ minHeight: 44 }} onClick={() => runNextUp(item)}>{item.action}</button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: "#C5D6DC", lineHeight: 1.6 }}>
            All caught up for now.{!eodDone && <> <button type="button" onClick={() => setShowEod(true)} style={{ background: "none", border: 0, color: NEON2, cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>End-of-day check-in</button> when you&apos;re done for the day.</>}
          </div>
        )}
      </div>}
      {showGetStarted && (
        <div className="t3d-card" style={{ marginBottom: 16, borderColor: "rgba(0,255,178,.35)" }}>
          <div className="t3d-ctitle">GET STARTED</div>
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {firstRunSteps.map((step, index) => (
              <li key={step.label} data-testid={step.profile ? "profile-todo" : undefined} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "8px 0", borderBottom: index < firstRunSteps.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, border: `1px solid ${step.done ? NEON : "#31434F"}`, color: step.done ? "#06100D" : "#8AABB8", background: step.done ? NEON : "transparent" }}>{step.done ? "✓" : index + 1}</span>
                <span style={{ flex: 1, fontSize: 12, color: step.done ? "#6F8792" : "#E0EAF0", textDecoration: step.done ? "line-through" : "none" }}>
                  {step.label}{step.done ? <span className="t3d-sr-only"> (done)</span> : null}
                </span>
                {!step.done && !(step.profile && profileFormOpen) && <button className="t3d-btn t3d-btn-sm" style={{ minHeight: 44 }} onClick={() => (step.profile ? setProfileFormOpen(true) : onNavigate(step.section))}>START →</button>}
                {step.profile && profileFormOpen && !step.done && (
                  <div style={{ flexBasis: "100%" }}>
                    <ProfileForm user={user} profile={profile} today={today} onCancel={() => setProfileFormOpen(false)} onSaved={saved => { onProfileSaved(saved); setProfileFormOpen(false); }} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <div className="t3d-card" style={{ marginBottom: 14 }}>
          <div className="t3d-ctitle">TOP GOALS FOR TODAY</div>
          {goals.length === 0 ? (
            <div style={{ color: "#8AABB8", fontSize: 11, lineHeight: 1.6, marginBottom: 10 }}>
              What are the 3 most important things you want to get done today?
            </div>
          ) : null}
          {goals.map(g => (
            <div key={g.id} className="t3d-hrow">
              <div className={`t3d-hcheck ${g.done ? "done" : ""}`} style={{ cursor: "pointer" }}
                onClick={() => setGoals(gs => gs.map(x => x.id === g.id ? { ...x, done: !x.done } : x))}>{g.done ? "✓" : ""}</div>
              <input className="t3d-input" value={g.text} style={{ flex: 1, background: "transparent", border: 0, padding: "4px 6px", color: g.done ? "#E0EAF0" : "#4A6070", textDecoration: g.done ? "line-through" : "none" }}
                onChange={e => setGoals(gs => gs.map(x => x.id === g.id ? { ...x, text: e.target.value } : x))} />
              <button type="button" aria-label={`Remove goal: ${g.text || "goal"}`} onClick={() => setGoals(gs => gs.filter(x => x.id !== g.id))} style={{ border: 0, background: "transparent", color: "#6F8792", cursor: "pointer", fontSize: 14, minWidth: 44, minHeight: 44, padding: 0 }}>×</button>
            </div>
          ))}
          {goals.length < 3 && (
            <div style={{ display: "flex", gap: 8, marginTop: goals.length ? 10 : 0 }}>
              <input className="t3d-input" placeholder={goals.length === 0 ? "e.g. Finish the client proposal" : "Add another goal..."} value={newGoalText}
                onChange={e => setNewGoalText(e.target.value)} onKeyDown={e => e.key === "Enter" && addGoal()} style={{ flex: 1 }} />
              <button className="t3d-btn t3d-btn-sm" disabled={!newGoalText.trim()} onClick={addGoal}>+ ADD</button>
            </div>
          )}
        </div>
        <div className="t3d-card" style={{ marginBottom: 14 }}>
          <div className="t3d-ctitle">DO YOUR DAILY HABITS</div>
          {habits.length === 0 && <div style={{ color: "#8AABB8", fontSize: 11, lineHeight: 1.6 }}>You have not added any habits yet.<br /><button className="t3d-btn t3d-btn-sm" style={{ marginTop: 10 }} onClick={() => onNavigate("habits")}>ADD YOUR HABITS</button></div>}
          {habits.map(h => (
            <button type="button" key={h.id} className="t3d-hrow" aria-pressed={Boolean(h.done)} aria-label={`${h.name}, ${habitStreak(h)} day streak`} onClick={() => setHabits(hh => hh.map(x => x.id===h.id ? {...x, done:!x.done} : x))}
              style={{ width: "100%", minHeight: 44, background: "none", border: 0, borderBottom: `1px solid ${BORDER}`, color: "inherit", font: "inherit", textAlign: "left" }}>
              <span className={`t3d-hcheck ${h.done?"done":""}`}>{h.done?"✓":""}</span>
              <span className="t3d-hname" style={{ color: h.done ? "#E0EAF0" : "#4A6070" }}>{h.name}</span>
              <span className={`t3d-hstreak ${habitStreak(h)>=7?"fire":""}`}>{habitStreak(h)>=7?"🔥":"◆"} {habitStreak(h)}d</span>
            </button>
          ))}
        </div>
        {todayData.loaded && dashboardMeals.length > 0 && (
          <div className="t3d-card" data-testid="dashboard-meal-log" ref={mealLogRef} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div className="t3d-ctitle" style={{ margin: 0 }}>LOG AS YOU GO</div>
              <span style={{ fontSize: 8, color: dashboardTrainingDay ? NEON : NEON2, letterSpacing: 1 }}>{dashboardTrainingDay ? "TRAINING DAY" : "REST DAY"} MEALS</span>
            </div>
            <MealLogList meals={dashboardMeals} results={dashMeals.results} onResultsChange={dashMeals.setResults} onSave={dashMeals.save} compact library={dashboardLibrary} onAddToLibrary={addDashboardLibraryMeal} />
            <LogSomethingElse onAdd={dashMeals.addExtra} />
            {dashMeals.error && <div role="alert" style={{ color: NEON3, fontSize: 9, lineHeight: 1.5, marginTop: 6 }}>{dashMeals.error}</div>}
            <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 10 }} onClick={() => onNavigate("nutrition")}>{todayData.nutrition?.meals_completed && todayData.nutrition.meals_completed._review_complete !== false ? "OPEN NUTRITION →" : "DAY REVIEW IN NUTRITION →"}</button>
          </div>
        )}
        <AICoach dayContext={coachDayContext} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 16 }}>
        <div className="t3d-card">
          <div className="t3d-ctitle">DAILY SCORE</div>
          {!todayData.loaded ? dayWaiting : <>
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
              <ScoreRing score={score} />
            </div>
            {scoreParts.length > 0 && (
              <div data-testid="score-parts" style={{ marginTop: 8, display: "grid", gap: 3 }}>
                {scoreParts.map(part => (
                  <div key={part.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9, color: "#8AABB8" }}>
                    <span>{part.label}</span><span style={{ color: part.value >= 1 ? NEON : "#C5D6DC" }}>{part.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>}
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">MORNING ROUTINE</div>
          {!todayData.loaded ? dayWaiting : <>
            <div style={{ fontSize: 46, color: morningDone && !morningSkipped ? NEON : morningInProgress ? "#FFB547" : BORDER, lineHeight: 1 }}>{morningDone && !morningSkipped ? "✓" : morningInProgress ? "…" : "○"}</div>
            <div className="t3d-slabel" style={{ marginTop: 10 }}>{morningSkipped ? "SKIPPED TODAY" : morningDone ? `DONE · SCORE ${todayData.morning?.score || 0}/10` : morningInProgress ? "STARTED · NOT FINISHED" : "NOT DONE YET"}</div>
            <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 12 }} onClick={() => onNavigate("morning")}>{morningDone ? "VIEW MORNING" : morningInProgress ? "GO TO MORNING →" : !todayData.hasRoutine ? "SET UP MY MORNING →" : "START MORNING →"}</button>
          </>}
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">FITNESS TODAY</div>
          {!todayData.loaded ? dayWaiting : activeWorkout ? <>
            <div style={{ fontSize: 22, color: "#FFB547", fontFamily: "'Orbitron',monospace", overflowWrap: "anywhere" }}>{activeWorkout.session_name}</div>
            <div className="t3d-slabel" style={{ marginTop: 10 }}>WORKOUT IN PROGRESS</div>
          </> : todaySession && !fitnessDone ? <>
            <div style={{ fontSize: 22, color: NEON2, fontFamily: "'Orbitron',monospace", overflowWrap: "anywhere" }}>{todaySession.name}</div>
            <div className="t3d-slabel" style={{ marginTop: 10 }}>SCHEDULED TODAY</div>
          </> : completedWorkoutNames.length ? <>
            <div style={{ fontSize: 22, color: NEON, fontFamily: "'Orbitron',monospace", overflowWrap: "anywhere" }}>✓ {completedWorkoutNames.join(" + ")}</div>
            <div className="t3d-slabel" style={{ marginTop: 10 }}>COMPLETED TODAY</div>
          </> : !todayData.hasPlan ? <div style={{ color: "#8AABB8", fontSize: 12 }}>No training plan yet.</div>
            : <div style={{ color: "#8AABB8", fontSize: 12 }}>Rest day. Nothing scheduled.</div>}
          {todayData.loaded && !(activeWorkout && workoutBannerShown) && <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 12 }} onClick={() => onNavigate("fitness")}>{activeWorkout ? "CONTINUE WORKOUT →" : todaySession && !fitnessDone ? (isActivitySession(todaySession) ? "LOG IT →" : "START WORKOUT →") : !todayData.hasPlan ? "BUILD MY PLAN →" : "OPEN FITNESS"}</button>}
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">CALORIES</div>
          {!todayData.loaded ? dayWaiting : calorieGoal ? <>
            <div className="t3d-sval" style={{ color: NEON2 }}>{caloriesEaten.toLocaleString()} <span style={{ fontSize: 12, letterSpacing: 1 }}>KCAL</span></div>
            <div className="t3d-slabel">EATEN OF {calorieGoal.toLocaleString()} TARGET</div>
            {unloggedFoodFromLog(todayData.nutrition).length > 0 && <div data-testid="kcal-excludes" style={{ fontSize: 9, color: "#FFB547", marginTop: 4 }}>Excludes: {unloggedFoodFromLog(todayData.nutrition).join(", ")}</div>}
            <div className="t3d-pbar"><div className="t3d-pfill" style={{ width: `${Math.min((caloriesEaten/calorieGoal)*100,100)}%`, background: "linear-gradient(90deg,#00C8FF,#0080FF)" }} /></div>
          </> : <>
            <div style={{ fontSize: 12, color: "#E0EAF0", lineHeight: 1.6 }}>Set your daily calorie target first.</div>
            <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 12 }} onClick={() => onNavigate("nutrition")}>SET DAILY TARGET</button>
          </>}
        </div>
      </div>

      {/* End of Day Check-in */}
      <div className="t3d-card" style={{ textAlign: "center", padding: 28 }}>
        {!todayData.loaded ? dayWaiting : eodDone ? (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🌙</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 4 }}>DAY CHECKED IN</div>
            <div style={{ fontSize: 11, color: "#E0EAF0" }}>Great work today. See you tomorrow!</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 16, letterSpacing: 1 }}>READY TO CLOSE OUT YOUR DAY?</div>
            <button className="t3d-big-btn"
              style={{ background: "linear-gradient(90deg, rgba(0,200,255,.15), rgba(0,255,178,.1))", border: `1px solid ${NEON2}`, color: NEON2, fontSize: 13, letterSpacing: 3 }}
              onClick={() => setShowEod(true)}>
              🌙 END OF DAY CHECK-IN
            </button>
            <div style={{ fontSize: 10, color: "#6F8792", marginTop: 12 }}>Do this last, once your morning, workout and meals are logged.</div>
          </>
        )}
      </div>
      {!weeklyIsNew && weeklyCard}

      <div className="t3d-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="t3d-ctitle" style={{ margin: 0 }}>LAST 7 DAYS</div>
          <button className="t3d-btn t3d-btn-sm" onClick={() => setView("history")}>VIEW MORE →</button>
        </div>
        <div className="t3d-hmap">
          {activity7.map((d, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div className="t3d-hcell" title={d.date} style={{ background: heatColor(d.activity) }} />
              <div style={{ fontSize: 8, marginTop: 4, letterSpacing: .5, color: d.date === today ? NEON : "#6F8792" }}>
                {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" }).toUpperCase()}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: "#6F8792", marginTop: 10, lineHeight: 1.5 }}>Brighter = more logged that day (morning, nutrition, workout, end of day).</div>
      </div>

      <ProgressPhotos user={user} />
    </div>
  );
}

// ─── Fitness Section ──────────────────────────────────────────────────────────
// ─── Exercise progression line chart ──────────────────────────────────────────
const SET_LINE_COLORS = [NEON, NEON2, "#FF8C00", NEON3, "#A06CFF", "#FFD23F"];

function ExerciseLineChart({ points }) {
  const W = 280, H = 200;
  const pad = { l: 30, r: 10, t: 26, b: 26 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;
  const maxSets = points.reduce((m, p) => Math.max(m, p.sets.length), 0);

  const weightOf = (set) => parseFloat(set.weight) || 0;
  const repsOf = (set) => parseInt(set.reps) || 0;
  const maxV = Math.max(...points.flatMap(p => p.sets.map(weightOf)), 1);

  if (points.length === 0 || maxSets === 0) {
    return <div style={{ textAlign: "center", padding: "30px 0", fontSize: 11, color: "#E0EAF0" }}>Not enough history for this exercise yet.</div>;
  }

  const x = (i) => points.length > 1 ? pad.l + (i * chartW) / (points.length - 1) : pad.l + chartW / 2;
  const y = (v) => pad.t + chartH * (1 - v / maxV);

  const lines = Array.from({ length: maxSets }, (_, k) => {
    const pts = points
      .map((p, i) => p.sets[k] ? { x: x(i), y: y(weightOf(p.sets[k])), label: `${weightOf(p.sets[k])}kg × ${repsOf(p.sets[k])}` } : null)
      .filter(Boolean);
    return { setNum: k + 1, color: SET_LINE_COLORS[k % SET_LINE_COLORS.length], pts };
  });

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {[0, 0.5, 1].map(f => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + chartH * f} y2={pad.t + chartH * f} stroke={BORDER} strokeWidth="1" />
        ))}
        <text x={pad.l - 6} y={pad.t + 4} fontSize="8" fill="#E0EAF0" textAnchor="end">{Math.round(maxV)}kg</text>
        <text x={pad.l - 6} y={pad.t + chartH + 4} fontSize="8" fill="#E0EAF0" textAnchor="end">0</text>

        {lines.map((line, li) => (
          <g key={line.setNum}>
            <polyline points={line.pts.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={line.color} strokeWidth="2" />
            {line.pts.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="3" fill={line.color} />
                <text x={p.x} y={p.y - 8 - li * 10} fontSize="7" fill={line.color} textAnchor="middle">{p.label}</text>
              </g>
            ))}
          </g>
        ))}

        <text x={pad.l} y={H - 6} fontSize="8" fill="#E0EAF0" textAnchor="start">
          {new Date(points[0].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </text>
        <text x={W - pad.r} y={H - 6} fontSize="8" fill="#E0EAF0" textAnchor="end">
          {new Date(points[points.length - 1].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </text>
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 10 }}>
        {lines.map(line => (
          <div key={line.setNum} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: line.color }} />
            SET {line.setNum}
          </div>
        ))}
      </div>
    </div>
  );
}

// Read-only view of one planned session: used by plan approval, the plan
// preview sheet and the Import My Plan review. It never starts or edits anything.
function PlanSessionCard({ session, description, label }) {
  const minutes = sessionPlannedMinutes(session);
  return (
    <div style={{ padding: 13, background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 7, marginBottom: 10, textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
        <strong style={{ color: NEON, fontSize: 12, overflowWrap: "anywhere" }}>{session.name}</strong>
        <span style={{ color: NEON2, fontSize: 10, whiteSpace: "nowrap" }}>{label || (session.days || []).join(" / ") || "FLEXIBLE"} · {minutes} MIN</span>
      </div>
      {description && <div style={{ fontSize: 11, color: "#B4C5CC", lineHeight: 1.55, marginBottom: 9, whiteSpace: "pre-wrap" }}>{description}</div>}
      {/* An activity (HYROX, a run...) has no exercise list: say what it is and how it's logged. */}
      {isActivitySession(session) && (
        <div data-testid="activity-details" style={{ fontSize: 11, color: "#B4C5CC", lineHeight: 1.55, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
          <div>{activityTypeLabel(session.activityType)} · about {minutes} minutes{(session.days || []).length ? ` · ${(session.days || []).join(" / ")}` : ""}</div>
          <div style={{ color: "#8AABB8", fontSize: 10, marginTop: 4 }}>An activity, not a gym workout: there are no exercises or sets. When you&apos;ve done it, log the time it took and how hard it felt.</div>
        </div>
      )}
      {(session.exercises || []).map((exercise, exerciseIndex) => (
        <div key={`${exercise.name}-${exerciseIndex}`} style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr) auto", gap: 10, padding: "6px 0", borderTop: `1px solid ${BORDER}`, fontSize: 10 }}>
          <span style={{ color: "#6F8792" }}>{exerciseIndex + 1}</span>
          <span style={{ color: "#D5E0E4", minWidth: 0 }}>
            {exercise.name}
            {(exercise.notes || exercise.tempo || exercise.rest_seconds) && (
              <span style={{ display: "block", color: "#6F8792", fontSize: 9, marginTop: 2, lineHeight: 1.45 }}>
                {[exercise.tempo && `Tempo ${exercise.tempo}`, exercise.rest_seconds && `Rest ${exercise.rest_seconds}s`, exercise.notes].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
          <span style={{ color: "#8AABB8", textAlign: "right", whiteSpace: "nowrap" }}>{setsRepsSummary(exercise)}</span>
        </div>
      ))}
    </div>
  );
}

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

// Small, secondary "what am I training?" button. Viewing never logs anything.
function PlanPreviewButton({ label, onClick }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={event => { event.stopPropagation(); onClick(); }}
      style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, color: "#8AABB8", cursor: "pointer", width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}>
      <EyeIcon />
    </button>
  );
}

function PlanPreviewSheet({ title, entries, notes, onClose }) {
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 120, padding: "16px 12px 0" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="plan-preview-title" data-testid="plan-preview" onClick={event => event.stopPropagation()}
        className="t3d-card" style={{ width: "100%", maxWidth: 620, maxHeight: "86dvh", overflowY: "auto", marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingTop: 0 }}>
        <div style={{ position: "sticky", top: 0, background: SURFACE, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 0 10px", zIndex: 1 }}>
          <div id="plan-preview-title" className="t3d-ctitle" style={{ margin: 0 }}>{title}</div>
          <button className="t3d-btn t3d-btn-sm" onClick={onClose}>CLOSE ✕</button>
        </div>
        {notes && <div style={{ fontSize: 11, color: "#B4C5CC", lineHeight: 1.55, marginBottom: 10, whiteSpace: "pre-wrap" }}>{notes}</div>}
        {entries.length ? entries.map((entry, index) => (
          <PlanSessionCard key={`${entry.session.name}-${index}`} session={entry.session} label={entry.label} description={entry.session.notes || entry.session.reasoning} />
        )) : <div style={{ fontSize: 11, color: "#8AABB8", padding: "8px 0 16px" }}>No sessions are planned.</div>}
        <div style={{ fontSize: 9, color: "#6F8792", padding: "4px 0 16px" }}>View only. Nothing is started or changed.</div>
      </div>
    </div>
  );
}

// "Upper A · Set 2 of 4 · Bench Press": where an active workout is up to.
function workoutProgressLine({ activeSession, exerciseIdx = 0, completedSets = {} } = {}) {
  const exercise = activeSession?.exercises?.[exerciseIdx || 0];
  if (!exercise) return activeSession?.name || "";
  const done = (completedSets?.[exerciseIdx || 0] || []).length;
  const total = Number(exercise.sets) || 0;
  return [activeSession.name, total && done < total ? `Set ${done + 1} of ${total}` : "Sets done", exercise.name].filter(Boolean).join(" · ");
}

const exerciseCountText = session => { const count = session?.exercises?.length || 0; return `${count} exercise${count === 1 ? "" : "s"}`; };

function normalizeFitnessSessions(sessions = []) {
  return sessions.map(session => ({
    ...session,
    exercises: (session.exercises || []).map(exercise => {
      const sets = Math.max(1, parseInt(exercise.sets, 10) || 3);
      // One target per set, also when the plan kept them in one string ("6-8,6-8,8,10").
      return { ...exercise, sets, reps: repTargets(exercise.reps, sets) };
    }),
  }));
}

function Fitness({ user, isActive = true }) {
  const homeTimeZone = resolveHomeTimeZone(user);
  const zonedToday = useZonedDateKey(homeTimeZone);
  const homeDate = { ...getZonedDateInfo(new Date(), homeTimeZone), dateKey: zonedToday };
  const [view, setView] = useState("home");
  // Each screen change starts at the top, not wherever the last screen was scrolled to.
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  const [split, setSplit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupStep, setSetupStep] = useState(0);
  const [editDaysModal, setEditDaysModal] = useState(false);
  const [numSessions, setNumSessions] = useState(3);
  const [sessions, setSessions] = useState([]);
  const [planPreview, setPlanPreview] = useState(null); // read-only plan sheet
  const [setupExperience, setSetupExperience] = useState(null); // asked once during fitness setup
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState(null); // interpreted plan awaiting review
  const [importError, setImportError] = useState("");
  const [planSaveError, setPlanSaveError] = useState(""); // a plan change that did not save
  const [importFileNote, setImportFileNote] = useState("");
  const [importInterpreting, setImportInterpreting] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importEditing, setImportEditing] = useState(false); // imported plan open in the builder
  const [currentSessionIdx, setCurrentSessionIdx] = useState(0);
  const [history, setHistory] = useState([]);
  const [showEmptyWorkouts, setShowEmptyWorkouts] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restTimerEnabled, setRestTimerEnabled] = useState(false);
  const [restSeconds, setRestSeconds] = useState(90);
  const [restActive, setRestActive] = useState(false);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restDeadline, setRestDeadline] = useState(null);
  const [aiAnswers, setAiAnswers] = useState({});
  const [aiStep, setAiStep] = useState(0);
  const [aiBuilding, setAiBuilding] = useState(false);
  const [aiBuildStage, setAiBuildStage] = useState(0);
  // Question ids still to ask (null = all); set when answers are pre-filled from a coach chat.
  const [aiQuestionIds, setAiQuestionIds] = useState(null);
  const [aiChatContext, setAiChatContext] = useState("");
  const [planRebuildPreparing, setPlanRebuildPreparing] = useState(false);
  const [aiPrefillNote, setAiPrefillNote] = useState("");
  const [aiPlan, setAiPlan] = useState(null);
  const [aiPlanError, setAiPlanError] = useState("");
  const [aiPlanSaving, setAiPlanSaving] = useState(false);
  const [coachMessages, setCoachMessages] = useState([]);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const [planChangeMessages, setPlanChangeMessages] = useState([]);
  const [planChangeInput, setPlanChangeInput] = useState("");
  const [planChangeLoading, setPlanChangeLoading] = useState(false);
  const [planChangeRecommendation, setPlanChangeRecommendation] = useState(null);
  // Bumped to bring a waiting Proposed change card back into view.
  const [planChangeHighlight, setPlanChangeHighlight] = useState(0);
  // A change still waiting for approval keeps its conversation when Change
  // Plan is opened again. (Defined here: the workout screen returns before
  // the plan-change functions further down.)
  const planChangeHasPending = planChangeMessages.some(message => ["pending", "saving"].includes(message.proposal?.status));
  const planChangeLogRef = useRef(null);
  // New messages scroll the plan-change chat to the bottom; a change waiting
  // for approval stays pinned in view there.
  useEffect(() => {
    const log = planChangeLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [planChangeMessages.length, planChangeLoading, planChangeOpen]);
  const [replaceWarning, setReplaceWarning] = useState(null);
  const [noDaysWarning, setNoDaysWarning] = useState(false);
  const [endWorkoutConfirm, setEndWorkoutConfirm] = useState(null);
  const [addExerciseModal, setAddExerciseModal] = useState(null); // sessionIdx when open
  const [newEx, setNewEx] = useState({ name: "", sets: 3, reps: [], repsAll: "", perSet: false, tempo: "" });
  const [editingExerciseIdx, setEditingExerciseIdx] = useState(null);
  const [emptySessionsWarning, setEmptySessionsWarning] = useState(false);
  const [viewingSession, setViewingSession] = useState(null); // log entry shown in the history popup
  const [viewingExercise, setViewingExercise] = useState(null); // exercise name shown as a graph within the popup
  const [editingHistorySession, setEditingHistorySession] = useState(false);
  const [historyEditOriginal, setHistoryEditOriginal] = useState(null);
  const [historySaving, setHistorySaving] = useState(false);
  const [deleteHistoryWorkout, setDeleteHistoryWorkout] = useState(null);
  const [draggedWorkoutDay, setDraggedWorkoutDay] = useState(null);
  const [showOtherWorkouts, setShowOtherWorkouts] = useState(false);
  // Other activities (running, HYROX, ...): a quick log with duration and
  // effort, and a place in the weekly plan.
  const [activityForm, setActivityForm] = useState(null);
  const [activitySaving, setActivitySaving] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityNotice, setActivityNotice] = useState("");
  const [planActivityForm, setPlanActivityForm] = useState(null);
  // Confirmation under the weekly plan after an activity is added to it.
  const [planNotice, setPlanNotice] = useState("");
  const [discardWorkoutWarning, setDiscardWorkoutWarning] = useState(false);
  const [pendingSession, setPendingSession] = useState(null);
  const [switchWorkout, setSwitchWorkout] = useState(null); // { session, options }: start it, finishing the workout in progress?
  const [availableMinutes, setAvailableMinutes] = useState("");
  const [gymContext, setGymContext] = useState("usual");
  const [gymName, setGymName] = useState("");
  const [editingSet, setEditingSet] = useState(null);
  const [completionFeedback, setCompletionFeedback] = useState("");
  const [completionFeedbackLoading, setCompletionFeedbackLoading] = useState(false);
  const [completionFollowUps, setCompletionFollowUps] = useState([]);
  const [completionQuestion, setCompletionQuestion] = useState("");
  const [completionReplyLoading, setCompletionReplyLoading] = useState(false);
  const [workoutSaveError, setWorkoutSaveError] = useState("");
  const [workoutFinishing, setWorkoutFinishing] = useState(false);
  const [approvalReview, setApprovalReview] = useState(null);
  const [approvalQuestion, setApprovalQuestion] = useState("");
  const [approvalMessages, setApprovalMessages] = useState([]);
  const [approvalLoading, setApprovalLoading] = useState(false);
  // A short running summary the fitness coach keeps and updates itself, so it
  // has continuity across sessions/devices rather than only this browser tab.
  const [coachMemory, setCoachMemory] = useState("");
  const saveCoachMemory = async (summary) => {
    setCoachMemory(summary);
    if (!user) return;
    try {
      await supabase.from("coach_memory").upsert({ user_id: user.id, summary, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    } catch (e) { console.log("Coach memory save error:", e); }
  };

  // 1-week programme review: a one-off prompt handed to the fitness coach.
  const [weekReviewPrompt, setWeekReviewPrompt] = useState(null);
  const [weekReviewDismissed, setWeekReviewDismissed] = useState(false);

  // Workout logger state - track sets per exercise independently
  const [activeSession, setActiveSession] = useState(null);
  const [workoutInProgress, setWorkoutInProgress] = useState(false);
  const [exerciseIdx, setExerciseIdx] = useState(0);
  const [setProgress, setSetProgress] = useState({}); // { exerciseIdx: currentSetIdx }
  const [completedSets, setCompletedSets] = useState({}); // { exerciseIdx: [{weight, reps, setNum}] }
  const [currentInputs, setCurrentInputs] = useState({}); // { exerciseIdx: {weight, reps} }
  const [workoutStart, setWorkoutStart] = useState(null);
  const [activeWorkoutLogId, setActiveWorkoutLogId] = useState(null); // row in workout_logs we're autosaving into
  const otherWorkoutsRef = useRef(null);

  // Mini-save plumbing for the active workout. Every write is chained in
  // order so an autosave can never replace or overtake the final save.
  const workoutLogIdRef = useRef(null);
  const workoutSaveChainRef = useRef(Promise.resolve());
  const workoutFinalizedRef = useRef(false);
  const serverSetsRef = useRef(null); // the active workout's sets as last read from or written to the server
  useEffect(() => { workoutLogIdRef.current = activeWorkoutLogId; }, [activeWorkoutLogId]);

  useEffect(() => {
    if (view !== "workout" || !isActive) return;
    document.body.classList.add("t3d-workout-active");
    return () => document.body.classList.remove("t3d-workout-active");
  }, [view, isActive]);

  // A workout is kept on this device, and shown as in progress, once a set
  // is logged; one started and left with nothing logged isn't.
  const fitnessDraft = useMemo(() => (
    workoutInProgress && activeSession && Object.values(completedSets).some(sets => sets?.length) ? {
      activeSession, exerciseIdx, setProgress, completedSets, currentInputs, workoutStart,
      restTimerEnabled, restSeconds, restActive,
      restDeadline, activeWorkoutLogId,
    } : null
  ), [workoutInProgress, activeSession, exerciseIdx, setProgress, completedSets, currentInputs, workoutStart,
    restTimerEnabled, restSeconds, restActive, restDeadline, activeWorkoutLogId]);
  useSessionDraft(user?.id, "fitness", fitnessDraft, async draft => {
    if (!draft.activeSession?.exercises?.length) return;
    if (draft.activeWorkoutLogId) {
      // The server may have already finalized this row (idle past the
      // 2-hour resume window) even though the local draft still thinks
      // it's live - don't reopen a workout that's already been logged.
      const { data: logRow } = await supabase.from("workout_logs")
        .select("in_progress,exercises").eq("id", draft.activeWorkoutLogId).eq("user_id", user.id).maybeSingle();
      if (!logRow || !logRow.in_progress) return;
      // What the server holds, so restoring the same sets writes nothing.
      serverSetsRef.current = loggedSetsSignature(logRow.exercises);
    }
    setActiveSession(draft.activeSession);
    setExerciseIdx(draft.exerciseIdx || 0);
    setSetProgress(draft.setProgress || {});
    setCompletedSets(draft.completedSets || {});
    setCurrentInputs(draft.currentInputs || {});
    setWorkoutStart(draft.workoutStart);
    setActiveWorkoutLogId(draft.activeWorkoutLogId || null);
    workoutLogIdRef.current = draft.activeWorkoutLogId || null;
    setRestTimerEnabled(Boolean(draft.restTimerEnabled));
    setRestSeconds(draft.restSeconds || 90);
    const remaining = Math.max(0, Math.ceil(((draft.restDeadline || 0) - Date.now()) / 1000));
    setRestDeadline(draft.restDeadline || null);
    setRestRemaining(remaining);
    setRestActive(remaining > 0);
    setWorkoutInProgress(true);
    setView("workout");
  }, workoutProgressLine);
  const today = homeDate.dateKey;

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// A plan the user saves (AI-built after review, or built by hand) is approved
// on save, with the same 8-week commitment as approving it later.
function withPlanApproval(sessions, now = new Date()) {
  const reviewDate = new Date(now);
  reviewDate.setDate(reviewDate.getDate() + 56);
  return sessions.map(session => ({
    ...session,
    approval: { approved: true, approvedAt: now.toISOString(), reviewAfter: reviewDate.toISOString().slice(0, 10), commitmentWeeks: 8, cycleDays: 8 },
  }));
}

  const AI_QUESTIONS = [
    { id: "goal", q: "What are we working towards? Pick up to two.", type: "choice", multi: 2, options: ["Build muscle", "Build strength", "Lose fat", "General fitness", "Athletic performance"], custom: true },
    { id: "experience", q: "Where are you starting from?", type: "choice", options: ["New to training", "Training for a few months", "1–3 years of training", "3+ years of training"], custom: true },
    { id: "days_per_week", q: "How many days can you realistically train?", type: "choice", options: ["1 day", "2 days", "3 days", "4 days", "5 days", "6 days", "7 days"] },
    { id: "preferred_days", q: "Which days work best for you?", type: "days" },
    { id: "session_length", q: "How much time do you have for training?", type: "availability" },
    { id: "equipment", q: "What equipment can you use?", type: "choice", options: ["Full gym", "Home gym with weights", "Dumbbells only", "Bodyweight only"], custom: true },
    { id: "split", q: "Do you have a preferred training split?", type: "choice", options: ["Let the coach choose", "Full body", "Upper / lower", "Push / pull / legs"], custom: true },
    { id: "favourites", q: "Which exercises do you enjoy?", type: "text", placeholder: "Exercises you want included — or no preference", skipLabel: "Not sure – let the coach choose" },
    { id: "priorities", q: "What would you like to focus on?", type: "text", placeholder: "Muscle groups, skills or performance goals — or balanced progress" },
    { id: "limitations", q: "Anything the coach should work around?", type: "text", placeholder: "Injuries, movements to avoid, other commitments — or none" },
  ];

  // Answers are strings, except goal (up to two options plus goal_custom) and preferred_days (day codes or FLEXIBLE).
  const aiAnswerText = (question, answers = aiAnswers) => {
    const value = answers[question.id];
    if (question.id === "goal") return [...(Array.isArray(value) ? value : value ? [value] : []), answers.goal_custom].filter(item => String(item || "").trim()).join(" and ");
    if (question.type === "days") return Array.isArray(value) ? (value.includes("FLEXIBLE") ? "Flexible" : value.join(", ")) : String(value || "");
    return String(value || "");
  };
  const aiAskedQuestions = aiQuestionIds ? AI_QUESTIONS.filter(question => aiQuestionIds.includes(question.id)) : AI_QUESTIONS;
  const AI_BUILD_STAGES = ["Reading your answers", "Choosing your training days", "Selecting exercises for your equipment", "Setting sets, reps and tempo", "Checking each session fits your time"];

  useEffect(() => {
    if (!aiBuilding) return;
    const timer = setInterval(() => setAiBuildStage(stage => Math.min(stage + 1, AI_BUILD_STAGES.length - 1)), 6000);
    return () => clearInterval(timer);
  }, [aiBuilding]);

  // The training level every coach uses (coach_profiles.experience_level).
  const saveExperienceLevel = async level => {
    if (!user || !level) return;
    const { error } = await supabase.from("coach_profiles").upsert({ user_id: user.id, experience_level: level, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) console.log("Experience level not saved:", error.message);
  };

  const openAiBuilder = () => {
    setAiStep(0); setAiAnswers({}); setAiPlan(null); setAiPlanError(""); setAiQuestionIds(null); setAiChatContext(""); setAiPrefillNote(""); setView("ai_builder");
  };

  useEffect(() => { if (!user) return; loadData(); }, [user, today]);

  useEffect(() => {
    if (!restActive || !restDeadline) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((restDeadline - Date.now()) / 1000));
      setRestRemaining(remaining);
      if (!remaining) setRestActive(false);
    };
    update();
    const timer = setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [restActive, restDeadline]);

  // Unfinished workouts from earlier days are closed when a new workout is
  // started (never just by opening the app), and only those rows. The
  // workout in progress is never closed here, even when it started before
  // midnight and the date has just rolled over. Until then they are shown
  // as finished (isFinishedWorkout).
  const finalizeStaleWorkouts = async () => {
    if (!user) return;
    try {
      const draft = await readDraft(user.id, "fitness").catch(() => null);
      const keep = activeWorkoutLogIds({ currentId: workoutLogIdRef.current, finalised: workoutFinalizedRef.current, draft });
      const { data: stale } = await supabase.from("workout_logs").select("id,created_at,duration_mins,exercises")
        .eq("user_id", user.id).eq("in_progress", true).lt("date", today);
      const rows = (stale || []).filter(row => !keep.includes(row.id));
      // A workout closed long after its last set keeps the time it really took.
      const corrected = rows.filter(row => settledWorkoutDuration(row) !== (Number(row.duration_mins) || 0));
      const ids = rows.filter(row => !corrected.includes(row)).map(row => row.id);
      if (ids.length) await supabase.from("workout_logs").update({ in_progress: false }).eq("user_id", user.id).in("id", ids);
      for (const row of corrected) await supabase.from("workout_logs").update({ in_progress: false, duration_mins: settledWorkoutDuration(row) }).eq("user_id", user.id).eq("id", row.id);
    } catch (e) { console.log("Stale workout cleanup error:", e); }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: splitData } = await readWorkoutSplit(user.id);
      let normalizedSessions = [];
      if (splitData) {
        normalizedSessions = normalizeFitnessSessions(splitData.sessions || []);
        setSplit({ ...splitData, sessions: normalizedSessions });
        setSessions(normalizedSessions);
      }
      const { data: activeLog } = await supabase.from("workout_logs").select("*")
        .eq("user_id", user.id).eq("date", today).eq("in_progress", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (activeLog) {
        const plannedSession = normalizedSessions.find(session => session.name?.toLowerCase() === activeLog.session_name?.toLowerCase());
        const recovered = recoverWorkoutState(activeLog, plannedSession);
        if (recovered) {
          if (!recovered.activeSession.trainingSessionId) {
            const { data: structuredActive } = await supabase.from("training_sessions").select("id")
              .eq("user_id", user.id).eq("session_name", activeLog.session_name).eq("status", "in_progress")
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (structuredActive?.id) recovered.activeSession.trainingSessionId = structuredActive.id;
          }
          setActiveSession(recovered.activeSession);
          setCompletedSets(recovered.completedSets);
          setSetProgress(recovered.setProgress);
          setExerciseIdx(recovered.exerciseIdx);
          setWorkoutStart(recovered.workoutStart);
          setActiveWorkoutLogId(recovered.workoutLogId);
          workoutLogIdRef.current = recovered.workoutLogId;
          workoutFinalizedRef.current = false;
          serverSetsRef.current = loggedSetsSignature(activeLog.exercises);
          setWorkoutInProgress(true);
        }
      }
      // A generous window so an exercise's history still surfaces ("last time")
      // even after a session gets restructured or an exercise sits unused for a while.
      // Finished workouts, plus unfinished ones from earlier days (shown as
      // finished), except one still being continued on this device.
      const draft = await readDraft(user.id, "fitness").catch(() => null);
      const keep = activeWorkoutLogIds({ currentId: workoutLogIdRef.current, finalised: workoutFinalizedRef.current, draft });
      const { data: logs } = await supabase.from("workout_logs").select("*").eq("user_id", user.id).or(`in_progress.eq.false,date.lt.${today}`).order("created_at", { ascending: false }).limit(250);
      if (logs) setHistory(logs.filter(log => !keep.includes(log.id)).map(log => ({ ...log, in_progress: false, duration_mins: settledWorkoutDuration(log), ai_feedback: log.ai_feedback || log.exercises?.find(exercise => exercise.ai_feedback)?.ai_feedback || "" })));
      // maybeSingle: a new user has no coach memory yet (single() would 406).
      const { data: memoryRow } = await supabase.from("coach_memory").select("summary").eq("user_id", user.id).maybeSingle();
      if (memoryRow?.summary) setCoachMemory(memoryRow.summary);
    } catch (e) { console.log("Load error:", e); }
    setLoading(false);
  };

  // Returns { ok, error }. Callers must not report a change unless ok is true.
  const saveSplit = async (sessionsData, extra = {}) => {
    if (!user) return { ok: false, error: "not signed in" };
    try {
      const normalizedSessions = normalizeFitnessSessions(sessionsData);
      const { data: existing } = await supabase.from("workout_splits").select("id").eq("user_id", user.id).maybeSingle();

      // Upsert so a stale lookup can never turn a save into a duplicate insert.
      // Read the row back so a save only counts once the database has it.
      const result = await supabase.from("workout_splits").upsert({
        user_id: user.id,
        sessions: normalizedSessions,
        ...(existing ? {} : { split_name: "My Split" }),
        ...extra,
      }, { onConflict: "user_id" }).select("sessions").single();

      if (result.error || !sameJson(result.data?.sessions, normalizedSessions)) {
        console.error("saveSplit error:", result.error || "saved plan did not match");
        return { ok: false, error: result.error?.message || "the saved plan could not be confirmed" };
      }
      setSessions(normalizedSessions);
      setSplit(previous => ({ ...(previous || {}), sessions: normalizedSessions, ...extra }));
      return { ok: true };
    } catch (e) {
      console.error("saveSplit exception:", e);
      return { ok: false, error: e?.message || "connection problem" };
    }
  };

  const buildWorkoutLogPayload = (setsToSave, session = activeSession) => {
    // A workout belongs to the day it started, even if it runs past midnight.
    const dateStr = getZonedDateInfo(new Date(workoutStart || Date.now()), homeTimeZone).dateKey;
    const exerciseData = buildLoggedExercises(session, setsToSave);
    const totalVol = workoutVolume(exerciseData);
    return {
      user_id: user.id, date: dateStr, session_name: session?.name || "Workout",
      exercises: exerciseData, total_volume: totalVol,
      duration_mins: workoutDurationMins({ startedAt: workoutStart, exercises: exerciseData }),
    };
  };

  // Writes the workout's current sets to Supabase right away. Calls are
  // strictly serialized: the final write always runs after every autosave
  // and callers can await the actual database result. session: the workout
  // as just changed, before the next render has it in activeSession.
  const persistWorkoutLog = (setsToSave, { finalize = false, session = activeSession } = {}) => {
    if (!user || !session) return Promise.resolve(null);
    const setsSnapshot = structuredClone(setsToSave || {});
    const sessionSnapshot = structuredClone(session);
    const perform = async () => {
      if (workoutFinalizedRef.current && !finalize) return null;
      const payload = buildWorkoutLogPayload(setsSnapshot, sessionSnapshot);
      if (workoutLogIdRef.current) {
        const { error } = await supabase.from("workout_logs")
          .update({ ...payload, in_progress: !finalize })
          .eq("id", workoutLogIdRef.current).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("workout_logs")
          .insert({ ...payload, in_progress: !finalize, created_at: new Date(workoutStart || Date.now()).toISOString() })
          .select("id").single();
        if (error) throw error;
        workoutLogIdRef.current = data.id;
        setActiveWorkoutLogId(data.id);
      }
      if (finalize) workoutFinalizedRef.current = true;
      serverSetsRef.current = loggedSetsSignature(payload.exercises);
      setWorkoutSaveError("");
      return { id: workoutLogIdRef.current, payload };
    };
    const queued = workoutSaveChainRef.current.then(perform);
    workoutSaveChainRef.current = queued.catch(() => null);
    return queued.catch(error => {
      console.error("Workout save error:", error.message);
      setWorkoutSaveError("Your workout could not be saved to the server. Keep this page open and try again.");
      throw error;
    });
  };

  const saveWorkoutLog = async (setsToSave = completedSets) => {
    const saved = await persistWorkoutLog(setsToSave, { finalize: true });
    try {
      await saveStructuredWorkout({
        userId: user.id,
        activeSession,
        completedSets: setsToSave,
        startedAt: workoutStart,
        legacyWorkoutLogId: String(workoutLogIdRef.current || "") || null,
      });
    } catch (error) {
      // The V1.2 migration can be deployed independently; legacy workout saving remains authoritative until then.
      console.warn("Structured workout history was not saved:", error.message);
    }
    return saved;
  };

  // Autosave every time a set is confirmed or an already-logged set is
  // edited. Sets restored on load already match the server, so restoring
  // writes nothing.
  useEffect(() => {
    if (!workoutInProgress || !activeSession) return;
    if (!Object.values(completedSets).some(sets => sets?.length)) return;
    if (loggedSetsSignature(buildLoggedExercises(activeSession, completedSets)) === serverSetsRef.current) return;
    persistWorkoutLog(completedSets).catch(() => {});
  }, [completedSets, workoutInProgress, activeSession]);

  // Get last session's data for a specific exercise
  const getLastSessionData = (exercise, logs = history) => {
    const currentContext = activeSession?.gymContext || { type: "usual", name: "" };
    if (currentContext.type === "away") return null;
    for (const log of logs) {
      const ex = log.exercises?.find(item => exerciseMatchesHistory(exercise, item.name));
      const savedContext = ex?.context || { type: "usual", name: "" };
      const sameContext = currentContext.type === "usual"
        ? savedContext.type === "usual"
        : savedContext.type === "different" && savedContext.name?.toLowerCase() === currentContext.name?.toLowerCase();
      if (ex?.sets?.length && sameContext) return ex.sets;
    }
    return null;
  };

  const getExerciseHistory = exercise => history.flatMap(log => {
    const historicalExercise = log.exercises?.find(item => exerciseMatchesHistory(exercise, item.name));
    return historicalExercise ? [{ ...historicalExercise, date: log.date }] : [];
  });

  const getProgressionRecommendation = exercise => {
    const exposures = getExerciseHistory(exercise);
    const lastExposure = exposures[0];
    if (!lastExposure?.sets?.length) return null;
    const currentWeight = Number(lastExposure.sets[0]?.weight) || 0;
    const equipmentHistory = exposures.flatMap(item => item.sets || []).map(set => Number(set.weight)).filter(Number.isFinite);
    // Each set is judged against its own range (6-8, 6-8, 8-10, 6).
    const repRanges = repTargets(exercise.reps, Math.max(Number(exercise.sets) || 0, lastExposure.sets.length));
    return evaluateProgression({
      prescriptionType: exercise.prescription_type || "straight_sets",
      sets: lastExposure.sets,
      repRange: repRanges[0],
      repRanges,
      currentWeight,
      equipmentHistory,
      week: exercise.week || 2,
      previousExposure: exercise.previous_progression,
      repeatedOvershoot: Boolean(exercise.repeated_overshoot),
      restAppropriate: Boolean(exercise.rest_checked),
      executionAppropriate: Boolean(exercise.execution_checked),
      consecutiveStalledExposures: Number(exercise.stalled_exposures || 0),
      pain: Boolean(exercise.active_pain),
    });
  };

  // All logged occurrences of an exercise, oldest first, for the progression graph
  const getExerciseProgression = (exercise) => {
    return history
      .map(log => {
        const ex = log.exercises?.find(item => exerciseMatchesHistory(exercise, item.name));
        return ex ? { date: log.date, sets: ex.sets || [] } : null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  const fitSessionToMinutes = (session, minuteLimit) => {
    const adjusted = JSON.parse(JSON.stringify(session));
    if (!(minuteLimit > 0) || !adjusted.exercises?.length) return adjusted;
    const originalExercises = adjusted.exercises.length;
    const originalSets = adjusted.exercises.reduce((total, exercise) => total + (Number(exercise.sets) || 0), 0);
    const estimatedMinutes = 5 + originalSets * 3;
    if (minuteLimit >= estimatedMinutes) return adjusted;
    const exerciseLimit = Math.max(1, Math.min(originalExercises, Math.floor(Math.max(minuteLimit - 2, 3) / 5)));
    const selected = adjusted.exercises.slice(0, exerciseLimit);
    const setBudget = Math.max(exerciseLimit, Math.floor(Math.max(minuteLimit - 2, 3) / 3));
    const setCounts = selected.map(() => 1);
    let remaining = setBudget - exerciseLimit;
    while (remaining > 0) {
      let added = false;
      selected.forEach((exercise, index) => {
        if (remaining > 0 && setCounts[index] < (Number(exercise.sets) || 1)) {
          setCounts[index] += 1;
          remaining -= 1;
          added = true;
        }
      });
      if (!added) break;
    }
    adjusted.exercises = selected.map((exercise, index) => ({
      ...exercise,
      sets: setCounts[index],
      reps: Array.isArray(exercise.reps) ? exercise.reps.slice(0, setCounts[index]) : exercise.reps,
    }));
    const adjustedSets = setCounts.reduce((total, value) => total + value, 0);
    adjusted.sessionAdjustment = `Optimised for ${minuteLimit} minutes · ${adjusted.exercises.length} exercise${adjusted.exercises.length === 1 ? "" : "s"} · ${adjustedSets} set${adjustedSets === 1 ? "" : "s"} (full session: ${originalExercises} exercises · ${originalSets} sets)`;
    return adjusted;
  };

  const startWorkout = async (session, options = { minutes: availableMinutes, context: gymContext, name: gymName }) => {
    await finalizeStaleWorkouts();
    const minuteLimit = parseInt(options.minutes, 10);
    const sessionToStart = fitSessionToMinutes(normalizeFitnessSessions([session])[0], minuteLimit);
    sessionToStart.gymContext = { type: options.context, name: String(options.name || "").trim() };
    const startedAt = Date.now();
    if (workoutLogIdRef.current && workoutInProgress) {
      await supabase.from("workout_logs").update({ in_progress: false }).eq("id", workoutLogIdRef.current).eq("user_id", user.id);
    } else if (workoutInProgress) dropEmptyTrainingSession();
    try {
      const { data } = await supabase.from("training_sessions").insert({
        user_id: user.id,
        session_key: exerciseKey(sessionToStart.name || "workout"),
        session_name: sessionToStart.name || "Workout",
        started_at: new Date().toISOString(),
        status: "in_progress",
        temporary_context: {},
      }).select("id").single();
      if (data?.id) sessionToStart.trainingSessionId = data.id;
    } catch { /* The legacy workout remains usable until the V1.2 migration is installed. */ }
    // Nothing is saved as a workout until its first set is logged (the
    // autosave creates the row then), so a workout started by mistake, or
    // just to look at, leaves nothing behind.
    setActiveSession(sessionToStart);
    setWorkoutInProgress(true);
    setExerciseIdx(0);
    setSetProgress({});
    setCompletedSets({});
    setCurrentInputs({});
    setWorkoutStart(startedAt);
    setActiveWorkoutLogId(null);
    workoutLogIdRef.current = null;
    workoutSaveChainRef.current = Promise.resolve();
    workoutFinalizedRef.current = false;
    setWorkoutSaveError("");
    setWorkoutFinishing(false);
    setCompletionFeedback("");
    setCompletionFollowUps([]);
    setCompletionQuestion("");
    setPendingSession(null);
    setView("workout");
  };

  const openActivityLog = (prefill = {}) => {
    setActivityError("");
    setActivityNotice("");
    setPlanNotice("");
    setActivityForm({ type: prefill.type || "run", name: prefill.name || "", minutes: prefill.minutes ? String(prefill.minutes) : "", effort: "moderate", distanceKm: "", notes: "" });
  };
  const saveActivityLog = async () => {
    if (!user || !activityForm || activitySaving) return;
    if (!(Number(activityForm.minutes) >= 2)) { setActivityError("Enter how many minutes it took (2 or more)."); return; }
    setActivitySaving(true);
    setActivityError("");
    // A distance only applies to activities that have one (not HYROX, say).
    const hasDistance = ACTIVITY_TYPES.find(type => type.id === activityForm.type)?.distance;
    // created_at as for a gym workout, so history lists it in order.
    const row = { ...activityLogRow({ userId: user.id, date: today, ...activityForm, distanceKm: hasDistance ? activityForm.distanceKm : null }), created_at: new Date().toISOString() };
    const { data, error } = await supabase.from("workout_logs").insert(row).select("*").single();
    setActivitySaving(false);
    if (error) { setActivityError(`It wasn't saved: ${error.message}. Please try again.`); return; }
    setHistory(current => [{ ...row, ...(data || {}) }, ...current]);
    setActivityForm(null);
    setActivityNotice(`${row.session_name} logged · ${activitySummary(row)}`);
  };
  const savePlanActivity = async () => {
    if (!planActivityForm?.days?.length) return;
    const planned = activitySession(planActivityForm);
    const saved = await saveSplit([...sessions, planned]);
    if (!saved.ok) { setPlanSaveError(`The activity wasn't added to your plan: ${saved.error}. Please try again.`); return; }
    setPlanSaveError("");
    setPlanActivityForm(null);
    // Say what was added; an older "logged" message is no longer current.
    setActivityNotice("");
    const dayNames = planned.days.map(day => day.charAt(0) + day.slice(1).toLowerCase()).join(", ");
    setPlanNotice(`${planned.name} added to your plan on ${dayNames} · ${planned.duration_mins} min`);
  };

  // Start straight away with the full session at the usual gym; the
  // time/gym options are behind a small link (openWorkoutOptions).
  // Sets logged so far in the workout in progress.
  const inProgressSetCount = workoutInProgress && activeSession ? Object.values(completedSets).reduce((total, sets) => total + (sets?.length || 0), 0) : 0;
  // Starting a workout finishes the one in progress, so with sets logged it
  // asks first (switchWorkout holds the session and options to start).
  const startOrConfirm = (session, options) => {
    if (inProgressSetCount > 0) { setPendingSession(null); setSwitchWorkout({ session, options }); return; }
    startWorkout(session, options);
  };
  const switchVerb = switchWorkout && activeSession && switchWorkout.session.name === activeSession.name ? "RESTART" : "START";
  const requestStartWorkout = session => {
    // An activity in the plan is logged, not started like a gym session.
    if (isActivitySession(session)) { openActivityLog({ type: session.activityType, name: session.name, minutes: session.duration_mins }); return; }
    setAvailableMinutes("");
    setGymContext("usual");
    setGymName("");
    startOrConfirm(session, { minutes: "", context: "usual", name: "" });
  };
  // "Next up" on the dashboard: continue or start today's workout in one tap.
  // A tap made while this tab is still loading runs once it has loaded, so
  // an unfinished workout is continued rather than a new one started.
  const startTodayRef = useRef(null);
  const pendingWorkoutStartRef = useRef(false);
  useEffect(() => {
    startTodayRef.current = () => {
      if (loading) { pendingWorkoutStartRef.current = true; return; }
      if (workoutInProgress && activeSession) { setView("workout"); return; }
      const session = sessionForDay(sessions, homeDate.dayCode);
      if (session) requestStartWorkout(session);
    };
  });
  useEffect(() => {
    if (loading || !pendingWorkoutStartRef.current) return;
    pendingWorkoutStartRef.current = false;
    startTodayRef.current?.();
  }, [loading]);
  useEffect(() => {
    const start = event => { if (event.detail?.kind === "workout") startTodayRef.current?.(); };
    window.addEventListener("track3d-start", start);
    return () => window.removeEventListener("track3d-start", start);
  }, []);
  const openWorkoutOptions = session => {
    setPendingSession(session);
    setAvailableMinutes("");
    setGymContext("usual");
    setGymName("");
  };

  // A started workout's structured session, removed when nothing was logged.
  const dropEmptyTrainingSession = () => {
    if (!activeSession?.trainingSessionId || inProgressSetCount > 0) return;
    supabase.from("training_sessions").delete().eq("id", activeSession.trainingSessionId).eq("user_id", user.id)
      .then(({ error }) => { if (error) console.log("Empty workout cleanup error:", error); });
  };
  // Back to Fitness: a workout with nothing logged isn't kept as active.
  const leaveWorkout = () => {
    if (inProgressSetCount === 0) { discardActiveWorkout(); return; }
    setView("home");
  };
  const discardActiveWorkout = () => {
    // Remove the autosaved row too, so a discarded session doesn't resurface
    // in history once the 2-hour stale-workout cleanup finalizes it.
    if (workoutLogIdRef.current) {
      supabase.from("workout_logs").delete().eq("id", workoutLogIdRef.current).eq("user_id", user.id)
        .then(({ error }) => { if (error) console.log("Discard cleanup error:", error); });
    }
    if (activeSession?.trainingSessionId) {
      supabase.from("training_sessions").delete().eq("id", activeSession.trainingSessionId).eq("user_id", user.id)
        .then(({ error }) => { if (error) console.log("Structured discard cleanup error:", error); });
    }
    workoutLogIdRef.current = null;
    workoutFinalizedRef.current = true;
    setActiveWorkoutLogId(null);
    setWorkoutInProgress(false);
    setActiveSession(null);
    setExerciseIdx(0);
    setSetProgress({});
    setCompletedSets({});
    setCurrentInputs({});
    setWorkoutStart(null);
    setRestActive(false);
    setRestDeadline(null);
    setDiscardWorkoutWarning(false);
    setView("home");
  };

  const openOtherWorkouts = () => {
    setShowOtherWorkouts(true);
    requestAnimationFrame(() => otherWorkoutsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const approveProgramme = async (sessionIndex = null) => {
    const now = new Date();
    const reviewDate = new Date(now);
    reviewDate.setDate(reviewDate.getDate() + 56);
    const updated = sessions.map((session, index) => sessionIndex === null || index === sessionIndex ? {
      ...session,
      approval: { approved: true, approvedAt: now.toISOString(), reviewAfter: reviewDate.toISOString().slice(0, 10), commitmentWeeks: 8, cycleDays: 8 },
    } : session);
    // The first approval of any session in a split starts its 1-week review
    // clock; re-approving later (editing an existing, already-running plan)
    // doesn't reset it.
    const extra = !split?.programme_started_at ? { programme_started_at: now.toISOString(), week_reviewed_at: null } : {};
    // saveSplit updates the screen only once the database confirms the save.
    const saved = await saveSplit(updated, extra);
    setPlanSaveError(saved.ok ? "" : `Approval not saved: ${saved.error}. Your plan has not changed.`);
    return saved.ok;
  };

  const persistCompletionFeedback = async feedback => {
    const logId = workoutLogIdRef.current;
    if (!logId || !feedback) return;
    const { error } = await supabase.from("workout_logs").update({ ai_feedback: feedback }).eq("id", logId).eq("user_id", user.id);
    if (error) {
      // Compatibility while the additive ai_feedback migration is rolling out:
      // keep the feedback inside the JSON workout record instead of losing it.
      const payload = buildWorkoutLogPayload(completedSets);
      const exercises = payload.exercises.map((exercise, index) => index === 0 ? { ...exercise, ai_feedback: feedback } : exercise);
      const { error: fallbackError } = await supabase.from("workout_logs").update({ exercises }).eq("id", logId).eq("user_id", user.id);
      if (fallbackError) throw fallbackError;
    }
    setHistory(current => current.map(log => log.id === logId ? { ...log, ai_feedback: feedback } : log));
  };

  // What the coach reviews after a workout: this session, the last time it
  // was done, how the week is going and what's next, so it can talk about
  // the session and the next one rather than read the sets back.
  const completionFeedbackReview = () => {
    const review = buildWorkoutReview(activeSession, completedSets);
    const finishedId = workoutLogIdRef.current;
    const sameName = name => log => log.id !== finishedId && String(log.session_name || "").toLowerCase() === String(name || "").toLowerCase();
    const sameSession = history.filter(sameName(activeSession?.name));
    let next = null;
    for (let ahead = 1; ahead <= 7 && !next; ahead += 1) {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + ahead);
      const session = sessionForDay(sessions, ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getUTCDay()]);
      if (session) next = { session, when: ahead === 1 ? "tomorrow" : date.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long" }) };
    }
    const week = weeklyWorkoutProgress(history.filter(log => log.id !== finishedId), today, sessions, finishedId, { countCurrent: review.completedSets > 0 });
    const nextText = next
      ? `${next.session.name}${isActivitySession(next.session) ? " (an activity, not a gym session)" : ""}, ${next.when}${next.session.exercises?.length ? `: ${next.session.exercises.map(exercise => exercise.name).join(", ")}` : ""}`
      : "none scheduled in the next 7 days";
    const nextLastTime = next && !isActivitySession(next.session) ? recentWorkoutsForCoach(history.filter(sameName(next.session.name)), { perSession: 3, maxSessions: 1 }) : "";
    return [
      `WORKOUT REVIEW\n${JSON.stringify({ ...review, durationMinutes: Math.round((Date.now() - workoutStart) / 60000) })}`,
      `PREVIOUS SAME SESSION\n${recentWorkoutsForCoach(sameSession, { perSession: 3, maxSessions: 1 })}`,
      `WEEK SO FAR\n${week.planned ? `${week.completed} of ${week.planned} planned sessions done, including this one` : `${week.completed} sessions done`}`,
      `NEXT SESSION\n${nextText}`,
      ...(nextLastTime ? [`NEXT SESSION LAST TIME\n${nextLastTime}`] : []),
    ].join("\n\n");
  };

  const askCompletionFollowUp = async () => {
    const question = completionQuestion.trim();
    if (!question || completionReplyLoading || !completionFeedback) return;
    // Close the phone keyboard so the screen returns to its normal size.
    document.activeElement?.blur?.();
    const updated = [...completionFollowUps, { role: "user", content: question }];
    setCompletionFollowUps(updated);
    setCompletionQuestion("");
    setCompletionReplyLoading(true);
    try {
      const reply = await streamCoachText({
        area: "workout_review",
        messages: [{ role: "user", content: completionFeedbackReview() }, { role: "assistant", content: completionFeedback }, ...updated],
      }, text => setCompletionFollowUps([...updated, { role: "assistant", content: text }]));
      setCompletionFollowUps([...updated, { role: "assistant", content: reply }]);
    } catch {
      setCompletionFollowUps([...updated, { role: "assistant", content: "I couldn't connect just now. Please try again." }]);
    }
    setCompletionReplyLoading(false);
  };

  const getCompletionFeedback = async () => {
    if (completionFeedbackLoading || completionFeedback) return;
    setCompletionFeedbackLoading(true);
    try {
      const feedback = await streamCoachText({
        area: "workout_review",
        messages: [{ role: "user", content: completionFeedbackReview() }],
      }, text => setCompletionFeedback(text));
      setCompletionFeedback(feedback);
      await persistCompletionFeedback(feedback);
    } catch (error) {
      console.error("Workout feedback error:", error.message);
      setCompletionFeedback("");
      setWorkoutSaveError("Your workout is saved, but Coach feedback is temporarily unavailable. You can retry below.");
    }
    setCompletionFeedbackLoading(false);
  };

  useEffect(() => {
    if (view !== "complete" || !activeSession || completionFeedback || completionFeedbackLoading) return;
    getCompletionFeedback();
    // Completion view is the single trigger; state guards prevent duplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Badges this workout unlocked, shown on the complete screen. The workout is
  // saved before the view changes, so it is in the history read here.
  const [completeBadges, setCompleteBadges] = useState([]);
  useEffect(() => {
    if (view !== "complete" || !user) { setCompleteBadges([]); return; }
    let cancelled = false;
    fetchAchievements(user).then(list => {
      if (cancelled) return;
      const seen = readSeenBadges(user.id);
      const fresh = list.filter(badge => badge.earned && badge.earnedOn === today && !(seen || []).includes(badge.id));
      setCompleteBadges(fresh);
      // The first time badges are seen on this device, the earlier ones are
      // marked too, so the dashboard doesn't announce them one by one.
      markBadgesSeen(user.id, (seen === null ? list.filter(badge => badge.earned) : fresh).map(badge => badge.id));
    }).catch(() => { /* badges are a bonus: the summary works without them */ });
    return () => { cancelled = true; };
  }, [view, user, today]);

  const finishWorkout = async (setsToSave = completedSets) => {
    if (workoutFinishing) return;
    setWorkoutFinishing(true);
    setWorkoutSaveError("");
    try {
      await saveWorkoutLog(setsToSave);
      setWorkoutInProgress(false);
      setRestActive(false);
      setRestDeadline(null);
      setView("complete");
    } catch {
      // persistWorkoutLog supplies the actionable message and leaves the
      // active workout open so the user can retry without losing anything.
    } finally {
      setWorkoutFinishing(false);
    }
  };

  const getCurrentSetIdx = (eIdx) => setProgress[eIdx] || 0;
  const getCompletedForExercise = (eIdx) => completedSets[eIdx] || [];

  const deleteActiveSet = (exerciseIndex, setIndex) => {
    const remaining = (completedSets[exerciseIndex] || []).filter((_, index) => index !== setIndex).map((set, index) => ({ ...set, setNum: index + 1 }));
    const updated = { ...completedSets, [exerciseIndex]: remaining };
    setCompletedSets(updated);
    setSetProgress(progress => ({ ...progress, [exerciseIndex]: remaining.length }));
    persistWorkoutLog(updated).catch(() => {});
    setEditingSet(null);
  };

  // The set logger's suggestion for an exercise's current set: the weight,
  // the reps to aim for and why (setLoggerSuggestion), from last time here.
  const suggestionFor = (eIdx, chosenWeight = null) => {
    const exercise = activeSession?.exercises?.[eIdx];
    if (!exercise) return { weight: "", reps: "", note: "" };
    const setIndex = getCurrentSetIdx(eIdx);
    const lastSets = getLastSessionData(exercise) || [];
    const equipmentHistory = getExerciseHistory(exercise).flatMap(item => item.sets || []).map(set => Number(set.weight)).filter(Number.isFinite);
    const { increment, largeRelativeJump } = inferIncrement({ currentWeight: Number((lastSets[setIndex] || lastSets.at(-1))?.weight) || 0, equipmentHistory });
    return setLoggerSuggestion({ ranges: repTargets(exercise.reps, Number(exercise.sets) || 0), setIndex, lastSets, todaySets: completedSets[eIdx] || [], increment, bigStep: largeRelativeJump, chosenWeight });
  };
  // The reps and weight in the set logger: what the user typed, else the
  // suggestion (shown faintly, and logged as it is). prefilled says which are
  // still the suggestion; a box emptied again goes back to it.
  const setInputsFor = eIdx => {
    const typed = currentInputs[eIdx] || {};
    const typedWeight = typed.weight === "" ? undefined : typed.weight;
    const typedReps = typed.reps === "" ? undefined : typed.reps;
    // A typed weight changes the reps to aim for.
    const suggestion = suggestionFor(eIdx, typedWeight ?? null);
    return { weight: typedWeight ?? suggestion.weight, reps: typedReps ?? suggestion.reps, prefilled: { weight: typedWeight === undefined, reps: typedReps === undefined }, note: suggestion.note };
  };
  const stepSetInput = (field, delta) => {
    const current = setInputsFor(exerciseIdx);
    setCurrentInputs(prev => ({ ...prev, [exerciseIdx]: { ...prev[exerciseIdx], [field]: stepSetValue(current[field], delta) } }));
  };

  const confirmSet = () => {
    const eIdx = exerciseIdx;
    const sIdx = getCurrentSetIdx(eIdx);
    const { weight, reps } = setInputsFor(eIdx);
    if (!weight || !reps) return;

    const priorSets = getExerciseHistory(activeSession.exercises[eIdx]).flatMap(exposure => exposure.sets || []);
    const personalBest = detectPersonalBest({ weight, reps }, priorSets);
    const progressionDecision = getProgressionRecommendation(activeSession.exercises[eIdx]);
    // The time it was logged, so a workout left open ends at its last set.
    const newSet = { weight, reps, setNum: sIdx + 1, personalBest, progressionDecision, at: new Date().toISOString() };
    const newCompleted = { ...completedSets, [eIdx]: [...(completedSets[eIdx] || []), newSet] };
    setCompletedSets(newCompleted);
    // The next set starts from this weight and its own target reps.
    setCurrentInputs(prev => ({ ...prev, [eIdx]: {} }));

    const totalSets = activeSession.exercises[eIdx]?.sets || 0;

    if (restTimerEnabled) { setRestDeadline(Date.now() + restSeconds * 1000); setRestRemaining(restSeconds); setRestActive(true); }

    if (sIdx + 1 < totalSets) {
      setSetProgress(prev => ({ ...prev, [eIdx]: sIdx + 1 }));
    } else {
      // All sets done for this exercise — auto move to next
      const nextIdx = eIdx + 1;
      if (nextIdx < activeSession.exercises.length) {
        setExerciseIdx(nextIdx);
      } else {
        // Workout complete
        finishWorkout(newCompleted);
      }
    }
  };

  const buildAIPlan = async (answers = aiAnswers, chatContext = aiChatContext) => {
    if (aiBuilding) return;
    const experienceQuestion = AI_QUESTIONS.find(question => question.id === "experience");
    const builderLevel = experienceQuestion ? normaliseExperience(aiAnswerText(experienceQuestion, answers)) : null;
    if (builderLevel) saveExperienceLevel(builderLevel);
    setAiPlanError("");
    setAiBuildStage(0);
    setAiBuilding(true);
    const context = AI_QUESTIONS.map(question => `${question.q}: ${aiAnswerText(question, answers) || "not answered"}`).join("\n")
      + (chatContext ? `\n\nEarlier conversation with the coach (respect anything relevant, such as injuries or preferences):\n${chatContext}` : "");
    const budgetText = String(answers.session_length || "");
    const budgetFor = session => requestedBudget(budgetText, session.days || []);
    const validProgramme = parsed => Array.isArray(parsed?.sessions) && parsed.sessions.length > 0 &&
      parsed.sessions.length === parseInt(answers.days_per_week, 10) &&
      !parsed.sessions.some(session => !session.name || !Array.isArray(session.days) ||
        session.days.some(day => !DAYS.includes(day)) ||
        !Array.isArray(session.exercises) || !session.exercises.length ||
        session.exercises.some(exercise => !exercise.name || !Number.isInteger(exercise.sets) ||
          exercise.sets < 1 || exercise.sets > 10 || !Array.isArray(exercise.reps) ||
          exercise.reps.length !== exercise.sets || exercise.reps.some(rep => typeof rep !== "string" || !rep.trim()) ||
          typeof exercise.tempo !== "string" || !/^[0-9Xx]+-[0-9]+-[0-9Xx]+-[0-9]+$/.test(exercise.tempo)));
    const builderContext = `Home timezone: ${homeTimeZone}. Authoritative local day: ${homeDate.weekday}, ${homeDate.dateKey}.`;
    try {
      // Up to two attempts: retry once if the reply cannot be read as a
      // complete programme, or if a session runs over the stated time.
      const messages = [{ role: "user", content: `Build me a training programme:\n${context}` }];
      let plan = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("/api/chat", {
          method: "POST", headers: await chatHeaders(),
          body: JSON.stringify({ responseTokens: 6000, area: "programme_builder", context: builderContext, messages }),
        });
        if (!res.ok) throw new Error("Could not build programme");
        const data = await res.json();
        const text = data.content?.map(b => b.text || "").join("") || "";
        let parsed = null;
        try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { parsed = null; }
        if (!validProgramme(parsed)) {
          messages.push({ role: "assistant", content: text || "(empty reply)" }, { role: "user", content: `Your reply could not be used: it must be one complete, valid JSON object matching the schema, with exactly ${parseInt(answers.days_per_week, 10)} sessions and one rep range per set. Return the whole programme again as JSON only.` });
          continue;
        }
        plan = parsed;
        const overruns = parsed.sessions
          .map(session => ({ session, budget: budgetFor(session), minutes: estimateSession(session).minutes }))
          .filter(item => item.budget && item.minutes > item.budget);
        if (!overruns.length) break;
        messages.push({ role: "assistant", content: text }, { role: "user", content: `These sessions run over my time limit by the app's timing: ${overruns.map(item => `${item.session.name} ${item.minutes} min (limit ${item.budget})`).join("; ")}. Return the whole programme again as JSON only, with every session within its limit.` });
      }
      if (!plan) throw new Error("Incomplete programme");
      // Whatever the model returned, never show a session longer than the stated limit.
      setAiPlan({ ...plan, sessions: plan.sessions.map(session => fitSessionToBudget(session, budgetFor(session))) });
    } catch { setAiPlanError("The coach could not finish your programme. Your answers are saved here — please try again."); }
    setAiBuilding(false);
  };

  if (loading) return (
    <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 11, color: "#E0EAF0", letterSpacing: 2 }}>LOADING FITNESS DATA...</div>
    </div></div>
  );

  // Returns { ok, message } describing what really happened. A permanent
  // change only reports success once saveSplit has confirmed it.
  const applyWorkoutCoachAction = async (action, permanent) => {
    const notSaved = error => ({ ok: false, message: `Not saved: ${error}. Your plan has not changed.` });
    // Logging a set is a direct, immediate edit to the active workout only -
    // there's no "future sessions" version of a set that already happened.
    if (action.type === "log_set") {
      const match = String(action.value || "").match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
      if (!match || !activeSession) return { ok: false, message: "Nothing was logged: the set could not be read." };
      const [, reps, weight] = match;
      const eIdx = activeSession.exercises.findIndex(exercise => exercise.name.toLowerCase() === action.exercise.toLowerCase());
      if (eIdx === -1) return { ok: false, message: `Nothing was logged: ${action.exercise} is not in this workout.` };
      const sIdx = getCurrentSetIdx(eIdx);
      const totalSets = activeSession.exercises[eIdx]?.sets || 0;
      const newSet = { weight, reps, setNum: sIdx + 1 };
      setCompletedSets(previous => ({ ...previous, [eIdx]: [...(previous[eIdx] || []), newSet] }));
      if (sIdx + 1 < totalSets) setSetProgress(previous => ({ ...previous, [eIdx]: sIdx + 1 }));
      return { ok: true, message: "Set logged." };
    }
    // A whole session rewrite (restructuring the day, swapping several
    // exercises at once) arrives as JSON rather than a single exercise tweak.
    if (action.type === "replace_session") {
      const payload = action.payload || {};
      const targetName = payload.sessionName || activeSession?.name;
      if (!targetName || !Array.isArray(payload.exercises) || !payload.exercises.length) return { ok: false, message: "Nothing was changed: the coach's session could not be read." };
      const [normalized] = normalizeFitnessSessions([{ name: targetName, exercises: payload.exercises }]);
      if (permanent) {
        const exists = sessions.some(session => session.name.toLowerCase() === targetName.toLowerCase());
        const updated = exists
          ? sessions.map(session => session.name.toLowerCase() === targetName.toLowerCase() ? { ...session, exercises: normalized.exercises } : session)
          : [...sessions, { name: targetName, exercises: normalized.exercises }];
        const saved = await saveSplit(updated);
        if (!saved.ok) return notSaved(saved.error);
      }
      if (activeSession && activeSession.name.toLowerCase() === targetName.toLowerCase()) {
        setActiveSession(previous => previous ? { ...previous, exercises: normalized.exercises } : previous);
      }
      return { ok: true, message: permanent ? `Saved: ${targetName} is updated in your plan.` : "Applied to this workout only." };
    }
    const changeSession = session => {
      if (!session) return session;
      const target = action.exercise.toLowerCase();
      let exercises = session.exercises || [];
      if (action.type === "remove_exercise") exercises = exercises.filter(exercise => exercise.name.toLowerCase() !== target);
      if (action.type === "rename_exercise") exercises = exercises.map(exercise => exercise.name.toLowerCase() === target ? { ...exercise, name: action.value || exercise.name } : exercise);
      if (action.type === "remove_sets") exercises = exercises.map(exercise => {
        if (exercise.name.toLowerCase() !== target) return exercise;
        const sets = Math.max(1, (Number(exercise.sets) || 1) - Math.max(1, Number(action.value) || 1));
        return { ...exercise, sets, reps: Array.isArray(exercise.reps) ? exercise.reps.slice(0, sets) : exercise.reps };
      });
      if (action.type === "add_sets") exercises = exercises.map(exercise => {
        if (exercise.name.toLowerCase() !== target) return exercise;
        const sets = Math.min(10, (Number(exercise.sets) || 1) + Math.max(1, Number(action.value) || 1));
        const reps = Array.isArray(exercise.reps)
          ? [...exercise.reps, ...Array(Math.max(0, sets - exercise.reps.length)).fill(exercise.reps.at(-1) || "8-12")]
          : exercise.reps;
        return { ...exercise, sets, reps };
      });
      return { ...session, exercises };
    };
    if (!activeSession) return { ok: false, message: "Nothing was changed: no workout is open." };
    const changedWorkout = changeSession(activeSession);
    if (JSON.stringify(changedWorkout.exercises) === JSON.stringify(activeSession.exercises)) {
      return { ok: false, message: `Nothing was changed: ${action.exercise} is not in this workout.` };
    }
    if (permanent) {
      const updated = sessions.map(session => session.name === activeSession.name ? changeSession(session) : session);
      if (JSON.stringify(updated) === JSON.stringify(sessions)) return { ok: false, message: `Nothing was changed: ${action.exercise} is not in ${activeSession.name} in your saved plan.` };
      const saved = await saveSplit(updated);
      if (!saved.ok) return notSaved(saved.error);
    }
    setActiveSession(changedWorkout);
    return { ok: true, message: permanent ? "Saved to your plan and applied to this workout." : "Applied to this workout only." };
  };

  // Structured active-workout state (exercise -> set -> weight/reps/done),
  // rebuilt fresh every render, so the coach reads exact current numbers
  // instead of inferring them from what was said earlier in the chat -
  // which may have been about a different exercise by now.
  const structuredWorkoutState = view === "workout" && activeSession ? activeSession.exercises.map((ex, idx) => ({
    exercise: ex.name,
    isCurrentExercise: idx === exerciseIdx,
    targetSets: Number(ex.sets) || 0,
    repRangeTarget: ex.reps,
    loggedSets: (completedSets[idx] || []).map((s, i) => ({ setNumber: i + 1, weight: s.weight, reps: s.reps })),
    // The set logger's suggestion for the current exercise's next set.
    ...(idx === exerciseIdx && (completedSets[idx] || []).length < (Number(ex.sets) || 0) ? { nextSet: (({ weight, reps, note }) => ({ setNumber: (completedSets[idx] || []).length + 1, weight, reps, why: note }))(suggestionFor(idx)) } : {}),
  })) : null;

  const applyStructuredCoachAction = async action => {
    // A plan change by name: saved to the plan, then today's workout follows
    // it where that's safe (applyPlanChangeToWorkout).
    if (action.type === "propose_plan_change") {
      const changes = action.payload?.changes || [];
      const updated = applyPlanChangeProposal(sessions, changes);
      if (JSON.stringify(updated) === JSON.stringify(sessions)) return { ok: false, message: "Nothing was changed: those sessions or exercises aren't in your plan." };
      const saved = await saveSplit(updated);
      if (!saved.ok) return { ok: false, message: `Not saved: ${saved.error}. Your plan has not changed. Please try again.` };
      const workoutNow = workoutInProgress && activeSession ? applyPlanChangeToWorkout({ workout: activeSession, exerciseIdx, setProgress, completedSets, currentInputs }, changes) : null;
      if (workoutNow?.changed) {
        setActiveSession(workoutNow.workout);
        setExerciseIdx(workoutNow.exerciseIdx);
        setSetProgress(workoutNow.setProgress);
        setCompletedSets(workoutNow.completedSets);
        setCurrentInputs(workoutNow.currentInputs);
        // The saved workout follows too, so a reload doesn't bring back the old one.
        if (Object.values(workoutNow.completedSets).some(sets => sets?.length)) persistWorkoutLog(workoutNow.completedSets, { session: workoutNow.workout }).catch(() => {});
      }
      return { ok: true, message: ["Saved: those changes are now in your plan.", workoutNow?.changed ? "Today's workout is updated too." : "", ...(workoutNow?.notes || [])].filter(Boolean).join(" ") };
    }
    if (action.scope === "permanent") {
      const updated = applyCoachActionToProgramme(sessions, action);
      if (JSON.stringify(updated) === JSON.stringify(sessions)) return { ok: false, message: "Nothing was changed: that exercise is not in your saved plan." };
      const saved = await saveSplit(updated);
      if (!saved.ok) return { ok: false, message: `Not saved: ${saved.error}. Your plan has not changed.` };
      return { ok: true, message: "Saved to your plan." };
    }
    setActiveSession(previous => applyCoachActionToWorkout(previous, action));
    return { ok: true, message: "Applied to this workout only." };
  };

  const fitnessCoach = (
    <div style={{ flex: "0 0 auto" }}>
      <AICoach
        compact
        coachingV12
        title="AI FITNESS COACH"
        introduction="Talk through your programme, exercise technique, progress, or changes that fit your goals and schedule."
        activationLabel="CHAT WITH FITNESS COACH"
        openingMessage="Give me a brief, practical snapshot of today's training and the single most useful thing to focus on. Do not ask a generic opening question. Finish by inviting me to type if I need help with something specific."
        openWithoutPrompt={Boolean(workoutInProgress && activeSession)}
        storageKey={`fitness-${user.id}`}
        onAction={applyWorkoutCoachAction}
        onMemoryUpdate={saveCoachMemory}
        pendingPrompt={weekReviewPrompt}
        onConsumedPrompt={() => setWeekReviewPrompt(null)}
        coachContext={workoutInProgress && activeSession ? {
          // Between sets: today's session and the last 2 workouts with the same name only.
          programme: sessions.filter(session => session.name?.toLowerCase() === activeSession.name?.toLowerCase()),
          // Every session in brief, so a plan change can name any of them.
          savedPlan: planOutline(sessions),
          workoutId: activeSession.trainingSessionId || null,
          activeWorkout: structuredWorkoutState,
          gymContext: activeSession.gymContext || null,
          recentWorkoutsBySession: recentWorkoutsForCoach(history.filter(log => log.session_name?.toLowerCase() === activeSession.name?.toLowerCase()), { perSession: 2, maxSessions: 1 }),
        } : { programme: sessions, savedPlan: planOutline(sessions), workoutId: activeSession?.trainingSessionId || null, activeWorkout: structuredWorkoutState, gymContext: activeSession?.gymContext || null, recentLegacyWorkouts: history.slice(0, 14), recentWorkoutsBySession: recentWorkoutsForCoach(history) }}
        onStructuredAction={applyStructuredCoachAction}
        planSessions={sessions}
        onOpenChangePlan={request => {
          if (!planChangeHasPending) { setPlanChangeMessages([]); setPlanChangeRecommendation(null); }
          // The request from the workout chat, typed in ready to send.
          setPlanChangeInput(typeof request === "string" ? request : "");
          setPlanChangeOpen(true);
          setView("home");
        }}
      />
    </div>
  );
  // The plan coach card is shown with or without a saved plan.
  const planCoachCard = (
            <div className="t3d-card" style={{ marginBottom: 16 }}>
              <h2 className="t3d-ctitle" style={{ color: NEON }}>AI COACH</h2>
              <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginBottom: 12 }}>Ask about your current plan, progress, recovery or exercise choices.</p>
              {coachMessages.length === 0 && (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
                  {["What should I train today?", "How should I progress this week?", "Can I swap an exercise?"].map(prompt => (
                    <button key={prompt} className="t3d-btn t3d-btn-sm" style={{ fontSize: 8 }} onClick={() => askPlanCoach(prompt)}>{prompt}</button>
                  ))}
                </div>
              )}
              {coachMessages.length > 0 && (
                <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
                  {coachMessages.map((message, index) => (
                    <div key={index} className="t3d-ai-msg" style={{ background: message.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2, border: `1px solid ${message.role === "user" ? "rgba(0,200,255,.15)" : "rgba(0,255,178,.1)"}` }}>
                      <div className="t3d-ai-tag" style={{ color: message.role === "user" ? NEON2 : NEON }}>{message.role === "user" ? "YOU" : "COACH"}</div>
                      <span style={{ color: message.role === "user" ? "#C0D8E8" : "#B7CAD2", whiteSpace: "pre-wrap" }}>{message.role === "assistant" ? cleanAiText(message.content) : message.content}</span>
                      {message.openChangePlan && <div><button className="t3d-btn t3d-btn-sm" style={{ marginTop: 8, fontSize: 8 }} onClick={() => {
                        setPlanChangeInput("");
                        setPlanChangeRecommendation(null);
                        setPlanChangeOpen(true);
                        // A change still waiting for approval keeps its conversation.
                        askPlanChangeCoach(message.openChangePlan, planChangeHasPending ? planChangeMessages : planChangeIntro);
                      }}>OPEN CHANGE PLAN</button></div>}
                    </div>
                  ))}
                  {coachLoading && <div style={{ fontSize: 11, color: "#3A5060" }}>Coach is thinking...</div>}
                </div>
              )}
              {coachMessages.at(-1)?.role === "assistant" && isYesNoQuestion(coachMessages.at(-1)?.content) && (
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {["Yes", "No", "More detail"].map(reply => <button key={reply} className="t3d-btn t3d-btn-sm" onClick={() => askPlanCoach(reply)}>{reply.toUpperCase()}</button>)}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input className="t3d-ai-input" placeholder="Ask a question about your current plan..." value={coachQuestion}
                  onChange={event => setCoachQuestion(event.target.value)}
                  onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); askPlanCoach(); } }} />
                <button className="t3d-btn t3d-btn-sm" onClick={() => askPlanCoach()} disabled={coachLoading || !coachQuestion.trim()}>{coachLoading ? "ASKING..." : "ASK"}</button>
              </div>
            </div>
  );

  const discardWorkoutDialog = discardWorkoutWarning ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}>
      <div className="t3d-card" role="alertdialog" aria-modal="true" aria-labelledby="discard-workout-title" style={{ width: "100%", maxWidth: 360, borderColor: NEON3, textAlign: "center" }}>
        <div id="discard-workout-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: NEON3, letterSpacing: 2, marginBottom: 12 }}>DELETE ACTIVE SESSION?</div>
        <p style={{ fontSize: 11, color: "#A9BBC3", lineHeight: 1.6, marginBottom: 18 }}>
          This removes the accidentally started workout and its unsaved sets. It will not appear in workout history.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} onClick={() => setDiscardWorkoutWarning(false)}>KEEP SESSION</button>
          <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={discardActiveWorkout}>DELETE SESSION</button>
        </div>
      </div>
    </div>
  ) : null;
  // ── WORKOUT VIEW ──────────────────────────────────────────────────────────
  if (view === "workout" && activeSession) {
    const currentExercise = activeSession.exercises[exerciseIdx];
    if (!currentExercise) return null;
    const sIdx = getCurrentSetIdx(exerciseIdx);
    const totalSets = currentExercise.sets || 0;
    const totalExercises = activeSession.exercises.length;
    const exerciseCompletedSets = getCompletedForExercise(exerciseIdx);
    const exerciseRepRanges = repTargets(currentExercise.reps, totalSets);
    const currentSetRepRange = exerciseRepRanges[sIdx] || "8-12";
    const lastSets = getLastSessionData(currentExercise);
    // Suggested numbers show faintly in the boxes (placeholders), so typing
    // replaces them; what you type or step to shows in full.
    const { weight, reps, prefilled, note: setNote } = setInputsFor(exerciseIdx);
    const progression = getProgressionRecommendation(currentExercise);
    const progressionTip = progression && !Array.isArray(progression) && progression.decision === "review_down" ? progression.reason : "";
    const valuesLookSwapped = Number(reps) >= 30 && Number(weight) > 0 && Number(weight) <= 30;
    const exerciseIsComplete = exerciseCompletedSets.length >= totalSets;
    const plannedSetCount = activeSession.exercises.reduce((total, exercise) => total + (Number(exercise.sets) || 0), 0);
    const completedSetCount = Object.values(completedSets).reduce((total, sets) => total + sets.length, 0);
    const remainingSetCount = Math.max(0, plannedSetCount - completedSetCount);
    const estimatedMinutesLeft = remainingSetCount * 3;

    return (
      <div className="t3d-fade t3d-workout-screen">
        <button className="t3d-btn t3d-btn-sm" style={{ alignSelf: "flex-start", flex: "0 0 auto", minHeight: 44 }} onClick={leaveWorkout}>
          {inProgressSetCount > 0 ? "← BACK TO FITNESS · PROGRESS SAVED" : "← BACK TO FITNESS"}
        </button>
        <div className="t3d-card t3d-workout-card">
          {/* Exercise navigation - the full name (long names wrap), with a tiny replace-exercise link */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <button className="t3d-btn t3d-btn-sm" style={{ flex: "0 0 auto", minHeight: 44, opacity: exerciseIdx === 0 ? 0.3 : 1 }}
              aria-label="Previous exercise" title="Previous exercise" onClick={() => { if (exerciseIdx > 0) setExerciseIdx(e => e-1); }}>◀ PREV</button>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0 }}>
              <h2 data-testid="exercise-name" style={{ margin: 0, minWidth: 0, fontFamily: "'Orbitron',monospace", fontSize: currentExercise.name.length > 24 ? 11 : 13, fontWeight: 400, letterSpacing: 1, lineHeight: 1.35, color: "#E0EAF0", textAlign: "center", overflowWrap: "anywhere" }}>{currentExercise.name}</h2>
              <button type="button" title="Replace exercise" aria-label="Replace exercise" onClick={() => setReplaceWarning(exerciseIdx)}
                style={{ flex: "0 0 auto", background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 9, padding: 2, minWidth: 44, minHeight: 44, lineHeight: 1, textDecoration: "underline" }}>swap</button>
            </div>
            <button className="t3d-btn t3d-btn-sm" style={{ flex: "0 0 auto", minHeight: 44, opacity: exerciseIdx === totalExercises-1 ? 0.3 : 1 }}
              aria-label="Next exercise" title="Next exercise" onClick={() => { if (exerciseIdx < totalExercises-1) setExerciseIdx(e => e+1); }}>NEXT ▶</button>
          </div>

          {/* Mini progress box */}
          <div style={{ textAlign: "center", padding: "8px 10px", marginBottom: 10, background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: "#8AABB8", letterSpacing: 1 }}>EXERCISE {exerciseIdx+1} OF {totalExercises}</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, letterSpacing: 2, color: exerciseIsComplete ? NEON : "#E0EAF0", marginTop: 3 }}>
              {exerciseIsComplete ? "COMPLETED ✓" : `SET ${sIdx+1} OF ${totalSets}`}
            </div>
          </div>

          {/* Sets left / time left, with the primary end-of-workout action on the same line */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
            <div style={{ color: "#8AABB8", fontSize: 9, letterSpacing: 1 }}>
              {remainingSetCount} SET{remainingSetCount === 1 ? "" : "S"} LEFT · ~{estimatedMinutesLeft} MIN
            </div>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ fontSize: 9, minHeight: 44, borderColor: "rgba(255,45,120,.55)" }} onClick={() => remainingSetCount > 0 ? setEndWorkoutConfirm(remainingSetCount) : finishWorkout()} disabled={workoutFinishing}>
              {workoutFinishing ? "SAVING..." : "END WORKOUT"}
            </button>
          </div>
          {endWorkoutConfirm !== null && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}>
              <div className="t3d-card" role="alertdialog" aria-modal="true" aria-labelledby="end-workout-title" style={{ width: "100%", maxWidth: 340, borderColor: "#FFB547", textAlign: "center" }}>
                <div id="end-workout-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#FFB547", letterSpacing: 2, marginBottom: 12 }}>
                  {endWorkoutConfirm} SET{endWorkoutConfirm === 1 ? "" : "S"} NOT LOGGED
                </div>
                <p style={{ fontSize: 11, color: "#A9BBC3", lineHeight: 1.6, marginBottom: 18 }}>End anyway? Sets you have not logged will be recorded as skipped.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, minHeight: 44 }} onClick={() => setEndWorkoutConfirm(null)}>KEEP GOING</button>
                  <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1, minHeight: 44 }} onClick={() => { setEndWorkoutConfirm(null); finishWorkout(); }}>END ANYWAY</button>
                </div>
              </div>
            </div>
          )}
          {/* Delete session - kept nearby but deliberately unobtrusive */}
          <div style={{ textAlign: "right", marginBottom: 10 }}>
            <button type="button" onClick={() => setDiscardWorkoutWarning(true)}
              style={{ background: "none", border: 0, color: "#6F8792", cursor: "pointer", fontSize: 9, padding: "3px 2px", minHeight: 44, textDecoration: "underline" }}>delete this workout</button>
          </div>

          {activeSession.sessionAdjustment && <div role="status" style={{ margin: "-4px 0 10px", padding: "6px 8px", borderRadius: 5, background: "rgba(255,181,71,.07)", color: "#FFD08A", fontSize: 9, lineHeight: 1.45, textAlign: "center" }}>{activeSession.sessionAdjustment}</div>}
          {workoutSaveError && <div role="alert" style={{ marginBottom: 10, padding: 9, borderRadius: 5, background: "rgba(255,45,120,.07)", border: "1px solid rgba(255,45,120,.3)", color: "#FF8AAD", fontSize: 9, lineHeight: 1.5 }}>{workoutSaveError}</div>}

          {/* Rest timer */}
          {restActive && (
            <div style={{ textAlign: "center", marginBottom: 16, padding: 12, background: "rgba(0,200,255,.06)", border: "1px solid rgba(0,200,255,.2)", borderRadius: 6 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 24, color: NEON2 }}>{restRemaining}s</div>
              <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1 }}>REST</div>
              <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 8, minHeight: 44, minWidth: 88 }} onClick={() => setRestActive(false)}>SKIP</button>
            </div>
          )}

          {/* Current set - the reps/weight inputs and the confirm button are the one decision that matters here */}
          {!restActive && (
            <div style={{ background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20, marginBottom: 12, textAlign: "center" }}>
              <div className="workout-set-fields">
                <div className="workout-field">
                  <label style={{ display: "block", textAlign: "center" }}>
                    <span style={{ display: "block", fontSize: 12, color: "#F2F7F9", letterSpacing: .8, marginBottom: 8, fontWeight: 700 }}>REPS</span>
                    <input className="workout-number" aria-label="Reps" type="number" inputMode="numeric" value={prefilled.reps ? "" : reps} data-suggested={prefilled.reps && reps ? "true" : undefined}
                      onChange={e => setCurrentInputs(prev => ({ ...prev, [exerciseIdx]: { ...prev[exerciseIdx], reps: e.target.value } }))}
                      placeholder={(prefilled.reps && reps) || "reps"}
                      style={{ background: "#F2F7F9", border: `3px solid ${NEON2}`, borderRadius: 10, fontWeight: 800, textAlign: "center", color: "#080C10", outline: "none" }} />
                  </label>
                  <div className="workout-steppers">
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-label="One rep fewer" onClick={() => stepSetInput("reps", -1)}>−1</button>
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-label="One rep more" onClick={() => stepSetInput("reps", 1)}>+1</button>
                  </div>
                  {lastSets?.[sIdx] && <div style={{ marginTop: 6, fontSize: 9, color: "#8AABB8", textAlign: "center" }}>LAST TIME: {Number(lastSets[sIdx].reps) > 0 ? lastSets[sIdx].reps : "—"}</div>}
                </div>
                <button className="workout-log-set" aria-label="Log set" onClick={confirmSet} disabled={!weight || !reps}
                  style={{ background: weight && reps ? NEON : BORDER, border: "none", borderRadius: 10, cursor: weight && reps ? "pointer" : "not-allowed", color: "#080C10", fontWeight: 800, boxShadow: weight && reps ? `0 0 18px rgba(0,255,178,.45)` : "none" }}>LOG SET</button>
                <div className="workout-field">
                  <label style={{ display: "block", textAlign: "center" }}>
                    <span style={{ display: "block", fontSize: 12, color: "#F2F7F9", letterSpacing: .4, marginBottom: 8, fontWeight: 700 }}>Weight (kg):</span>
                    <input className="workout-number" aria-label="Weight in kilograms" type="number" inputMode="decimal" value={prefilled.weight ? "" : weight} data-suggested={prefilled.weight && weight ? "true" : undefined}
                      onChange={e => setCurrentInputs(prev => ({ ...prev, [exerciseIdx]: { ...prev[exerciseIdx], weight: e.target.value } }))}
                      placeholder={(prefilled.weight && weight) || "kg"}
                      style={{ background: "#F2F7F9", border: `3px solid ${NEON}`, borderRadius: 10, fontWeight: 800, textAlign: "center", color: "#080C10", outline: "none" }} />
                  </label>
                  <div className="workout-steppers">
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-label="2.5 kg less" onClick={() => stepSetInput("weight", -2.5)}>−2.5</button>
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-label="2.5 kg more" onClick={() => stepSetInput("weight", 2.5)}>+2.5</button>
                  </div>
                  {lastSets?.[sIdx] && <div style={{ marginTop: 6, fontSize: 9, color: "#8AABB8", textAlign: "center" }}>LAST TIME: {lastSets[sIdx].weight}kg</div>}
                </div>
              </div>

              {/* Rep range and tempo for this set, directly below the inputs */}
              {(currentSetRepRange || currentExercise.tempo) && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 12, color: "#E0EAF0", letterSpacing: 1, fontWeight: 700 }}>
                    {currentSetRepRange && <div>REP RANGE: {currentSetRepRange}</div>}
                    {currentExercise.tempo && <div>TEMPO {currentExercise.tempo}</div>}
                  </div>
                  {currentExercise.tempo && <div style={{ marginTop: 5, fontSize: 9, color: "#6F8792" }}>Tempo = seconds to lower · pause · lift · pause</div>}
                  <div style={{ marginTop: 11, paddingTop: 9, borderTop: `1px solid ${BORDER}` }}>
                    <div style={{ color: "#8AABB8", fontSize: 8, letterSpacing: 1.2, marginBottom: 6 }}>REP RANGES</div>
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                      {exerciseRepRanges.map((range, index) => <span key={index} style={{ padding: "5px 7px", borderRadius: 4, border: `1px solid ${index === sIdx ? "rgba(0,200,255,.55)" : BORDER}`, background: index === sIdx ? "rgba(0,200,255,.1)" : "rgba(255,255,255,.015)", color: index === sIdx ? NEON2 : "#A9BBC3", fontSize: 9 }}>SET {index + 1} · {range}</span>)}
                    </div>
                  </div>
                </div>
              )}

              {/* Why these numbers: last time, and the weight or reps to aim for */}
              {setNote && <div data-testid="set-note" style={{ marginTop: 10, fontSize: 10, color: NEON, lineHeight: 1.5 }}>{setNote}</div>}
              {progressionTip && <div style={{ marginTop: 6, fontSize: 10, color: "#FFB547", lineHeight: 1.5 }}>{progressionTip}</div>}
              {valuesLookSwapped && (
                <div style={{ marginTop: 9, padding: 8, border: "1px solid rgba(255,181,71,.35)", borderRadius: 5, color: "#FFB547", fontSize: 9 }}>
                  These values may be the wrong way round.
                  <button className="t3d-btn t3d-btn-sm" style={{ marginLeft: 8, padding: "4px 12px", minHeight: 44 }} onClick={() => setCurrentInputs(previous => ({ ...previous, [exerciseIdx]: { reps: weight, weight: reps } }))}>SWITCH</button>
                </div>
              )}
            </div>
          )}

          {/* Last session scores */}
          {lastSets && lastSets.length > 0 && (
            <div style={{ background: "rgba(0,200,255,.04)", border: "1px solid rgba(0,200,255,.1)", borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 2, marginBottom: 6, fontFamily: "'Orbitron',monospace" }}>LAST SESSION</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {lastSets.slice(0, 4).map((s, i) => (
                  <div key={i} style={{ fontSize: 10, color: NEON2 }}>Set {i+1}: {Number(s.reps) > 0 ? `${s.reps} reps @ ${s.weight}kg` : "skipped"}</div>
                ))}
                {lastSets.length > 4 && <div style={{ fontSize: 10, color: "#4A6070" }}>+{lastSets.length - 4} more</div>}
              </div>
            </div>
          )}

          {/* Completed sets this session */}
          {exerciseCompletedSets.length > 0 && (
            <div style={{ marginBottom: 10, padding: "7px 9px", border: `1px solid ${BORDER}`, borderRadius: 5 }}>
              <div style={{ color: "#E0EAF0", fontFamily: "'Orbitron',monospace", fontSize: 8, marginBottom: 6 }}>
                {exerciseCompletedSets.length} SET{exerciseCompletedSets.length === 1 ? "" : "S"} COMPLETE ✓
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                {exerciseCompletedSets.map((set, index) => (
                  <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "stretch", minWidth: 0, background: "rgba(0,200,255,.05)", border: "1px solid rgba(0,200,255,.12)", borderRadius: 5, overflow: "hidden" }}>
                    <button type="button" aria-label={`Edit set ${index + 1}`} onClick={() => setEditingSet({ exerciseIdx, setIdx: index, reps: set.reps, weight: set.weight })} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 6, minWidth: 0, background: "transparent", border: 0, color: "#D8E5EA", cursor: "pointer", fontFamily: "'Inter',sans-serif", fontSize: 9, padding: "7px 8px", textAlign: "left" }}>
                      <span style={{ color: "#8AABB8" }}>SET {index + 1}</span>
                      <span style={{ color: NEON2, whiteSpace: "nowrap" }}>{set.reps} reps · {set.weight}kg{set.personalBest ? ` · ${set.personalBest.label}` : ""}</span>
                      <span style={{ color: "#FFB547", fontWeight: 700, fontSize: 8 }}>EDIT</span>
                    </button>
                    <button type="button" aria-label={`Delete set ${index + 1}`} title="Delete set" onClick={() => deleteActiveSet(exerciseIdx, index)} style={{ minWidth: 44, minHeight: 44, border: 0, borderLeft: "1px solid rgba(255,45,120,.24)", background: "rgba(255,45,120,.08)", color: "#FF6B9E", cursor: "pointer", fontSize: 17 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {replaceWarning !== null && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
              <div style={{ background: SURFACE, border: `1px solid ${NEON3}`, borderRadius: 8, padding: 28, maxWidth: 320, textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON3, letterSpacing: 2, marginBottom: 12 }}>REPLACE EXERCISE</div>
                <div style={{ fontSize: 12, color: "#8AABB8", marginBottom: 20, lineHeight: 1.6 }}>Changing an exercise takes this workout off the saved plan. Do you want to continue?</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} onClick={() => setReplaceWarning(null)}>STAY ON PLAN</button>
                  <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => {
                    const newName = prompt("Enter replacement exercise name:");
                    if (newName) {
                      const updated = JSON.parse(JSON.stringify(activeSession));
                      updated.exercises[replaceWarning].name = newName;
                      setActiveSession(updated);
                    }
                    setReplaceWarning(null);
                  }}>CONFIRM REPLACEMENT</button>
                </div>
              </div>
            </div>
          )}
          {discardWorkoutDialog}

          {editingSet && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}>
              <div className="t3d-card" style={{ width: "100%", maxWidth: 330 }}>
                <h2 className="t3d-ctitle" style={{ color: NEON }}>EDIT COMPLETED SET</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ fontSize: 9, color: "#8AABB8" }}>REPS<input className="t3d-input" type="number" inputMode="numeric" value={editingSet.reps} onChange={event => setEditingSet(value => ({ ...value, reps: event.target.value }))} /></label>
                  <label style={{ fontSize: 9, color: "#8AABB8" }}>WEIGHT KG<input className="t3d-input" type="number" inputMode="decimal" value={editingSet.weight} onChange={event => setEditingSet(value => ({ ...value, weight: event.target.value }))} /></label>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => {
                    deleteActiveSet(editingSet.exerciseIdx, editingSet.setIdx);
                  }}>DELETE SET</button>
                  <button className="t3d-btn t3d-btn-sm" onClick={() => setEditingSet(null)}>CANCEL</button>
                  <button className="t3d-btn t3d-btn-sm" onClick={() => {
                    // Re-check the PB against earlier workouts so an edited set never keeps a stale PB.
                    const priorSets = getExerciseHistory(activeSession.exercises[editingSet.exerciseIdx]).flatMap(exposure => exposure.sets || []);
                    const personalBest = detectPersonalBest({ weight: editingSet.weight, reps: editingSet.reps }, priorSets);
                    setCompletedSets(previous => ({ ...previous, [editingSet.exerciseIdx]: previous[editingSet.exerciseIdx].map((set, index) => index === editingSet.setIdx ? { ...set, reps: editingSet.reps, weight: editingSet.weight, personalBest } : set) }));
                    setEditingSet(null);
                  }}>SAVE SET</button>
                </div>
              </div>
            </div>
          )}
        </div>
        {fitnessCoach}
      </div>
    );
  }

  // ── WORKOUT COMPLETE ──────────────────────────────────────────────────────
  if (view === "complete") {
    const completionReview = buildWorkoutReview(activeSession, completedSets);
    const duration = Math.round((Date.now() - workoutStart) / 60000);
    // PBs, comparison and weekly count use only what is already saved: the PB
    // flag stored on each set, and earlier finished workouts in history.
    const finishedLogId = workoutLogIdRef.current || activeWorkoutLogId;
    const earlierLogs = history.filter(log => log.id !== finishedLogId);
    const loggedExercises = buildLoggedExercises(activeSession, completedSets);
    const newPbs = workoutPersonalBests(loggedExercises);
    const improvements = improvementsSinceLastTime(loggedExercises, (activeSession?.exercises || []).map(exercise => getLastSessionData(exercise, earlierLogs)));
    // A workout with nothing logged does not count towards the week.
    const weekProgress = weeklyWorkoutProgress(earlierLogs, today, sessions, finishedLogId, { countCurrent: completionReview.completedSets > 0 });
    const highlightRow = { display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "7px 0", borderTop: `1px solid ${BORDER}` };
    const highlightTitle = color => ({ fontFamily: "'Orbitron',monospace", fontSize: 10, color, letterSpacing: 2, marginBottom: 6 });
    return (
      <div className="t3d-fade">
        <div className="t3d-card" style={{ textAlign: "center", padding: 20 }}>
          <div className="t3d-done-badge" aria-hidden="true">✓</div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, color: NEON, letterSpacing: 3, marginBottom: 4 }}>WORKOUT COMPLETE</div>
          <div style={{ fontSize: 11, color: "#8AABB8", marginBottom: 16 }}>{activeSession?.name}</div>
          <NewBadgesNotice badges={completeBadges} />
          {newPbs.length > 0 && (
            <div className="t3d-reveal" data-testid="complete-pbs" style={{ textAlign: "left", marginBottom: 12, padding: "12px 14px", border: "1px solid rgba(255,181,71,.5)", background: "linear-gradient(135deg, rgba(255,181,71,.12), rgba(255,181,71,.03))", borderRadius: 8, animationDelay: ".15s" }}>
              <div style={highlightTitle("#FFB547")}>🏆 {newPbs.length} NEW PB{newPbs.length === 1 ? "" : "S"}</div>
              {newPbs.map((pb, index) => (
                <div key={`${pb.exercise}-${index}`} style={highlightRow}>
                  <strong style={{ color: "#E0EAF0" }}>{pb.exercise}</strong>
                  <span style={{ color: "#FFB547", whiteSpace: "nowrap" }}>{pb.type === "weight_pb" ? `${pb.weight}kg × ${pb.reps}` : `${pb.reps} reps @ ${pb.weight}kg`} · {pb.label}</span>
                </div>
              ))}
            </div>
          )}
          {improvements.length > 0 && (
            <div className="t3d-reveal" data-testid="complete-improvements" style={{ textAlign: "left", marginBottom: 12, padding: "12px 14px", border: `1px solid rgba(0,255,178,.3)`, background: "rgba(0,255,178,.05)", borderRadius: 8, animationDelay: ".3s" }}>
              <div style={highlightTitle(NEON)}>BETTER THAN LAST TIME</div>
              {improvements.map((item, index) => (
                <div key={`${item.exercise}-${index}`} style={highlightRow}>
                  <strong style={{ color: "#E0EAF0" }}>{item.exercise}</strong>
                  <span style={{ color: NEON, whiteSpace: "nowrap" }}>{item.kind === "weight" ? `+${item.delta}kg (${item.previousWeight} → ${item.weight}kg)` : `+${item.delta} rep${item.delta === 1 ? "" : "s"} @ ${item.weight}kg`}</span>
                </div>
              ))}
            </div>
          )}
          <div className="t3d-reveal" data-testid="complete-week" style={{ textAlign: "left", marginBottom: 16, padding: "12px 14px", border: `1px solid ${BORDER}`, background: SURFACE2, borderRadius: 8, animationDelay: ".45s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={highlightTitle(NEON2)}>THIS WEEK</div>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, color: "#E0EAF0" }}>
                {weekProgress.planned ? `${weekProgress.completed} / ${weekProgress.planned}` : weekProgress.completed} <span style={{ fontSize: 9, color: "#8AABB8", letterSpacing: 1 }}>WORKOUT{(weekProgress.planned || weekProgress.completed) === 1 ? "" : "S"}{weekProgress.activities > 0 ? ` · ${weekProgress.activities} ${weekProgress.activities === 1 ? "ACTIVITY" : "ACTIVITIES"}` : ""}</span>
              </div>
            </div>
            {weekProgress.planned > 0 && (
              <div className="t3d-pbar"><div className="t3d-pfill" style={{ width: `${Math.min(weekProgress.completed / weekProgress.planned, 1) * 100}%`, background: weekProgress.completed >= weekProgress.planned ? NEON : NEON2 }} /></div>
            )}
            {weekProgress.planned > 0 && weekProgress.completed >= weekProgress.planned && (
              <div style={{ fontSize: 10, color: NEON, marginTop: 8 }}>Every planned session done this week.</div>
            )}
          </div>
          <div className="t3d-grid3" style={{ marginBottom: 14 }}>
            <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: NEON }}>{duration}</div><div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>MINUTES</div></div>
            <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: NEON2 }}>{completionReview.completedSets}</div><div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>SETS COMPLETED</div></div>
            <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: "#FF8C00" }}>{Math.round(completionReview.totalVolumeKg).toLocaleString()}</div><div style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>KG VOLUME</div></div>
          </div>
          <div style={{ textAlign: "left", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Orbitron',monospace", color: "#8AABB8", fontSize: 9, letterSpacing: 1, marginBottom: 9 }}>RECORDED SETS</div>
            {completionReview.exercises.map((exercise, exerciseIndex) => (
              <div key={`${exercise.name}-${exerciseIndex}`} style={{ marginBottom: 12, padding: 11, background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, color: "#E0EAF0", marginBottom: 7 }}>
                  <strong>{exercise.name}</strong><span style={{ color: exercise.skippedSets ? "#FFB547" : NEON }}>{exercise.completedSets}/{exercise.prescribedSets} prescribed sets</span>
                </div>
                {exercise.sets.map(set => (
                  <div key={set.setNumber} style={{ display: "grid", gridTemplateColumns: "54px 1fr auto", gap: 8, alignItems: "center", fontSize: 10, padding: "5px 0", borderTop: `1px solid ${BORDER}` }}>
                    <span style={{ color: "#8AABB8" }}>SET {set.setNumber}</span>
                    <span style={{ color: set.status === "completed" ? NEON : "#6F8792" }}>{set.status === "completed" ? `${set.reps} reps @ ${set.weightKg}kg` : `Target ${set.targetReps || "—"} reps`}</span>
                    <span style={{ color: set.status === "completed" ? NEON : "#FFB547", fontSize: 8 }}>{set.extra ? "EXTRA · COMPLETED" : set.status === "completed" ? "COMPLETED" : "SKIPPED / NOT LOGGED"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {workoutSaveError && <div role="alert" style={{ textAlign: "left", color: "#FF8AAD", background: "rgba(255,45,120,.07)", border: "1px solid rgba(255,45,120,.3)", borderRadius: 6, padding: 10, fontSize: 10, lineHeight: 1.5, marginBottom: 10 }}>{workoutSaveError}</div>}
          {completionFeedback && (
            <div data-testid="coach-session-note" style={{ textAlign: "left", background: "rgba(0,200,255,.06)", border: "1px solid rgba(0,200,255,.25)", borderRadius: 6, padding: 12, marginBottom: 10 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, color: NEON2, letterSpacing: 2, marginBottom: 6 }}>FROM YOUR COACH</div>
              <div style={{ whiteSpace: "pre-wrap", color: "#E0EAF0", fontSize: 12, lineHeight: 1.6 }}>{cleanAiText(completionFeedback)}</div>
            </div>
          )}
          {completionFeedback && (
            <div style={{ textAlign: "left", marginBottom: 10 }}>
              {completionFollowUps.map((message, index) => (
                <div key={index} className="t3d-ai-msg" style={{ background: message.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2 }}>
                  <div className="t3d-ai-tag" style={{ color: message.role === "user" ? NEON2 : NEON }}>{message.role === "user" ? "YOU" : "AI COACH"}</div>
                  <span style={{ whiteSpace: "pre-wrap", color: "#C5D6DC", fontSize: 10, lineHeight: 1.55 }}>{message.role === "assistant" ? cleanAiText(message.content) : message.content}</span>
                </div>
              ))}
              {completionReplyLoading && <p role="status" style={{ fontSize: 10, color: NEON }}>Coach is thinking...</p>}
              <div style={{ display: "flex", gap: 7 }}>
                <input className="t3d-ai-input" placeholder="Ask the coach about this workout..." value={completionQuestion}
                  onChange={event => setCompletionQuestion(event.target.value)}
                  onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); askCompletionFollowUp(); } }} />
                <button className="t3d-btn t3d-btn-sm" onClick={askCompletionFollowUp} disabled={completionReplyLoading || !completionQuestion.trim()}>ASK</button>
              </div>
            </div>
          )}
          <button className="t3d-btn" style={{ width: "100%", padding: 11, marginBottom: 8, borderColor: NEON2, color: NEON2 }} onClick={() => { setWorkoutSaveError(""); getCompletionFeedback(); }} disabled={completionFeedbackLoading || Boolean(completionFeedback)}>{completionFeedbackLoading ? "COACH IS REVIEWING..." : completionFeedback ? "COACH FEEDBACK SAVED" : "RETRY COACH FEEDBACK"}</button>
          <button className="t3d-btn" style={{ width: "100%", padding: 11, background: "rgba(0,255,178,.12)", borderColor: NEON, color: NEON }} onClick={async () => { await loadData(); setActiveSession(null); setCompletionFeedback(""); setCompletionFollowUps([]); setCompletionQuestion(""); setWorkoutSaveError(""); setView("home"); }}>BACK TO FITNESS</button>
        </div>
      </div>
    );
  }

  // ── AI BUILDER ────────────────────────────────────────────────────────────
  if (view === "ai_builder") {
    if (aiBuilding) return (
      <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 30, marginBottom: 16 }}>🤖</div>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 14 }}>BUILDING YOUR PROGRAMME</div>
        <ol role="status" aria-live="polite" style={{ listStyle: "none", padding: 0, margin: "0 auto", maxWidth: 320, textAlign: "left" }}>
          {AI_BUILD_STAGES.map((stage, index) => (
            <li key={stage} style={{ fontSize: 11, padding: "5px 0", color: index < aiBuildStage ? NEON : index === aiBuildStage ? "#E0EAF0" : "#4A6070" }}>
              {index < aiBuildStage ? "✓" : index === aiBuildStage ? "▸" : "·"} {stage}{index === aiBuildStage ? "..." : ""}
            </li>
          ))}
        </ol>
        <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 12 }}>This usually takes 20–40 seconds.</div>
      </div></div>
    );

    if (aiPlan) return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <h2 className="t3d-ctitle">YOUR AI COACH PROGRAMME — {aiPlan.split_name}</h2>
          <p style={{ fontSize: 11, color: "#8AABB8" }}>Tempo = lower · pause · lift · pause, in seconds. X means an explosive movement.</p>
          {split && <p style={{ fontSize: 11, color: "#FFB547" }}>Saving this programme replaces your current plan. Your workout history stays saved.</p>}
          {aiPlanError && <p role="alert" style={{ color: NEON3, fontSize: 12 }}>{aiPlanError}</p>}
          {aiPlan.notes && <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>{aiPlan.notes}</div>}
          {aiPlan.sessions?.map((s, sIdx) => (
            <div key={sIdx} style={{ marginBottom: 16, background: SURFACE2, borderRadius: 6, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON }}>{s.name}</div>
                <div style={{ fontSize: 10, color: "#E0EAF0" }}>{s.days?.join(", ")}</div>
              </div>
              {(s.duration_mins || s.reasoning) && <div style={{ fontSize: 9, color: "#8AABB8", lineHeight: 1.5, marginBottom: 8 }}>{s.duration_mins ? `${s.duration_mins} MIN · ` : ""}{s.reasoning}</div>}
              {s.exercises?.map((ex, eIdx) => (
                <div key={eIdx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 11 }}>
                  <div style={{ flex: 1 }}>{ex.name}</div>
                  <div style={{ fontSize: 10, color: "#E0EAF0" }}>{ex.sets}×{repTargets(ex.reps, ex.sets).join("/")}</div>
                  {ex.tempo && <div style={{ fontSize: 9, color: NEON2 }}>{ex.tempo}</div>}
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setAiPlan(null)}>REBUILD</button>
            <button className="t3d-btn" style={{ flex: 1, padding: 12 }} onClick={async () => {
              if (aiPlanSaving) return;
              setAiPlanSaving(true);
              setAiPlanError("");
              try {
                // Saving is the approval: no second "review & approve" step.
                const now = new Date();
                const approvedSessions = withPlanApproval(normalizeFitnessSessions(aiPlan.sessions), now);
                // saveSplit reads the row back and only updates the screen once it matches.
                const saved = await saveSplit(approvedSessions, { split_name: aiPlan.split_name || "My Programme", programme_started_at: now.toISOString(), week_reviewed_at: null });
                if (!saved.ok) throw new Error(saved.error);
                setView("home");
              } catch (error) {
                setAiPlanError(`Your programme could not be saved: ${error?.message || "connection problem"}. Please try again.`);
              } finally { setAiPlanSaving(false); }
            }} disabled={aiPlanSaving}>{aiPlanSaving ? "SAVING..." : "SAVE PLAN"}</button>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" disabled={aiPlanSaving} onClick={() => setView("home")}>CANCEL</button>
          </div>
        </div>
      </div>
    );

    const currentQ = aiAskedQuestions[aiStep] || aiAskedQuestions[0];
    if (!currentQ) return (
      <div className="t3d-fade"><div className="t3d-card">
        <h2 className="t3d-ctitle">YOUR ANSWERS ARE READY</h2>
        <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>Everything the coach needs came from your chat.</p>
        {aiPlanError && <p role="alert" style={{ color: NEON3, fontSize: 12 }}>{aiPlanError}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="t3d-btn" onClick={() => buildAIPlan()}>BUILD MY PROGRAMME</button>
          <button className="t3d-btn t3d-btn-sm" onClick={() => { setAiQuestionIds(null); setAiStep(0); }}>REVIEW ALL ANSWERS</button>
          <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setView("home")}>CANCEL</button>
        </div>
      </div></div>
    );
    const isLastQuestion = aiStep >= aiAskedQuestions.length - 1;
    const answered = Boolean(aiAnswerText(currentQ).trim());
    const goNext = (answers = aiAnswers) => isLastQuestion ? buildAIPlan(answers) : setAiStep(step => step + 1);
    const selectedValues = Array.isArray(aiAnswers[currentQ.id]) ? aiAnswers[currentQ.id] : aiAnswers[currentQ.id] ? [aiAnswers[currentQ.id]] : [];
    const optionStyle = selected => ({
      textAlign: "left", padding: "12px 16px", fontSize: 11, letterSpacing: 1, whiteSpace: "normal",
      background: selected ? "rgba(0,255,178,.18)" : "transparent",
      border: `${selected ? 2 : 1}px solid ${selected ? NEON : "#31434F"}`,
      color: selected ? NEON : "#C5D6DC",
      boxShadow: selected ? `0 0 10px ${NEON}40` : "none",
    });
    const chooseOption = option => setAiAnswers(answers => {
      if (!currentQ.multi) return { ...answers, [currentQ.id]: option };
      const current = Array.isArray(answers[currentQ.id]) ? answers[currentQ.id] : [];
      if (current.includes(option)) return { ...answers, [currentQ.id]: current.filter(item => item !== option) };
      return { ...answers, [currentQ.id]: [...current, option].slice(-currentQ.multi) };
    });
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
            {aiAskedQuestions.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= aiStep ? NEON : BORDER, transition: "background .3s" }} />
            ))}
          </div>
          {aiPrefillNote && <p role="status" style={{ fontSize: 11, color: "#FFB547", lineHeight: 1.6, marginTop: 0 }}>{aiPrefillNote}</p>}
          {aiQuestionIds && aiQuestionIds.length < AI_QUESTIONS.length && (
            <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginTop: 0 }}>
              Your other answers were taken from your chat with the coach. Only the missing ones are asked here.
            </p>
          )}
          <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 8 }}>QUESTION {aiStep+1} OF {aiAskedQuestions.length}</div>
          <div style={{ fontSize: 14, color: "#E0EAF0", marginBottom: 24, lineHeight: 1.6 }}>{currentQ.q}</div>
          {currentQ.type === "choice" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {currentQ.options.map((opt, i) => {
                const selected = selectedValues.includes(opt);
                return (
                  <button key={i} type="button" aria-pressed={selected} className="t3d-btn" style={optionStyle(selected)} onClick={() => chooseOption(opt)}>
                    {selected ? "✓ " : ""}{opt}
                  </button>
                );
              })}
            </div>
          )}
          {currentQ.type === "choice" && currentQ.custom && (
            <label style={{ display: "block", fontSize: 12, marginBottom: 16 }}>
              Or describe your own answer
              <input className="t3d-input" style={{ marginTop: 8 }}
                value={currentQ.multi ? aiAnswers[`${currentQ.id}_custom`] || "" : currentQ.options.includes(aiAnswers[currentQ.id]) ? "" : aiAnswers[currentQ.id] || ""}
                onChange={event => setAiAnswers(answers => ({ ...answers, [currentQ.multi ? `${currentQ.id}_custom` : currentQ.id]: event.target.value }))} />
            </label>
          )}
          {currentQ.type === "days" && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {DAYS.map(day => {
                  const selected = selectedValues.includes(day);
                  return (
                    <button key={day} type="button" aria-pressed={selected} className="t3d-btn" style={{ ...optionStyle(selected), minWidth: 52, minHeight: 44, textAlign: "center", padding: "10px 8px" }}
                      onClick={() => setAiAnswers(answers => {
                        const current = (Array.isArray(answers.preferred_days) ? answers.preferred_days : []).filter(item => item !== "FLEXIBLE");
                        return { ...answers, preferred_days: current.includes(day) ? current.filter(item => item !== day) : DAYS.filter(item => item === day || current.includes(item)) };
                      })}>{day}</button>
                  );
                })}
              </div>
              <button type="button" aria-pressed={selectedValues.includes("FLEXIBLE")} className="t3d-btn" style={{ ...optionStyle(selectedValues.includes("FLEXIBLE")), width: "100%" }}
                onClick={() => setAiAnswers(answers => ({ ...answers, preferred_days: ["FLEXIBLE"] }))}>
                {selectedValues.includes("FLEXIBLE") ? "✓ " : ""}I&apos;m flexible – let the coach choose
              </button>
            </div>
          )}
          {currentQ.type === "availability" && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: "#8AABB8", lineHeight: 1.6 }}>
                Enter any duration or range. If your time varies, tell the coach what works on each day.
              </p>
              <label style={{ display: "block", fontSize: 12 }}>
                Your available time
                <textarea className="t3d-input" rows={4} style={{ marginTop: 8, resize: "vertical" }}
                  placeholder={"e.g. 35 minutes every session\nOr Monday 30 minutes, Wednesday 45–60, Saturday 75"}
                  value={aiAnswers[currentQ.id] || ""}
                  onChange={event => setAiAnswers(answers => ({ ...answers, [currentQ.id]: event.target.value }))} />
              </label>
            </div>
          )}
          {currentQ.type === "text" && (
            <div style={{ marginBottom: 20 }}>
              <input className="t3d-input" placeholder={currentQ.placeholder}
                value={aiAnswers[currentQ.id] || ""}
                onChange={e => setAiAnswers(a => ({ ...a, [currentQ.id]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && answered && goNext()} />
              {currentQ.skipLabel && (
                <button type="button" className="t3d-btn" style={{ ...optionStyle(aiAnswers[currentQ.id] === currentQ.skipLabel), width: "100%", marginTop: 10 }}
                  onClick={() => { const answers = { ...aiAnswers, [currentQ.id]: currentQ.skipLabel }; setAiAnswers(answers); goNext(answers); }}>
                  {currentQ.skipLabel}
                </button>
              )}
            </div>
          )}
          <button className="t3d-btn" style={{ width: "100%", padding: 12, marginBottom: 12 }} disabled={!answered} onClick={() => goNext()}>
            {isLastQuestion ? "BUILD MY PROGRAMME" : "NEXT →"}
          </button>
          {aiPlanError && <p role="alert" style={{ color: NEON3, fontSize: 12 }}>{aiPlanError}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            {aiStep > 0 && <button className="t3d-btn t3d-btn-sm" onClick={() => setAiStep(step => step - 1)}>← BACK</button>}
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setView("home")}>CANCEL</button>
          </div>
        </div>
      </div>
    );
  }

  const openExerciseEditor = (sessionIdx, exerciseIdx) => {
    const exercise = sessions[sessionIdx]?.exercises?.[exerciseIdx];
    if (!exercise) return;
    const reps = repTargets(exercise.reps, Number(exercise.sets) || 0, "");
    const uniform = reps.every(rep => rep === reps[0]);
    setNewEx({ name: exercise.name, sets: Number(exercise.sets) || reps.length || 3, reps, repsAll: uniform ? reps[0] || "" : "", perSet: !uniform, tempo: exercise.tempo || "" });
    setEditingExerciseIdx(exerciseIdx);
    setAddExerciseModal(sessionIdx);
  };

  // A plan the user built by hand is theirs: save it approved, starting now.
  const saveManualPlan = async (planSessions = sessions) => {
    const now = new Date();
    const approved = withPlanApproval(planSessions, now);
    const extra = { programme_started_at: now.toISOString(), week_reviewed_at: null };
    const saved = await saveSplit(approved, extra);
    if (!saved.ok) { window.alert(`Your plan could not be saved: ${saved.error}. Please try again.`); return; }
    setImportEditing(false);
    setSplit({ sessions: approved, ...extra });
    setView("home");
  };

  // ── IMPORT MY PLAN ────────────────────────────────────────────────────────
  // Paste or upload -> AI interprets -> review -> the user saves. Nothing is
  // written until SAVE THIS PLAN (or SAVE SPLIT after editing).
  const openImport = () => {
    setImportText(""); setImportResult(null); setImportError(""); setImportFileNote("");
    setPlanChangeOpen(false);
    setView("import");
  };
  const importedSessions = result => result.sessions.map((session, index) => ({
    ...session, source: "import", ...(index === 0 && result.notes ? { programme_notes: result.notes } : {}),
  }));
  const loadImportFile = async file => {
    setImportError(""); setImportFileNote("");
    if (!file) return;
    if (file.size > IMPORT_FILE_MAX_BYTES) {
      setImportError(`That file is too large (${Math.round(file.size / 1024)} KB). The limit is ${Math.round(IMPORT_FILE_MAX_BYTES / 1024)} KB; paste the part with the plan instead.`);
      return;
    }
    if (!isSupportedImportFile(file.name)) {
      setImportError("That file type can't be read yet. Export a spreadsheet or Google Sheet as CSV, or copy the text from a PDF or Word document and paste it in.");
      return;
    }
    try {
      setImportText(await file.text());
      setImportFileNote(`Loaded ${file.name}. Check the text below, then interpret it.`);
    } catch {
      setImportError("That file could not be read. Try pasting its contents instead.");
    }
  };
  const interpretImport = async () => {
    const source = importSourceText(importText);
    if (!source.text || importInterpreting) return;
    setImportInterpreting(true);
    setImportError("");
    try {
      const messages = [{ role: "user", content: `Here is the training plan from my coach:\n"""\n${source.text}\n"""` }];
      let parsed = null;
      // One retry if the reply cannot be read as the requested JSON.
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        const res = await fetch("/api/chat", {
          method: "POST", headers: await chatHeaders(),
          body: JSON.stringify({ responseTokens: 6000, area: "plan_import", messages }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `the coach service is unavailable (${res.status})`);
        const reply = data.content?.map(block => block.text || "").join("") || "";
        const candidate = extractJsonObject(reply);
        if (candidate && Array.isArray(candidate.sessions)) parsed = candidate;
        else messages.push({ role: "assistant", content: reply || "(empty reply)" }, { role: "user", content: "That could not be read. Return the whole plan again as one valid JSON object matching the schema, and nothing else." });
      }
      if (!parsed) throw new Error("the reply could not be read");
      const result = normaliseImportedFitnessPlan(parsed);
      if (!result.sessions.length) throw new Error("no workouts with exercises were found in that text");
      if (source.truncated) result.flags.unshift({ where: "Plan", issue: "The plan was very long, so only the first part was read." });
      setImportResult(result);
    } catch (error) {
      setImportError(`Your plan could not be interpreted: ${error?.message || "connection problem"}. Nothing has been saved.`);
    } finally {
      setImportInterpreting(false);
    }
  };
  const saveImport = async () => {
    if (!importResult || importSaving) return;
    setImportSaving(true);
    setImportError("");
    const now = new Date();
    const approved = withPlanApproval(normalizeFitnessSessions(importedSessions(importResult)), now);
    const saved = await saveSplit(approved, { split_name: importResult.planName || "Imported plan", programme_started_at: now.toISOString(), week_reviewed_at: null });
    setImportSaving(false);
    if (!saved.ok) { setImportError(`Your plan could not be saved: ${saved.error}. Your previous plan is unchanged.`); return; }
    setImportResult(null);
    setView("home");
  };
  const editImport = () => {
    setSessions(importedSessions(importResult));
    setSetupStep(1);
    setCurrentSessionIdx(0);
    setImportEditing(true);
    setView("setup");
  };
  const cancelImportEdit = () => {
    setImportEditing(false);
    setSessions(normalizeFitnessSessions(split?.sessions || []));
    setView("home");
  };

  if (view === "import") {
    if (importResult) return (
      <div className="t3d-fade" data-testid="import-review">
        <div className="t3d-card">
          <h2 className="t3d-ctitle">CHECK YOUR IMPORTED PLAN</h2>
          <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginTop: 0 }}>This is what TRACK3D understood from your coach&apos;s plan. Nothing is saved until you confirm.</p>
          {importResult.flags.length > 0 && (
            <div data-testid="import-flags" style={{ marginBottom: 14, padding: 12, border: "1px solid rgba(255,181,71,.45)", background: "rgba(255,181,71,.06)", borderRadius: 7 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#FFB547", letterSpacing: 1.5, marginBottom: 6 }}>PLEASE CHECK · {importResult.flags.length}</div>
              {importResult.flags.map((item, index) => (
                <div key={index} style={{ fontSize: 10, color: "#D6E1E5", lineHeight: 1.55, padding: "3px 0" }}><strong style={{ color: "#FFB547" }}>{item.where}:</strong> {item.issue}</div>
              ))}
            </div>
          )}
          {importResult.planName && <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 8 }}>{importResult.planName}</div>}
          {importResult.notes && <div style={{ fontSize: 11, color: "#B4C5CC", lineHeight: 1.55, marginBottom: 12, whiteSpace: "pre-wrap" }}><span style={{ color: NEON2, fontSize: 9, letterSpacing: 1 }}>COACH NOTES · </span>{importResult.notes}</div>}
          {importResult.sessions.map((session, index) => (
            <PlanSessionCard key={`${session.name}-${index}`} session={session} label={session.days.length ? session.days.join(" / ") : "NO DAY SET"} description={session.notes} />
          ))}
          {split && <p style={{ fontSize: 11, color: "#FFB547" }}>Saving this replaces your current plan. Your workout history stays saved.</p>}
          {importError && <p role="alert" style={{ color: NEON3, fontSize: 11 }}>{importError}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="t3d-btn" style={{ flex: "1 1 180px", padding: 12, background: "rgba(0,255,178,.12)", borderColor: NEON }} disabled={importSaving} onClick={saveImport}>{importSaving ? "SAVING..." : "SAVE THIS PLAN ✓"}</button>
            <button className="t3d-btn" style={{ flex: "1 1 140px", padding: 12, borderColor: BORDER, color: "#E0EAF0" }} disabled={importSaving} onClick={editImport}>EDIT BEFORE SAVING</button>
          </div>
          <button type="button" onClick={() => { setImportResult(null); setImportError(""); }} disabled={importSaving}
            style={{ marginTop: 10, background: "none", border: 0, color: "#8AABB8", fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: "8px 0" }}>Start again with different text</button>
        </div>
      </div>
    );
    return (
      <div className="t3d-fade" data-testid="import-input">
        <div className="t3d-card">
          <button className="t3d-btn t3d-btn-sm" style={{ marginBottom: 14 }} onClick={() => setView("home")} disabled={importInterpreting}>← BACK</button>
          <h2 className="t3d-ctitle">IMPORT MY PLAN</h2>
          <p style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginTop: 0 }}>
            Paste the training programme from your coach, in whatever format they sent it. TRACK3D will show you what it understood before anything is saved.
          </p>
          {importInterpreting ? (
            <div role="status" style={{ textAlign: "center", padding: "30px 0", fontSize: 11, color: NEON }}>Reading your plan... This usually takes 10–30 seconds.</div>
          ) : (
            <>
              <textarea className="t3d-input" aria-label="Your coach's plan" rows={12} value={importText} onChange={event => setImportText(event.target.value)}
                placeholder={"Push A (Monday)\nIncline DB Press - 3 x 8-10\nMachine Chest Press - 3 x 10\nCable Fly - 3 x 12-15, 60s rest\n\nPull A (Tuesday)\n..."}
                style={{ width: "100%", minHeight: 220, fontSize: 16, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 0 6px" }}>
                <label className="t3d-btn t3d-btn-sm" style={{ cursor: "pointer" }}>
                  UPLOAD .CSV / .TXT
                  <input type="file" accept=".csv,.txt,.tsv,.md,text/plain,text/csv" style={{ display: "none" }} data-testid="import-file"
                    onChange={event => { loadImportFile(event.target.files?.[0]); event.target.value = ""; }} />
                </label>
                <span style={{ fontSize: 9, color: "#6F8792", lineHeight: 1.5 }}>Excel or Google Sheets: export as CSV. PDF or Word: copy and paste the text.</span>
              </div>
              {importFileNote && <p style={{ fontSize: 10, color: NEON, margin: "6px 0" }}>{importFileNote}</p>}
              {importError && <p role="alert" style={{ color: NEON3, fontSize: 11 }}>{importError}</p>}
              <button className="t3d-btn" style={{ width: "100%", padding: 12, marginTop: 8 }} disabled={!importText.trim()} onClick={interpretImport}>INTERPRET MY PLAN →</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── MANUAL SETUP ──────────────────────────────────────────────────────────
  if (view === "setup") {
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          {importEditing && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", border: "1px solid rgba(0,200,255,.35)", background: "rgba(0,200,255,.06)", borderRadius: 6 }}>
              <span style={{ fontSize: 10, color: NEON2, lineHeight: 1.5 }}>IMPORTED PLAN · Check each session, then SAVE SPLIT. Nothing is saved yet.</span>
              <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={cancelImportEdit}>CANCEL IMPORT</button>
            </div>
          )}
          {setupStep === 0 && (
            <div>
              <button className="t3d-btn t3d-btn-sm" style={{ marginBottom: 14 }} onClick={() => setView("home")}>← BACK</button>
              <h2 className="t3d-ctitle">YOUR TRAINING EXPERIENCE</h2>
              <p style={{ fontSize: 10, color: "#8AABB8", margin: "0 0 8px" }}>The coach explains things to match. You can change this later in any coach chat.</p>
              <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
                {EXPERIENCE_OPTIONS.map(([key, label]) => (
                  <button key={key} className="t3d-btn t3d-btn-sm" aria-pressed={setupExperience === key} style={{ flex: 1, fontSize: 8, background: setupExperience === key ? "rgba(0,255,178,.15)" : "transparent", borderColor: setupExperience === key ? NEON : BORDER, color: setupExperience === key ? NEON : "#E0EAF0" }}
                    onClick={() => { setSetupExperience(key); saveExperienceLevel(key); }}>{label}</button>
                ))}
              </div>
              <h2 className="t3d-ctitle">HOW MANY SESSIONS PER WEEK?</h2>
              <button className="t3d-btn t3d-btn-sm" onClick={openAiBuilder}>LET AI COACH CHOOSE MY PROGRAMME</button>
              <div style={{ display: "flex", justifyContent: "center", gap: 12, margin: "32px 0" }}>
                {[2,3,4,5,6].map(n => (
                  <button key={n} className="t3d-btn" style={{ width: 50, height: 50, fontSize: 18, padding: 0,
                    background: numSessions === n ? "rgba(0,255,178,.15)" : "transparent",
                    borderColor: numSessions === n ? NEON : BORDER }}
                    onClick={() => setNumSessions(n)}>{n}</button>
                ))}
              </div>
              <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={() => {
                setSessions(Array.from({ length: numSessions }, (_, i) => ({ name: `Session ${i+1}`, days: [], exercises: [] })));
                setSetupStep(1); setCurrentSessionIdx(0);
              }}>NEXT →</button>
            </div>
          )}

          {setupStep === 1 && sessions[currentSessionIdx] && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 className="t3d-ctitle" style={{ margin: 0 }}>SESSION {currentSessionIdx+1} OF {sessions.length}</h2>
                <div style={{ fontSize: 10, color: "#E0EAF0" }}>{currentSessionIdx+1}/{sessions.length}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 }}>SESSION NAME</div>
                <input className="t3d-input" aria-label={`Session ${currentSessionIdx + 1} name`} placeholder="e.g. Push, Pull, Legs, Upper..."
                  value={sessions[currentSessionIdx].name}
                  onChange={e => setSessions(prev => prev.map((s, i) => i === currentSessionIdx ? { ...s, name: e.target.value } : s))} />
              </div>

              {/* Days — optional */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 }}>
                  TRAINING DAYS <span style={{ color: "#2A3A48" }}>(OPTIONAL)</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {DAYS.map(d => {
                    const selected = sessions[currentSessionIdx].days?.includes(d);
                    return (
                      <button key={d} className="t3d-btn t3d-btn-sm"
                        style={{ background: selected ? "rgba(0,255,178,.15)" : "transparent", borderColor: selected ? NEON : BORDER, color: selected ? NEON : "#E0EAF0" }}
                        onClick={() => setSessions(prev => prev.map((s, i) => i === currentSessionIdx ? {
                          ...s, days: selected ? s.days.filter(x => x !== d) : [...(s.days||[]), d]
                        } : s))}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Exercises */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 8 }}>EXERCISES</div>
                {sessions[currentSessionIdx].exercises?.map((ex, eIdx) => (
                  <div key={eIdx} role="button" tabIndex={0} aria-label={`Edit ${ex.name}`}
                    onClick={() => openExerciseEditor(currentSessionIdx, eIdx)}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openExerciseEditor(currentSessionIdx, eIdx); } }}
                    style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 8, cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontSize: 12 }}>{ex.name} <span style={{ fontSize: 9, color: "#6F8792" }}>· TAP TO EDIT</span></div>
                      <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ fontSize: 8 }} aria-label={`Remove ${ex.name}`}
                        onClick={event => { event.stopPropagation(); setSessions(prev => prev.map((s, i) => i === currentSessionIdx ? { ...s, exercises: s.exercises.filter((_, j) => j !== eIdx) } : s)); }}>✕</button>
                    </div>
                    <div style={{ fontSize: 10, color: "#E0EAF0" }}>
                      {ex.sets} sets · {repTargets(ex.reps, ex.sets).join(" / ")} reps
                      {ex.tempo && ` · ${ex.tempo}`}
                    </div>
                  </div>
                ))}
                <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginTop: 4 }}
                  onClick={() => { setEditingExerciseIdx(null); setNewEx({ name: "", sets: 3, reps: [], repsAll: "", perSet: false, tempo: "" }); setAddExerciseModal(currentSessionIdx); }}>+ ADD EXERCISE</button>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {currentSessionIdx > 0 && <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setCurrentSessionIdx(i => i-1)}>← BACK</button>}
                {currentSessionIdx < sessions.length-1 ? (
                  <button className="t3d-btn" style={{ flex: 1, padding: 12 }} onClick={() => setCurrentSessionIdx(i => i+1)}>NEXT SESSION →</button>
                ) : (
                  <button className="t3d-btn" style={{ flex: 1, padding: 12 }} onClick={() => {
                    if (sessions.some(s => !s.exercises?.length)) { setEmptySessionsWarning(true); return; }
                    const hasNoDays = sessions.some(s => !s.days || s.days.length === 0);
                    if (hasNoDays) { setNoDaysWarning(true); return; }
                    saveManualPlan();
                  }}>SAVE SPLIT ✓</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* No days warning modal */}
        {noDaysWarning && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div style={{ background: SURFACE, border: `1px solid ${NEON2}`, borderRadius: 8, padding: 28, maxWidth: 340, textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>📅</div>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON2, letterSpacing: 2, marginBottom: 12 }}>ALLOCATE YOUR DAYS</div>
              <div style={{ fontSize: 12, color: "#8AABB8", marginBottom: 20, lineHeight: 1.7 }}>
                Scheduling sessions to specific days helps build consistency, lets TRACK3D show you today's workout automatically, and makes it easier to stay on track. We strongly recommend allocating days!
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} onClick={() => setNoDaysWarning(false)}>GO BACK & ADD DAYS</button>
                <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, borderColor: BORDER, color: "#E0EAF0" }} onClick={() => {
                  setNoDaysWarning(false);
                  saveManualPlan();
                }}>SAVE ANYWAY</button>
              </div>
            </div>
          </div>
        )}

        {/* Sessions without exercises would not be saved */}
        {emptySessionsWarning && (() => {
          const emptySessions = sessions.map((session, index) => ({ session, index })).filter(({ session }) => !session.exercises?.length);
          return (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
              <div role="alertdialog" aria-modal="true" aria-labelledby="empty-sessions-title" style={{ background: SURFACE, border: "1px solid #FFB547", borderRadius: 8, padding: 24, maxWidth: 360, textAlign: "center" }}>
                <div id="empty-sessions-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: "#FFB547", letterSpacing: 2, marginBottom: 12 }}>
                  {emptySessions.length === 1 ? "1 SESSION HAS NO EXERCISES" : `${emptySessions.length} SESSIONS HAVE NO EXERCISES`}
                </div>
                <div style={{ fontSize: 12, color: "#C5D6DC", marginBottom: 18, lineHeight: 1.7 }}>
                  {emptySessions.map(({ session }) => session.name || "Unnamed session").join(", ")} will not be saved unless you add exercises.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} onClick={() => { setEmptySessionsWarning(false); setCurrentSessionIdx(emptySessions[0].index); }}>ADD EXERCISES</button>
                  <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, borderColor: BORDER, color: "#E0EAF0" }} onClick={() => {
                    setEmptySessionsWarning(false);
                    const remaining = sessions.filter(session => session.exercises?.length);
                    if (!remaining.length) return;
                    setSessions(remaining);
                    setCurrentSessionIdx(0);
                    if (remaining.some(session => !session.days?.length)) { setNoDaysWarning(true); return; }
                    saveManualPlan(remaining);
                  }}>SAVE WITHOUT THEM</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Add exercise modal */}
        {addExerciseModal !== null && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 380 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 16 }}>{editingExerciseIdx === null ? "ADD EXERCISE" : "EDIT EXERCISE"}</div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 }}>EXERCISE NAME</div>
                <input className="t3d-input" placeholder="e.g. Bench Press" value={newEx.name} onChange={e => setNewEx(n => ({ ...n, name: e.target.value }))} />
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 }}>SETS</div>
                  <input className="t3d-input" type="number" placeholder="3" value={newEx.sets}
                    onChange={e => {
                      const n = parseInt(e.target.value) || 1;
                      setNewEx(prev => ({ ...prev, sets: n, reps: Array.from({ length: n }, (_, i) => prev.reps[i] || "") }));
                    }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 }}>TEMPO (OPT)</div>
                  <input className="t3d-input" placeholder="3-1-0-1" value={newEx.tempo} onChange={e => setNewEx(n => ({ ...n, tempo: e.target.value }))} />
                </div>
              </div>

              {/* Reps: one box for all sets, per-set optional */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 }}>REPS FOR ALL SETS</div>
                <input className="t3d-input" placeholder="e.g. 8-10 or 8" value={newEx.repsAll} disabled={newEx.perSet}
                  onChange={e => setNewEx(prev => ({ ...prev, repsAll: e.target.value }))} />
                <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 6 }}>Leave blank for 8–12 reps.</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "#C5D6DC", marginTop: 10, minHeight: 44 }}>
                  <input type="checkbox" checked={newEx.perSet} onChange={e => setNewEx(prev => ({ ...prev, perSet: e.target.checked, reps: Array.from({ length: prev.sets || 3 }, (_, i) => prev.reps[i] || prev.repsAll || "") }))} />
                  Set different reps for each set
                </label>
                {newEx.perSet && Array.from({ length: newEx.sets || 3 }, (_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <div style={{ fontSize: 10, color: "#E0EAF0", width: 40, fontFamily: "'Orbitron',monospace" }}>SET {i+1}</div>
                    <input className="t3d-input" placeholder="8-12"
                      value={newEx.reps[i] || ""}
                      onChange={e => setNewEx(prev => {
                        const reps = [...(prev.reps || [])];
                        reps[i] = e.target.value;
                        return { ...prev, reps };
                      })} />
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => { setAddExerciseModal(null); setEditingExerciseIdx(null); setNewEx({ name: "", sets: 3, reps: [], repsAll: "", perSet: false, tempo: "" }); }}>CANCEL</button>
                <button className="t3d-btn" style={{ flex: 1 }} disabled={!newEx.name.trim()}
                  onClick={() => {
                    const setCount = newEx.sets || 3;
                    const exercise = {
                      name: newEx.name.trim(), sets: setCount, tempo: newEx.tempo,
                      reps: Array.from({ length: setCount }, (_, index) => (newEx.perSet ? newEx.reps[index] : newEx.repsAll)?.trim() || "8-12"),
                    };
                    setSessions(prev => prev.map((s, i) => i === addExerciseModal ? {
                      ...s, exercises: editingExerciseIdx === null
                        ? [...(s.exercises || []), exercise]
                        : s.exercises.map((existing, index) => index === editingExerciseIdx ? { ...existing, ...exercise } : existing),
                    } : s));
                    setAddExerciseModal(null);
                    setEditingExerciseIdx(null);
                    setNewEx({ name: "", sets: 3, reps: [], repsAll: "", perSet: false, tempo: "" });
                  }}>{editingExerciseIdx === null ? "ADD ✓" : "SAVE ✓"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const planChangeIntro = [{
    role: "assistant",
    content: "Tell me what isn't working, or tap \"Review my plan and recommend changes\" and I'll suggest what I'd change from your workouts. I'll check whether you need a full rebuild, a few exercise swaps, or only set and rep changes. Your completed workout history will stay intact.",
  }];
  // The coach's proposal still waiting for approval, if any. Proposals live
  // on the coach message that made them, so the card shows under it.
  const pendingPlanProposal = (messages = planChangeMessages) => [...messages].reverse().find(message => ["pending", "saving"].includes(message.proposal?.status))?.proposal || null;
  const updatePlanProposal = (id, changes) => setPlanChangeMessages(current => current.map(message => (message.proposal?.id === id ? { ...message, proposal: { ...message.proposal, ...changes } } : message)));
  // What the changes would do to the plan, before → after.
  const makePlanProposal = changes => {
    const summary = planChangeSummary(sessions, changes);
    return {
      id: `proposal-${Date.now()}`,
      changes,
      lines: summary.lines.length ? summary.lines : changes.map(describePlanChange),
      notes: summary.changed && summary.unmatched.length ? [`Not in your plan, so left out: ${summary.unmatched.join("; ")}.`] : [],
      status: summary.changed ? "pending" : "unusable",
      error: "",
    };
  };

  const openPlanChangeCoach = () => {
    // A change still waiting for approval keeps its conversation.
    if (!planChangeHasPending) {
      setPlanChangeMessages(planChangeIntro);
      setPlanChangeRecommendation(null);
    }
    setPlanChangeInput("");
    setPlanChangeOpen(true);
  };

  const askPlanChangeCoach = async (suggestedMessage, baseMessages = planChangeMessages) => {
    const message = String(suggestedMessage || planChangeInput).trim();
    if (!message || planChangeLoading) return;
    // Close the phone keyboard so the screen returns to its normal size.
    document.activeElement?.blur?.();
    const nextMessages = [...baseMessages, { role: "user", content: message }];
    setPlanChangeInput("");
    const pending = pendingPlanProposal(baseMessages);
    // "I approve" in words: only the card saves, so point to it.
    if (pending && isApprovalReply(message)) {
      setPlanChangeMessages([...nextMessages, { role: "assistant", content: "That change isn't saved yet. Tap APPROVE & SAVE on the Proposed change card to save it, or DISCARD to keep your plan as it is." }]);
      setPlanChangeHighlight(count => count + 1);
      return;
    }
    setPlanChangeMessages(nextMessages);
    setPlanChangeLoading(true);
    setPlanChangeRecommendation(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in to use Coach.");
      const response = await fetch("/api/plan-change", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          messages: nextMessages.filter(item => item.role === "user" || item.role === "assistant").map(({ role, content }) => ({ role, content })),
          currentPlan: sessions,
          recentWorkouts: history.slice(0, 30),
          // So the coach knows a change is already waiting in its card.
          pendingChanges: pending?.lines || [],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Coach request failed");
      const proposal = result.changes?.length ? makePlanProposal(result.changes) : null;
      // A newer proposal replaces one still waiting.
      setPlanChangeMessages(current => [
        ...current.map(item => (proposal && item.proposal?.status === "pending" ? { ...item, proposal: { ...item.proposal, status: "replaced" } } : item)),
        { role: "assistant", content: result.message, ...(proposal ? { proposal } : {}) },
      ]);
      setPlanChangeRecommendation(result);
    } catch (error) {
      setPlanChangeMessages(current => [...current, { role: "assistant", content: error.message || "I couldn't review the plan just now. Please try again." }]);
    } finally {
      setPlanChangeLoading(false);
    }
  };

  // APPROVE & SAVE on a Proposed change card.
  const approvePlanProposal = async id => {
    const proposal = planChangeMessages.find(item => item.proposal?.id === id)?.proposal;
    if (!proposal || proposal.status !== "pending") return;
    const updated = applyPlanChangeProposal(sessions, proposal.changes);
    if (JSON.stringify(updated) === JSON.stringify(sessions)) {
      updatePlanProposal(id, { status: "unusable", error: "" });
      return;
    }
    updatePlanProposal(id, { status: "saving", error: "" });
    const saved = await saveSplit(updated);
    if (!saved.ok) {
      updatePlanProposal(id, { status: "pending", error: `Not saved: ${saved.error}. Your plan has not changed. Please try again.` });
      return;
    }
    updatePlanProposal(id, { status: "saved", error: "" });
    setPlanChangeMessages(previous => [...previous, { role: "assistant", content: "Saved: those changes are now in your plan. Your completed workout and exercise history has not been removed." }]);
  };
  const discardPlanProposal = id => {
    updatePlanProposal(id, { status: "discarded", error: "" });
    setPlanChangeMessages(previous => [...previous, { role: "assistant", content: "OK, your plan stays as it is. Tell me if you'd like a different change." }]);
  };

  // Go straight to the AI builder, pre-filling answers from the coach chat and
  // asking only what the chat did not cover. The current plan stays in place
  // until the new one is saved.
  const startFullPlanRebuild = async () => {
    if (planRebuildPreparing) return;
    setPlanRebuildPreparing(true);
    const transcript = planChangeMessages.map(message => `${message.role === "user" ? "User" : "Coach"}: ${message.content}`).join("\n");
    let answers = {};
    // Ask the model to read the chat, retrying once if the reply is unusable.
    for (let attempt = 0; attempt < 2 && !Object.keys(answers).length; attempt++) {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: await chatHeaders(),
          body: JSON.stringify({
            responseTokens: 1500,
            area: "questionnaire_extract",
            context: `GOAL OPTIONS: ${JSON.stringify(AI_QUESTIONS[0].options)}`,
            messages: [{ role: "user", content: `CONVERSATION\n${transcript}\n\nReturn the JSON object now.` }],
          }),
        });
        if (!response.ok) throw new Error(`Extraction request failed (${response.status})`);
        const data = await response.json();
        const parsed = extractJsonObject(data.content?.map(block => block.text || "").join("") || "");
        answers = questionnaireAnswersFromExtraction(parsed, AI_QUESTIONS[0].options);
      } catch (error) {
        console.warn("Could not pre-fill answers from the coach chat:", error.message);
      }
    }
    setAiPrefillNote(Object.keys(answers).length ? "" : "We could not read your answers from the coach chat, so please answer the questions below.");
    const missing = AI_QUESTIONS.filter(question => !aiAnswerText(question, answers).trim()).map(question => question.id);
    setPlanRebuildPreparing(false);
    setPlanChangeOpen(false);
    setAiStep(0);
    setAiAnswers(answers);
    setAiPlan(null);
    setAiPlanError("");
    setAiChatContext(transcript);
    setAiQuestionIds(missing);
    setView("ai_builder");
    if (!missing.length) buildAIPlan(answers, transcript);
  };

  const planChangeDialog = planChangeOpen ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 220, padding: 18 }}>
      <div className="t3d-card" role="dialog" aria-modal="true" aria-labelledby="plan-change-title" style={{ width: "100%", maxWidth: 620, maxHeight: "90dvh", overflowY: "auto", borderColor: "rgba(0,200,255,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h2 id="plan-change-title" className="t3d-ctitle" style={{ color: NEON2, margin: 0 }}>REVIEW PLAN WITH COACH</h2>
          <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setPlanChangeOpen(false)}>CLOSE</button>
        </div>
        <div style={{ padding: "9px 11px", marginBottom: 12, background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.2)", borderRadius: 6, color: "#9CB3BD", fontSize: 10, lineHeight: 1.5 }}>
          Nothing changes until you approve it. Completed workouts and exercise records remain in your history.
        </div>
        <div ref={planChangeLogRef} role="log" aria-live="polite" style={{ maxHeight: "min(52dvh, 420px)", overflowY: "auto", marginBottom: 12 }}>
          {(planChangeMessages.length ? planChangeMessages : planChangeIntro).map((message, index) => (
            <Fragment key={index}>
              <div className="t3d-ai-msg" style={{ background: message.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2, border: `1px solid ${message.role === "user" ? "rgba(0,200,255,.18)" : "rgba(0,255,178,.12)"}` }}>
                <div className="t3d-ai-tag" style={{ color: message.role === "user" ? NEON2 : NEON }}>{message.role === "user" ? "YOU" : "COACH"}</div>
                <span style={{ whiteSpace: "pre-wrap", color: "#C7D6DC" }}>{message.role === "assistant" ? cleanAiText(message.content) : message.content}</span>
              </div>
              {message.proposal && (
                <ProposedChangeCard lines={message.proposal.lines} notes={message.proposal.notes} status={message.proposal.status} error={message.proposal.error} highlight={planChangeHighlight}
                  onApprove={() => approvePlanProposal(message.proposal.id)} onDiscard={() => discardPlanProposal(message.proposal.id)} />
              )}
            </Fragment>
          ))}
          {planChangeLoading && <div style={{ color: "#6F8792", fontSize: 10, padding: 8 }}>Coach is reviewing your plan and history...</div>}
        </div>

        {planChangeMessages.length === 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {["Review my plan and recommend changes", "A few exercises don't suit me", "I want to change sets or reps", "My available days changed", "My main goal changed", "I think I need a full rebuild"].map(prompt => (
              <button key={prompt} className="t3d-btn t3d-btn-sm" style={{ fontSize: 8 }} onClick={() => askPlanChangeCoach(prompt)}>{prompt}</button>
            ))}
          </div>
        )}

        {planChangeRecommendation?.recommendation === "full_rebuild" && (
          <div style={{ marginBottom: 12, padding: 11, background: "rgba(255,45,120,.05)", border: "1px solid rgba(255,45,120,.3)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: "#C9D7DC", lineHeight: 1.55, marginBottom: 9 }}>The coach recommends rebuilding the programme. Your existing plan stays saved until a replacement is completed, and all workout history remains.</div>
            <button className="t3d-btn t3d-btn-red" style={{ width: "100%" }} disabled={planRebuildPreparing} onClick={startFullPlanRebuild}>{planRebuildPreparing ? "PREPARING YOUR QUESTIONS..." : "CONTINUE TO FULL PLAN REBUILD"}</button>
          </div>
        )}

        <button type="button" onClick={openImport} style={{ display: "block", background: "none", border: 0, color: "#8AABB8", fontSize: 10, textDecoration: "underline", cursor: "pointer", padding: "4px 0 10px" }}>Have a new plan from your own coach? Import it instead</button>
        <div style={{ display: "flex", gap: 7 }}>
          <input className="t3d-ai-input" placeholder="Tell the coach what you want to change..." value={planChangeInput} onChange={event => setPlanChangeInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); askPlanChangeCoach(); } }} />
          <button className="t3d-btn t3d-btn-sm" onClick={() => askPlanChangeCoach()} disabled={planChangeLoading || !planChangeInput.trim()}>{planChangeLoading ? "REVIEWING..." : "SEND"}</button>
        </div>
      </div>
    </div>
  ) : null;

  const beginHistoryEdit = () => {
    setHistoryEditOriginal(structuredClone(viewingSession));
    setEditingHistorySession(true);
    setViewingExercise(null);
  };

  const cancelHistoryEdit = () => {
    setViewingSession(historyEditOriginal);
    setHistoryEditOriginal(null);
    setEditingHistorySession(false);
  };

  const updateHistorySet = (exerciseIndex, setIndex, field, value) => {
    setViewingSession(current => ({
      ...current,
      exercises: (current.exercises || []).map((exercise, index) => index !== exerciseIndex ? exercise : {
        ...exercise,
        sets: (exercise.sets || []).map((set, index2) => index2 === setIndex ? { ...set, [field]: value } : set),
      }),
    }));
  };

  const deleteHistorySet = (exerciseIndex, setIndex) => {
    setViewingSession(current => ({
      ...current,
      exercises: (current.exercises || []).map((exercise, index) => index !== exerciseIndex ? exercise : {
        ...exercise,
        sets: (exercise.sets || []).filter((_, index2) => index2 !== setIndex).map((set, index2) => ({ ...set, setNum: index2 + 1 })),
      }),
    }));
  };

  const saveHistoryEdit = async () => {
    if (!viewingSession?.id || historySaving) return;
    setHistorySaving(true);
    try {
      const updated = { ...viewingSession, total_volume: workoutVolume(viewingSession.exercises || []) };
      const { error } = await supabase.from("workout_logs").update({ exercises: updated.exercises, total_volume: updated.total_volume }).eq("id", updated.id).eq("user_id", user.id);
      if (error) throw error;

      const { data: structuredSession } = await supabase.from("training_sessions").select("id").eq("user_id", user.id).eq("legacy_workout_log_id", String(updated.id)).maybeSingle();
      if (structuredSession?.id) {
        const { error: deleteError } = await supabase.from("training_sets").delete().eq("user_id", user.id).eq("session_id", structuredSession.id);
        if (deleteError) throw deleteError;
        const rows = (updated.exercises || []).flatMap(exercise => (exercise.sets || []).map((set, index) => ({
          user_id: user.id,
          session_id: structuredSession.id,
          exercise_key: exerciseKey(exercise.name),
          exercise_name: exercise.name,
          set_index: index + 1,
          set_kind: "working",
          weight: Number(set.weight) || null,
          reps: Number(set.reps) || null,
          performed_at: updated.created_at || new Date(`${updated.date}T12:00:00Z`).toISOString(),
        })));
        if (rows.length) {
          const { error: insertError } = await supabase.from("training_sets").insert(rows);
          if (insertError) throw insertError;
        }
      }

      setHistory(current => current.map(log => log.id === updated.id ? updated : log));
      setViewingSession(updated);
      setHistoryEditOriginal(null);
      setEditingHistorySession(false);
    } catch (error) {
      console.error("Workout history edit error:", error.message);
    } finally {
      setHistorySaving(false);
    }
  };

  const confirmDeleteHistoryWorkout = async () => {
    if (!deleteHistoryWorkout?.id || historySaving) return;
    setHistorySaving(true);
    try {
      const legacyId = String(deleteHistoryWorkout.id);
      const { data: structuredSessions, error: lookupError } = await supabase.from("training_sessions").select("id").eq("user_id", user.id).eq("legacy_workout_log_id", legacyId);
      if (lookupError) throw lookupError;
      const structuredIds = (structuredSessions || []).map(session => session.id);
      if (structuredIds.length) {
        const { error: structuredDeleteError } = await supabase.from("training_sessions").delete().eq("user_id", user.id).in("id", structuredIds);
        if (structuredDeleteError) throw structuredDeleteError;
      }
      const { error } = await supabase.from("workout_logs").delete().eq("id", deleteHistoryWorkout.id).eq("user_id", user.id);
      if (error) throw error;
      setHistory(current => current.filter(log => log.id !== deleteHistoryWorkout.id));
      setViewingSession(null);
      setViewingExercise(null);
      setEditingHistorySession(false);
      setHistoryEditOriginal(null);
      setDeleteHistoryWorkout(null);
    } catch (error) {
      console.error("Workout delete error:", error.message);
      setWorkoutSaveError("This workout could not be deleted. Please try again.");
    } finally {
      setHistorySaving(false);
    }
  };

  const moveScheduledWorkout = async (sessionName, sourceDay, targetDay) => {
    const updated = moveWorkoutDay(sessions, sessionName, sourceDay, targetDay);
    if (updated === sessions) return;
    const previousSessions = sessions;
    setSessions(updated); // show the move straight away, undo it if the save fails
    const saved = await saveSplit(updated);
    if (!saved.ok) {
      setSessions(previousSessions);
      setPlanSaveError(`${sessionName} was not moved: ${saved.error}. Your plan has not changed.`);
    } else {
      setPlanSaveError("");
    }
  };

  const finishWorkoutDayDrag = async (targetDay) => {
    if (!draggedWorkoutDay) return;
    const dragged = draggedWorkoutDay;
    setDraggedWorkoutDay(null);
    await moveScheduledWorkout(dragged.sessionName, dragged.sourceDay, targetDay);
  };

  const cancelSessionEdits = () => {
    setSessions(normalizeFitnessSessions(split?.sessions || []));
    setEditDaysModal(false);
  };

  const askPlanCoach = async (suggestedQuestion) => {
    const question = (suggestedQuestion || coachQuestion).trim();
    if (!question || coachLoading) return;
    // This chat cannot change the saved plan. Requests to change it go to the
    // Change Plan coach, which proposes the change for approval and saves it.
    if (split && isPlanChangeRequest(question)) {
      setCoachMessages([...coachMessages, { role: "user", content: question }, { role: "assistant", content: "Plan changes are made in Change Plan, where you see the exact change and approve it before it's saved. Tap OPEN CHANGE PLAN to send it your request.", openChangePlan: question }]);
      setCoachQuestion("");
      return;
    }
    // Close the phone keyboard so the screen returns to its normal size.
    document.activeElement?.blur?.();

    const updatedMessages = [...coachMessages, { role: "user", content: question }];
    setCoachMessages(updatedMessages);
    setCoachQuestion("");
    setCoachLoading(true);

    const planSummary = sessions.map(session => {
      const exercises = (session.exercises || []).map(exercise => {
        const reps = splitRepTargets(exercise.reps).join("/");
        return `${exercise.name} (${exercise.sets || 0} sets, ${reps || "reps not set"})`;
      }).join(", ");
      return `${session.name} [${(session.days || []).join(", ") || "not scheduled"}]: ${exercises || "no exercises"}`;
    }).join("\n");
    const recentWorkouts = recentWorkoutsForCoach(history);

    try {
      const reply = await streamCoachText({
        area: "plan_coach",
        context: `Home timezone: ${homeTimeZone}. Local date and time: ${homeDate.weekday}, ${homeDate.dateKey} at ${homeDate.time}.\n\nCURRENT PLAN:\n${planSummary}\n\nRECENT WORKOUTS:\n${recentWorkouts}`,
        messages: recentChatMessages(updatedMessages),
      }, text => setCoachMessages([...updatedMessages, { role: "assistant", content: text }]));
      setCoachMessages([...updatedMessages, { role: "assistant", content: reply }]);
    } catch {
      setCoachMessages([...updatedMessages, { role: "assistant", content: "I couldn't connect just now. Please try again." }]);
    } finally {
      setCoachLoading(false);
    }
  };

  const askApprovalCoach = async () => {
    const question = approvalQuestion.trim();
    if (!question || approvalLoading) return;
    // Close the phone keyboard so the screen returns to its normal size.
    document.activeElement?.blur?.();
    const updated = [...approvalMessages, { role: "user", content: question }];
    const reviewedSessions = approvalReview === "all" ? sessions : [sessions[approvalReview]].filter(Boolean);
    setApprovalMessages(updated);
    setApprovalQuestion("");
    setApprovalLoading(true);
    try {
      const reply = await streamCoachText({
        area: "plan_approval",
        context: `Home timezone: ${homeTimeZone}.`,
        messages: [{ role: "user", content: `Programme under review: ${JSON.stringify(reviewedSessions)}` }, ...updated],
      }, text => setApprovalMessages([...updated, { role: "assistant", content: text }]));
      setApprovalMessages([...updated, { role: "assistant", content: reply }]);
    } catch { setApprovalMessages([...updated, { role: "assistant", content: "I could not connect just now. Please try again." }]); }
    setApprovalLoading(false);
  };

  // ── HOME VIEW ─────────────────────────────────────────────────────────────
  const dayCodes = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  const dayNames = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
  const getSessionForDayCode = (dayCode) => {
    const fullDay = dayNames[dayCodes.indexOf(dayCode)];
    return sessions.find(session => session.days?.some(day => {
      const savedDay = String(day).toUpperCase();
      return savedDay === dayCode || fullDay?.startsWith(savedDay);
    })) || null;
  };
  const todaySession = getSessionForDayCode(homeDate.dayCode);
  const homeTodayAnchor = new Date(`${today}T12:00:00Z`);
  let missedRecommendation = null;
  // Only days after the plan was created can have a missed session, and only
  // this week's (Monday to Sunday): a session missed last week is not carried over.
  const planStartKey = split?.programme_started_at ? getZonedDateInfo(new Date(split.programme_started_at), homeTimeZone).dateKey : null;
  const currentWeekStartKey = shiftDateKey(today, -((homeTodayAnchor.getUTCDay() + 6) % 7));
  for (let daysAgo = 1; daysAgo <= 7; daysAgo += 1) {
    const scheduledDate = new Date(homeTodayAnchor);
    scheduledDate.setUTCDate(scheduledDate.getUTCDate() - daysAgo);
    const dateKey = scheduledDate.toISOString().slice(0, 10);
    if (dateKey < currentWeekStartKey) break;
    if (planStartKey && dateKey <= planStartKey) break;
    const scheduledSession = getSessionForDayCode(dayCodes[scheduledDate.getUTCDay()]);
    if (!scheduledSession) continue;
    const trainedSince = history.some(log => log.session_name?.toLowerCase() === scheduledSession.name?.toLowerCase() && log.date >= dateKey && log.date <= today);
    if (!trainedSince) {
      missedRecommendation = {
        session: scheduledSession,
        dayLabel: scheduledDate.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long" }),
      };
      break;
    }
  }
  // Today's own session is the one suggested. A session missed earlier this
  // week is only offered as an optional catch-up.
  const recommendedSession = todaySession;
  const recommendedDoneToday = Boolean(recommendedSession && history.some(log => log.date === today && log.session_name?.toLowerCase() === recommendedSession.name?.toLowerCase()));
  const trainedToday = history.some(log => log.date === today && (Number(log.total_volume) > 0 || (Number(log.duration_mins) || 0) >= 2));
  const completedTodayNames = [...new Set(history.filter(log => log.date === today && (Number(log.total_volume) > 0 || (Number(log.duration_mins) || 0) >= 2)).map(log => log.session_name).filter(Boolean))];
  const doneForToday = !(workoutInProgress && activeSession) && (recommendedDoneToday || trainedToday);
  // No session on today's day of the plan: say so first. A missed session is
  // only an optional catch-up, not the day's workout.
  const restDay = !todaySession && sessions.length > 0;
  let nextScheduled = null;
  for (let daysAhead = 1; daysAhead <= 7 && !nextScheduled; daysAhead += 1) {
    const date = new Date(homeTodayAnchor);
    date.setUTCDate(date.getUTCDate() + daysAhead);
    const session = getSessionForDayCode(dayCodes[date.getUTCDay()]);
    if (session) nextScheduled = { session, dayLabel: daysAhead === 1 ? "tomorrow" : date.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long" }) };
  }
  const activeCompletedSets = Object.values(completedSets).reduce((total, sets) => total + sets.length, 0);
  const activeTotalSets = activeSession?.exercises?.reduce((total, exercise) => total + (Number(exercise.sets) || 0), 0) || 0;
  const programmeApproved = sessions.some(session => !isActivitySession(session)) && sessions.filter(session => !isActivitySession(session)).every(session => session.approval?.approved);
  const weekStartAnchor = new Date(homeTodayAnchor);
  weekStartAnchor.setUTCDate(weekStartAnchor.getUTCDate() - ((homeTodayAnchor.getUTCDay() + 6) % 7));
  const weekStartKey = weekStartAnchor.toISOString().slice(0, 10);
  // Sessions abandoned straight after starting (nothing lifted, under 2 minutes) are not real workouts.
  const isEmptyWorkout = log => !activityOfLog(log) && !(Number(log.total_volume) > 0) && (Number(log.duration_mins) || 0) < 2;
  const realHistory = history.filter(log => !isEmptyWorkout(log));
  const emptyHistoryCount = history.length - realHistory.length;
  const formatLogDate = dateKey => {
    const parsed = new Date(`${dateKey}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? dateKey : parsed.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  const thisWeekLogs = realHistory.filter(h => {
    return h.date >= weekStartKey && h.date <= today;
  });
  // A run or other activity is not a lifting session: counted on its own.
  const thisWeekActivities = thisWeekLogs.filter(log => activityOfLog(log)).length;
  const thisWeekSessions = thisWeekLogs.length - thisWeekActivities;
  const last6Days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(homeTodayAnchor);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const dateKey = date.toISOString().slice(0, 10);
    return {
      date: dateKey,
      day: date.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" }).toUpperCase(),
      dateLabel: date.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }),
      workouts: realHistory.filter(log => log.date === dateKey),
      isToday: dateKey === today,
    };
  });
  const pendingMinuteLimit = parseInt(availableMinutes, 10);
  const pendingTimedSession = pendingSession ? fitSessionToMinutes(pendingSession, pendingMinuteLimit) : null;

  const programmeStartedAt = split?.programme_started_at ? new Date(split.programme_started_at) : null;
  const weekAlreadyReviewed = Boolean(split?.week_reviewed_at);
  const weekReviewDue = Boolean(programmeStartedAt) && !weekAlreadyReviewed && !weekReviewDismissed
    && (Date.now() - programmeStartedAt.getTime() >= 7 * 24 * 60 * 60 * 1000);
  const startWeekReview = async () => {
    const sessionsSince = history.filter(log => programmeStartedAt && new Date(log.created_at) >= programmeStartedAt).length;
    setWeekReviewPrompt(`It's been a week since I started this programme (${sessions.map(s => s.name).join(", ") || "current split"}). I've logged ${sessionsSince} session${sessionsSince === 1 ? "" : "s"} since then. Talk me through how the week's gone - adherence, progression, anything that felt off - and suggest any worthwhile changes.`);
    const saved = await saveSplit(sessions, { week_reviewed_at: new Date().toISOString() });
    if (!saved.ok) setPlanSaveError(`The week review could not be recorded: ${saved.error}. You may be asked again.`);
  };

  return (
    <div className="t3d-fade">
      {!split ? (
        <>
        <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, letterSpacing: 3, color: NEON, marginBottom: 8 }}>FITNESS</div>
          <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 28, lineHeight: 1.7 }}>Set up your training programme.<br />Track every session. Beat every record.</div>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px", maxWidth: 260 }}>
              <button className="t3d-btn" style={{ padding: "14px 20px", fontSize: 10, width: "100%" }} onClick={() => { setSetupStep(0); setView("setup"); }}>📋 BUILD MY SPLIT</button>
              <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 7, lineHeight: 1.5 }}>For people who already know the exercises, sets and reps they want.</div>
            </div>
            <div style={{ flex: "1 1 200px", maxWidth: 260 }}>
              <button className="t3d-btn" style={{ padding: "14px 20px", fontSize: 10, width: "100%", borderColor: "rgba(0,200,255,.3)", color: NEON2 }}
                onClick={openAiBuilder}>🤖 AI BUILD MY PROGRAMME</button>
              <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 7, lineHeight: 1.5 }}>For beginners or anyone who wants a plan built from a few questions.</div>
            </div>
            <div style={{ flex: "1 1 200px", maxWidth: 260 }}>
              <button className="t3d-btn" style={{ padding: "14px 20px", fontSize: 10, width: "100%", borderColor: "rgba(255,181,71,.35)", color: "#FFB547" }} onClick={openImport}>📥 IMPORT MY PLAN</button>
              <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 7, lineHeight: 1.5 }}>Already have a programme from a coach? Paste it in and check it before saving.</div>
            </div>
          </div>
          <div style={{ marginTop: 20, fontSize: 10, color: "#2A3A48", lineHeight: 1.6 }}>TRACK3D provides general fitness guidance. Consult a qualified professional before starting any new exercise programme. Not medical advice.</div>
        </div>
        {planCoachCard}
        </>
      ) : (
        <>
          {weekReviewDue && (
            <div className="t3d-card" style={{ marginBottom: 16, borderColor: NEON, background: "rgba(0,255,178,.05)" }}>
              <h2 style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, fontWeight: 400, color: NEON, letterSpacing: 2, margin: "0 0 8px" }}>ONE WEEK IN</h2>
              <div style={{ fontSize: 11, color: "#E0EAF0", marginBottom: 12, lineHeight: 1.6 }}>It's been a week since you started this programme. Want to review how it's gone with your coach and make any changes?</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button className="t3d-btn" onClick={startWeekReview}>REVIEW MY WEEK</button>
                <button type="button" onClick={() => setWeekReviewDismissed(true)} style={{ background: "none", border: 0, color: "#4A6070", cursor: "pointer", fontSize: 9, minHeight: 44, padding: "0 6px", textDecoration: "underline" }}>remind me later</button>
              </div>
            </div>
          )}
          <div className="t3d-card" style={{ marginBottom: 16 }}>
            <h2 className="t3d-ctitle" style={{ color: restDay && !doneForToday && !(workoutInProgress && activeSession) ? NEON2 : NEON }}>{workoutInProgress && activeSession ? "ACTIVE WORKOUT" : doneForToday ? "TODAY" : restDay ? "TODAY" : "RECOMMENDED NEXT SESSION"}</h2>
            {workoutInProgress && activeSession ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 22, color: "#E0EAF0", letterSpacing: 2, marginBottom: 8, overflowWrap: "anywhere" }}>{activeSession.name}</div>
                    <div data-testid="active-workout-line" style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 4 }}>{workoutProgressLine({ activeSession, exerciseIdx, completedSets }).split(" · ").slice(1).join(" · ")}</div>
                    <div style={{ fontSize: 11, color: NEON2 }}>{activeCompletedSets} of {activeTotalSets} sets completed · progress saved</div>
                  </div>
                  <button className="t3d-big-btn" style={{ flex: "0 1 300px", margin: 0, background: "linear-gradient(90deg, rgba(0,255,178,.18), rgba(0,200,255,.18))", border: `1px solid ${NEON}`, color: NEON, fontSize: 12, letterSpacing: 2 }} onClick={() => setView("workout")}>
                    ▶ CONTINUE ACTIVE WORKOUT
                  </button>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 12, fontSize: 10, color: "#6F8792" }}>
                  <span>Not this one?</span>
                  <button type="button" onClick={() => openWorkoutOptions(activeSession)} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Restart it</button>
                  <button type="button" onClick={openOtherWorkouts} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Switch workout</button>
                  <button type="button" onClick={() => setDiscardWorkoutWarning(true)} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Delete it</button>
                </div>
              </div>
            ) : (recommendedDoneToday || trainedToday) ? (
              <div>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: NEON, letterSpacing: 2, marginBottom: 8 }}>DONE FOR TODAY ✓</div>
                {completedTodayNames.length > 0 && <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 6 }}>{completedTodayNames.join(" + ")} completed</div>}
                <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>
                  {nextScheduled ? `Next scheduled: ${nextScheduled.session.name}, ${nextScheduled.dayLabel}.` : "No more sessions scheduled this week."}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 10, color: "#6F8792" }}>
                  <span>Want to train again?</span>
                  {recommendedSession && <button type="button" onClick={() => requestStartWorkout(recommendedSession)} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Repeat {recommendedSession.name}</button>}
                  <button type="button" onClick={openOtherWorkouts} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Choose a workout</button>
                </div>
              </div>
            ) : restDay ? (
              <div data-testid="rest-day">
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 22, color: NEON2, letterSpacing: 2, marginBottom: 6 }}>REST DAY</div>
                <div style={{ fontSize: 12, color: "#C5D6DC", lineHeight: 1.6 }}>Nothing is scheduled today. Rest is part of the plan.</div>
                {/* The next day of the plan is the main suggestion. */}
                {nextScheduled && (
                  <div data-testid="next-session" style={{ marginTop: 14, padding: 12, border: `1px solid ${BORDER}`, borderRadius: 7, background: SURFACE2 }}>
                    <div style={{ fontSize: 9, color: NEON, letterSpacing: 1, marginBottom: 6 }}>NEXT SESSION · {nextScheduled.dayLabel.toUpperCase()}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: "#E0EAF0", letterSpacing: 1.5, overflowWrap: "anywhere", minWidth: 0 }}>{nextScheduled.session.name}</div>
                      <PlanPreviewButton label={`View ${nextScheduled.session.name} ${isActivitySession(nextScheduled.session) ? "details" : "exercises"}`} onClick={() => setPlanPreview({
                        title: "NEXT SESSION",
                        entries: [{ session: nextScheduled.session, label: nextScheduled.dayLabel.toUpperCase() }],
                      })} />
                    </div>
                    <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 4 }}>{isActivitySession(nextScheduled.session) ? `${activityTypeLabel(nextScheduled.session.activityType)} · ${sessionPlannedMinutes(nextScheduled.session)} min` : `${exerciseCountText(nextScheduled.session)} · about ${sessionPlannedMinutes(nextScheduled.session)} min`}</div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 10, color: "#6F8792" }}>
                  <span>Want to train anyway?</span>
                  {missedRecommendation && <button type="button" data-testid="catch-up" onClick={() => requestStartWorkout(missedRecommendation.session)} style={{ background: "none", border: 0, color: "#FF8C00", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Catch up {missedRecommendation.session.name} (missed {missedRecommendation.dayLabel})</button>}
                  <button type="button" onClick={openOtherWorkouts} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Choose a workout</button>
                </div>
              </div>
            ) : recommendedSession ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 22, color: "#E0EAF0", letterSpacing: 2, overflowWrap: "anywhere", minWidth: 0 }}>{recommendedSession.name}</div>
                    <PlanPreviewButton label={`View ${recommendedSession.name} ${isActivitySession(recommendedSession) ? "details" : "exercises"}`} onClick={() => setPlanPreview({
                      title: "TODAY'S WORKOUT",
                      entries: [{ session: recommendedSession, label: "TODAY" }],
                    })} />
                  </div>
                  <div style={{ fontSize: 11, color: "#8AABB8" }}>
                    Scheduled for today · {isActivitySession(recommendedSession) ? `${activityTypeLabel(recommendedSession.activityType)} · ${sessionPlannedMinutes(recommendedSession)} min` : exerciseCountText(recommendedSession)}
                  </div>
                  {!recommendedSession.approval?.approved && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, color: "#FFB547", fontSize: 8 }}>
                      <span>AWAITING YOUR APPROVAL</span>
                      <button className="t3d-btn t3d-btn-sm" style={{ padding: "4px 8px", minHeight: 44, borderColor: "#FFB547", color: "#FFB547" }} onClick={() => { setApprovalMessages([]); setApprovalReview(sessions.indexOf(recommendedSession)); }}>REVIEW &amp; APPROVE</button>
                    </div>
                  )}
                </div>
                <button className="t3d-big-btn" style={{ flex: "0 1 300px", margin: 0, background: "linear-gradient(90deg, #00FFB2, #00D99A)", border: `1px solid ${NEON}`, color: "#06100D", fontSize: 13, fontWeight: 900, letterSpacing: 2, boxShadow: "0 0 22px rgba(0,255,178,.24)" }} onClick={() => requestStartWorkout(recommendedSession)}>
                  {isActivitySession(recommendedSession) ? `▶ LOG ${recommendedSession.name.toUpperCase()}` : "▶ START WORKOUT"}
                </button>
                {!isActivitySession(recommendedSession) && <button type="button" onClick={() => openWorkoutOptions(recommendedSession)} style={{ flexBasis: "100%", background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "4px 0", minHeight: 44, textAlign: "right", textDecoration: "underline" }}>
                  Short on time or at a different gym?
                </button>}
                {missedRecommendation && missedRecommendation.session !== recommendedSession && (
                  <div data-testid="catch-up" style={{ flexBasis: "100%", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", fontSize: 10, color: "#6F8792" }}>
                    <span>Missed {missedRecommendation.session.name} on {missedRecommendation.dayLabel}?</span>
                    <button type="button" onClick={() => requestStartWorkout(missedRecommendation.session)} style={{ background: "none", border: 0, color: "#FF8C00", cursor: "pointer", fontSize: 10, padding: "5px 6px", minHeight: 44, textDecoration: "underline" }}>Do it today instead</button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>
                No session scheduled today.{nextScheduled ? ` Next: ${nextScheduled.session.name}, ${nextScheduled.dayLabel}.` : ""} Choose any workout below.
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
              <span style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, color: "#4A6070", letterSpacing: 1 }}>REST TIMER</span>
              <button className="t3d-btn t3d-btn-sm" style={{ padding: "5px 9px", minHeight: 44, minWidth: 44, background: restTimerEnabled ? "rgba(0,255,178,.12)" : "transparent", borderColor: restTimerEnabled ? NEON : BORDER }} onClick={() => {
                const enabled = !restTimerEnabled;
                setRestTimerEnabled(enabled);
                if (!enabled) { setRestActive(false); setRestDeadline(null); }
              }}>{restTimerEnabled ? "ON" : "OFF"}</button>
              {restTimerEnabled && (
                <>
                  {[60,90,120].map(seconds => (
                    <button key={seconds} className="t3d-btn t3d-btn-sm" style={{ padding: "5px 9px", minHeight: 44, minWidth: 44, borderColor: restSeconds === seconds ? NEON : BORDER, color: restSeconds === seconds ? NEON : "#4A6070" }} onClick={() => setRestSeconds(seconds)}>{seconds}s</button>
                  ))}
                  {restActive && <span style={{ marginLeft: "auto", fontFamily: "'Orbitron',monospace", fontSize: 13, color: NEON2 }}>{restRemaining}s</span>}
                </>
              )}
              <button
                className="t3d-btn t3d-btn-sm"
                style={{ padding: "5px 9px", minHeight: 44, minWidth: 44, marginLeft: restTimerEnabled ? 0 : "auto", borderColor: showOtherWorkouts ? NEON : BORDER, color: showOtherWorkouts ? NEON : "#8AABB8" }}
                onClick={() => showOtherWorkouts ? setShowOtherWorkouts(false) : openOtherWorkouts()}
              >
                OTHER WORKOUTS {showOtherWorkouts ? "▲" : "▼"}
              </button>
              <button className="t3d-btn t3d-btn-sm" data-testid="log-activity" style={{ padding: "5px 9px", minHeight: 44, minWidth: 44, borderColor: "rgba(0,200,255,.35)", color: NEON2 }} onClick={() => openActivityLog()}>+ LOG ACTIVITY</button>
            </div>
            {activityNotice && <div role="status" style={{ marginTop: 10, fontSize: 11, color: NEON }}>✓ {activityNotice}</div>}
          </div>

          {activityForm && (
            <div style={{ position: "fixed", inset: 0, height: "100dvh", background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 200 }}>
              <div className="t3d-card" role="dialog" aria-modal="true" aria-labelledby="activity-log-title" data-testid="activity-form" style={{ width: "100%", maxWidth: 400, maxHeight: "calc(100dvh - 40px)", overflowY: "auto" }}>
                <h2 id="activity-log-title" className="t3d-ctitle" style={{ color: NEON2 }}>LOG AN ACTIVITY</h2>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {ACTIVITY_TYPES.map(type => <button key={type.id} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={activityForm.type === type.id} style={{ borderColor: activityForm.type === type.id ? NEON2 : BORDER, color: activityForm.type === type.id ? NEON2 : "#8AABB8" }} onClick={() => setActivityForm(form => ({ ...form, type: type.id }))}>{type.label.toUpperCase()}</button>)}
                </div>
                <label style={{ display: "block", fontSize: 9, color: "#8AABB8", marginBottom: 10 }}>NAME (OPTIONAL)
                  <input className="t3d-input" aria-label="Activity name" placeholder={activityTypeLabel(activityForm.type)} value={activityForm.name} onChange={event => { const value = event.target.value; setActivityForm(form => ({ ...form, name: value })); }} style={{ marginTop: 5 }} />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: ACTIVITY_TYPES.find(type => type.id === activityForm.type)?.distance ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 10 }}>
                  <label style={{ fontSize: 9, color: "#8AABB8" }}>MINUTES (REQUIRED)
                    <input className="t3d-input" aria-label="Minutes" aria-describedby="activity-minutes-hint" required type="number" inputMode="numeric" min="2" placeholder="e.g. 45" value={activityForm.minutes} onChange={event => { const value = event.target.value; setActivityForm(form => ({ ...form, minutes: value })); }} style={{ marginTop: 5 }} />
                  </label>
                  {ACTIVITY_TYPES.find(type => type.id === activityForm.type)?.distance && <label style={{ fontSize: 9, color: "#8AABB8" }}>DISTANCE (KM, OPTIONAL)
                    <input className="t3d-input" aria-label="Distance in km" type="number" inputMode="decimal" min="0" placeholder="e.g. 5" value={activityForm.distanceKm} onChange={event => { const value = event.target.value; setActivityForm(form => ({ ...form, distanceKm: value })); }} style={{ marginTop: 5 }} />
                  </label>}
                </div>
                <div style={{ fontSize: 9, color: "#8AABB8", marginBottom: 6 }}>HOW HARD WAS IT?</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginBottom: 10 }}>
                  {ACTIVITY_EFFORTS.map(effort => <button key={effort.id} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={activityForm.effort === effort.id} style={{ fontSize: 8, padding: "8px 2px", borderColor: activityForm.effort === effort.id ? NEON2 : BORDER, color: activityForm.effort === effort.id ? NEON2 : "#8AABB8" }} onClick={() => setActivityForm(form => ({ ...form, effort: effort.id }))}>{effort.label.toUpperCase()}</button>)}
                </div>
                <input className="t3d-input" aria-label="Notes" placeholder="Notes (optional)" value={activityForm.notes} onChange={event => { const value = event.target.value; setActivityForm(form => ({ ...form, notes: value })); }} style={{ marginBottom: 10 }} />
                {activityError && <div role="alert" style={{ fontSize: 10, color: "#FFB547", marginBottom: 8 }}>{activityError}</div>}
                {/* Saving needs the minutes: the button stays off until they're in. */}
                {!(Number(activityForm.minutes) >= 2) && <div id="activity-minutes-hint" style={{ fontSize: 10, color: "#8AABB8", marginBottom: 8 }}>Enter the minutes (2 or more) to save.</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="t3d-btn t3d-btn-sm" style={{ minHeight: 44 }} onClick={() => setActivityForm(null)}>CANCEL</button>
                  <button className="t3d-btn" style={{ flex: 1, minHeight: 46, borderColor: NEON2, color: NEON2 }} disabled={activitySaving || !(Number(activityForm.minutes) >= 2)} onClick={saveActivityLog}>{activitySaving ? "SAVING..." : "SAVE ACTIVITY ✓"}</button>
                </div>
              </div>
            </div>
          )}

          {planActivityForm && (
            <div style={{ position: "fixed", inset: 0, height: "100dvh", background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 200 }}>
              <div className="t3d-card" role="dialog" aria-modal="true" aria-labelledby="plan-activity-title" data-testid="plan-activity-form" style={{ width: "100%", maxWidth: 400, maxHeight: "calc(100dvh - 40px)", overflowY: "auto" }}>
                <h2 id="plan-activity-title" className="t3d-ctitle" style={{ color: NEON2 }}>ADD AN ACTIVITY TO YOUR WEEK</h2>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {ACTIVITY_TYPES.map(type => <button key={type.id} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={planActivityForm.type === type.id} style={{ borderColor: planActivityForm.type === type.id ? NEON2 : BORDER, color: planActivityForm.type === type.id ? NEON2 : "#8AABB8" }} onClick={() => setPlanActivityForm(form => ({ ...form, type: type.id }))}>{type.label.toUpperCase()}</button>)}
                </div>
                <label style={{ display: "block", fontSize: 9, color: "#8AABB8", marginBottom: 10 }}>NAME (OPTIONAL)
                  <input className="t3d-input" aria-label="Planned activity name" placeholder={activityTypeLabel(planActivityForm.type)} value={planActivityForm.name} onChange={event => { const value = event.target.value; setPlanActivityForm(form => ({ ...form, name: value })); }} style={{ marginTop: 5 }} />
                </label>
                <div style={{ fontSize: 9, color: "#8AABB8", marginBottom: 6 }}>WHICH DAYS? <span style={{ color: "#6F8792" }}>· days with a workout are taken</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginBottom: 10 }}>
                  {DAYS.map(day => {
                    const taken = sessions.some(session => (session.days || []).some(saved => String(saved).toUpperCase().slice(0, 3) === day));
                    const chosen = planActivityForm.days.includes(day);
                    return <button key={day} type="button" className="t3d-btn t3d-btn-sm" aria-pressed={chosen} disabled={taken} style={{ fontSize: 8, padding: "8px 0", borderColor: chosen ? NEON2 : BORDER, color: chosen ? NEON2 : "#8AABB8" }} onClick={() => setPlanActivityForm(form => ({ ...form, days: chosen ? form.days.filter(item => item !== day) : [...form.days, day] }))}>{day}</button>;
                  })}
                </div>
                <label style={{ display: "block", fontSize: 9, color: "#8AABB8", marginBottom: 12 }}>ABOUT HOW LONG? (MIN)
                  <input className="t3d-input" aria-label="Planned minutes" type="number" inputMode="numeric" min="5" value={planActivityForm.minutes} onChange={event => { const value = event.target.value; setPlanActivityForm(form => ({ ...form, minutes: value })); }} style={{ marginTop: 5 }} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="t3d-btn t3d-btn-sm" onClick={() => setPlanActivityForm(null)}>CANCEL</button>
                  <button className="t3d-btn" style={{ flex: 1, minHeight: 46, borderColor: NEON2, color: NEON2 }} disabled={!planActivityForm.days.length} onClick={savePlanActivity}>ADD TO MY PLAN ✓</button>
                </div>
              </div>
            </div>
          )}

          {pendingSession && (
            <div style={{ position: "fixed", inset: 0, height: "100dvh", background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 200 }}>
              <div className="t3d-card" style={{ width: "100%", maxWidth: 380, maxHeight: "calc(100dvh - 40px)", overflowY: "auto" }}>
                <h2 className="t3d-ctitle" style={{ color: NEON }}>WORKOUT OPTIONS</h2>
                <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 14 }}>{pendingSession.name}</div>
                <label style={{ display: "block", fontSize: 9, color: "#8AABB8", marginBottom: 14 }}>
                  HOW MANY MINUTES DO YOU HAVE?
                  <input className="t3d-input" type="number" inputMode="numeric" min="1" placeholder="Leave blank for the full session" value={availableMinutes} onChange={event => setAvailableMinutes(event.target.value)} style={{ marginTop: 7 }} />
                  <span style={{ display: "block", marginTop: 5, color: "#6F8792" }}>Short on time? TRACK3D keeps the highest-priority exercises and trims the workload.</span>
                </label>
                {pendingTimedSession?.sessionAdjustment && <div style={{ padding: 10, marginBottom: 12, background: "rgba(255,181,71,.07)", border: "1px solid rgba(255,181,71,.25)", borderRadius: 6, color: "#FFD08A", fontSize: 10, lineHeight: 1.5 }}>{pendingTimedSession.sessionAdjustment}</div>}
                <div style={{ fontSize: 9, color: "#8AABB8", marginBottom: 7 }}>WHERE ARE YOU TRAINING?</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {[["usual","USUAL GYM"],["different","DIFFERENT GYM"],["away","ONE-OFF / AWAY"]].map(([value,label]) => (
                    <button key={value} className="t3d-btn t3d-btn-sm" style={{ borderColor: gymContext === value ? NEON : BORDER, color: gymContext === value ? NEON : "#8AABB8" }} onClick={() => setGymContext(value)}>{label}</button>
                  ))}
                </div>
                {gymContext === "different" && <input className="t3d-input" placeholder="Gym name (saved with its own weight history)" value={gymName} onChange={event => setGymName(event.target.value)} style={{ marginBottom: 12 }} />}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button className="t3d-btn t3d-btn-sm" onClick={() => setPendingSession(null)}>CANCEL</button>
                  <button className="t3d-btn" style={{ flex: 1, minHeight: 48, background: "linear-gradient(90deg, #00FFB2, #00D99A)", color: "#06100D", borderColor: NEON, fontWeight: 900 }} onClick={() => startOrConfirm(pendingSession, { minutes: availableMinutes, context: gymContext, name: gymName })} disabled={gymContext === "different" && !gymName.trim()}>START WORKOUT</button>
                </div>
              </div>
            </div>
          )}

          {showOtherWorkouts && <div ref={otherWorkoutsRef} className="t3d-card" style={{ marginBottom: 16, scrollMarginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <h2 className="t3d-ctitle" style={{ margin: 0 }}>OTHER WORKOUTS</h2>
              <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setShowOtherWorkouts(false)}>CLOSE ✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 9 }}>
              {sessions.filter(session => session !== recommendedSession).map((session, index) => (
                <button key={`${session.name}-${index}`} className="t3d-btn" onClick={() => requestStartWorkout(session)} disabled={!session.exercises?.length && !isActivitySession(session)}
                  style={{ minWidth: 0, width: "100%", minHeight: 78, display: "block", textAlign: "left", padding: "12px 14px", color: "#E0EAF0", borderColor: BORDER, whiteSpace: "normal", overflow: "hidden" }}>
                  <span style={{ display: "block", minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 10, lineHeight: 1.45, overflowWrap: "anywhere" }}>{session.name}</span>
                    <span style={{ display: "block", marginTop: 5, fontSize: 8, color: "#4A6070" }}>{isActivitySession(session) ? `ACTIVITY · ${sessionPlannedMinutes(session)} MIN` : `${session.exercises?.length || 0} EXERCISES`}</span>
                  </span>
                  <span style={{ display: "block", marginTop: 8, fontSize: 8, color: NEON2, lineHeight: 1.45, overflowWrap: "anywhere" }}>{(session.days || []).join(" / ") || "FLEXIBLE"} · {isActivitySession(session) ? "LOG IT →" : "START →"}</span>
                </button>
              ))}
              {sessions.filter(session => session !== recommendedSession).length === 0 && <div style={{ fontSize: 11, color: "#4A6070" }}>No other sessions in this plan.</div>}
            </div>
          </div>}

          {discardWorkoutDialog}
          {switchWorkout && workoutInProgress && activeSession && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}>
              <div className="t3d-card" role="alertdialog" aria-modal="true" aria-labelledby="switch-workout-title" aria-describedby="switch-workout-text" style={{ width: "100%", maxWidth: 360, borderColor: "#FFB547", textAlign: "center" }}>
                <h2 id="switch-workout-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#FFB547", letterSpacing: 2, margin: "0 0 12px", overflowWrap: "anywhere" }}>{switchVerb} {switchWorkout.session.name.toUpperCase()}?</h2>
                <p id="switch-workout-text" style={{ fontSize: 11, color: "#A9BBC3", lineHeight: 1.6, margin: "0 0 18px" }}>
                  {activeSession.name} has {inProgressSetCount} set{inProgressSetCount === 1 ? "" : "s"} logged. {switchVerb === "RESTART" ? `Restarting finishes this one now and starts ${activeSession.name} again` : `Starting ${switchWorkout.session.name} finishes ${activeSession.name} now`}; its sets stay saved.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, minHeight: 44, whiteSpace: "normal" }} onClick={() => setSwitchWorkout(null)}>KEEP {activeSession.name.toUpperCase()}</button>
                  <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, minHeight: 44, whiteSpace: "normal", borderColor: "#FFB547", color: "#FFB547" }} onClick={() => { const { session, options } = switchWorkout; setSwitchWorkout(null); startWorkout(session, options); }}>{switchVerb} {switchWorkout.session.name.toUpperCase()}</button>
                </div>
              </div>
            </div>
          )}
          {planChangeDialog}
          {planSaveError && !editDaysModal && approvalReview === null && (
            <div role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "10px 12px", border: "1px solid rgba(255,45,120,.4)", background: "rgba(255,45,120,.07)", borderRadius: 6, color: "#FF8AAD", fontSize: 11, lineHeight: 1.5 }}>
              <span>{planSaveError}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setPlanSaveError("")} style={{ background: "none", border: 0, color: "#FF8AAD", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
            </div>
          )}
          {planPreview && <PlanPreviewSheet {...planPreview} onClose={() => setPlanPreview(null)} />}

          {planCoachCard}

          <div className="t3d-card" style={{ marginBottom: 16 }}>
            <h2 className="t3d-ctitle">THIS WEEK <span style={{ color: "#6F8792" }}>· MON TO SUN</span></h2>
            <div className="t3d-grid3" style={{ marginBottom: 18 }}>
              <div style={{ textAlign: "center", padding: 12, background: SURFACE2, borderRadius: 6 }}>
                <div className="t3d-sval" data-testid="week-sessions" style={{ color: NEON, fontSize: 24 }}>{thisWeekSessions}</div>
                <div className="t3d-slabel">{thisWeekSessions === 1 ? "SESSION" : "SESSIONS"}{thisWeekActivities > 0 ? ` · ${thisWeekActivities} ${thisWeekActivities === 1 ? "ACTIVITY" : "ACTIVITIES"}` : ""}</div>
              </div>
              <div style={{ textAlign: "center", padding: 12, background: SURFACE2, borderRadius: 6 }}>
                <div className="t3d-sval" style={{ color: NEON2, fontSize: 18 }}>{thisWeekLogs.reduce((total, log) => total + (log.total_volume || 0), 0).toLocaleString()}</div>
                <div className="t3d-slabel">KG VOLUME</div>
              </div>
              <div style={{ textAlign: "center", padding: 12, background: SURFACE2, borderRadius: 6 }}>
                <div className="t3d-sval" style={{ color: "#FF8C00", fontSize: 14 }}>{realHistory[0]?.session_name || "—"}</div>
                <div className="t3d-slabel">LAST SESSION</div>
              </div>
            </div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#4A6070", letterSpacing: 2, marginBottom: 10 }}>LAST 7 DAYS</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 7 }}>
              {last6Days.map(day => (
                <div key={day.date} style={{ minHeight: 78, padding: 9, borderRadius: 6, background: day.workouts.length ? "rgba(0,255,178,.06)" : SURFACE2, border: `1px solid ${day.isToday ? "rgba(0,255,178,.4)" : BORDER}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 4, fontSize: 8, color: day.isToday ? NEON : "#8AABB8", marginBottom: 8 }}><span>{day.day}</span><span>{day.dateLabel}</span></div>
                  <div style={{ fontSize: 9, color: day.workouts.length ? "#E0EAF0" : "#6F8792", lineHeight: 1.45 }}>{day.workouts.length ? [...new Set(day.workouts.map(log => log.session_name))].join(" + ") : "NO WORKOUT"}</div>
                </div>
              ))}
            </div>
          </div>


          <div className="t3d-card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 className="t3d-ctitle" style={{ margin: 0, whiteSpace: "nowrap" }}>YOUR WEEKLY PLAN</h2>
                <PlanPreviewButton label="View this week's programme" onClick={() => setPlanPreview({
                  title: "THIS WEEK'S PROGRAMME",
                  notes: sessions.find(session => session.programme_notes)?.programme_notes,
                  entries: [...sessions]
                    .sort((a, b) => Math.min(...(a.days || []).map(day => DAYS.indexOf(day)), 7) - Math.min(...(b.days || []).map(day => DAYS.indexOf(day)), 7))
                    .map(session => ({ session })),
                })} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="t3d-btn t3d-btn-sm" onClick={() => { setEditDaysModal(true); }}>EDIT SESSIONS</button>
                <button className="t3d-btn t3d-btn-sm" data-testid="plan-add-activity" style={{ borderColor: "rgba(0,200,255,.35)", color: NEON2 }} onClick={() => { setPlanNotice(""); setActivityNotice(""); setPlanActivityForm({ type: "run", name: "", days: [], minutes: "30" }); }}>+ ACTIVITY</button>
                <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={openPlanChangeCoach}>CHANGE PLAN</button>
              </div>
            </div>
            {planNotice && <div role="status" data-testid="plan-notice" style={{ marginBottom: 12, fontSize: 11, color: NEON }}>✓ {planNotice}</div>}
            <div style={{ marginBottom: 14, padding: "10px 12px", border: `1px solid ${programmeApproved ? "rgba(0,255,178,.3)" : "rgba(255,181,71,.3)"}`, borderRadius: 6, background: programmeApproved ? "rgba(0,255,178,.04)" : "rgba(255,181,71,.04)" }}>
              <div style={{ fontSize: 9, color: programmeApproved ? NEON : "#FFB547", marginBottom: programmeApproved ? 0 : 7 }}>
                {programmeApproved ? `8-WEEK COMMITMENT APPROVED · REVIEW FROM ${(() => { const reviewAfter = sessions.find(session => session.approval?.reviewAfter)?.approval?.reviewAfter; return /^\d{4}-\d{2}-\d{2}$/.test(String(reviewAfter || "")) ? dateKeyLabel(reviewAfter, { day: "numeric", month: "short" }).toUpperCase() : "LATER"; })()}` : "OPTIONAL: CHECK THE DAYS AND EXERCISES, THEN LOCK THIS PLAN IN FOR 8 WEEKS. YOU CAN TRAIN WITHOUT DOING THIS."}
              </div>
              {!programmeApproved && <button className="t3d-btn t3d-btn-sm" onClick={() => { setApprovalMessages([]); setApprovalReview("all"); }}>REVIEW &amp; LOCK IN PLAN</button>}
            </div>
            {draggedWorkoutDay && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8, padding: "10px 12px", border: "1px solid rgba(0,200,255,.45)", borderRadius: 6, background: "rgba(0,200,255,.08)", color: NEON2, fontSize: 9 }}>
                <span>MOVE {draggedWorkoutDay.sessionName.toUpperCase()} · TAP A DAY OR DRAG IT THERE</span>
                <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setDraggedWorkoutDay(null)}>CANCEL</button>
              </div>
            )}
            {DAYS.map(day => {
              const isToday = day === homeDate.dayCode;
              const session = sessions.find(s => s.days?.includes(day));
              const isMoveTarget = draggedWorkoutDay && draggedWorkoutDay.sourceDay !== day;
              return (
                <div key={day} data-workout-day={day}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => { event.preventDefault(); finishWorkoutDayDrag(day); }}
                  onClick={() => { if (isMoveTarget) finishWorkoutDayDrag(day); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, padding: "9px 10px", margin: "0 -10px", borderBottom: `1px solid ${BORDER}`, borderRadius: isMoveTarget ? 6 : 0, outline: isMoveTarget ? "1px dashed rgba(0,200,255,.42)" : "none", background: isMoveTarget ? "rgba(0,200,255,.09)" : "transparent", cursor: isMoveTarget ? "pointer" : "default" }}>
                  <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, width: 32, color: isToday ? NEON : "#E0EAF0" }}>{day}</div>
                  <div style={{ flex: 1, fontSize: 11, color: isMoveTarget ? NEON2 : session ? (isToday ? "#E0EAF0" : "#4A6070") : "#2A3A48" }}>
                    {isMoveTarget ? `PLACE HERE · ${session ? `swap with ${session.name}` : "rest day"}` : session ? `${session.name} · ${sessionPlannedMinutes(session)} min` : "REST"}
                  </div>
                  {isToday && <span style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, padding: "2px 7px", borderRadius: 10, background: "rgba(0,255,178,.1)", color: NEON, border: "1px solid rgba(0,255,178,.25)" }}>TODAY</span>}
                  {session && <button type="button" draggable aria-label={`Move ${session.name} from ${day}`} title="Drag or tap to move to another day"
                    onClick={event => {
                      event.stopPropagation();
                      setDraggedWorkoutDay(current => current?.sessionName === session.name && current?.sourceDay === day ? null : { sessionName: session.name, sourceDay: day });
                    }}
                    onDragStart={event => { event.stopPropagation(); setDraggedWorkoutDay({ sessionName: session.name, sourceDay: day }); }}
                    style={{ background: draggedWorkoutDay?.sessionName === session.name ? "rgba(0,200,255,.12)" : "none", border: `1px solid ${draggedWorkoutDay?.sessionName === session.name ? "rgba(0,200,255,.45)" : "transparent"}`, borderRadius: 5, color: draggedWorkoutDay?.sessionName === session.name ? NEON2 : "#526975", cursor: "grab", fontSize: 16, padding: "8px 10px", minWidth: 44, minHeight: 44, touchAction: "manipulation", letterSpacing: -2 }}>⋮⋮</button>}
                </div>
              );
            })}
          </div>

          {approvalReview !== null && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 18 }}>
              <div className="t3d-card" role="dialog" aria-modal="true" aria-labelledby="approval-review-title" style={{ width: "100%", maxWidth: 620, maxHeight: "88dvh", overflowY: "auto", borderColor: "rgba(255,181,71,.45)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <h2 id="approval-review-title" className="t3d-ctitle" style={{ color: "#FFB547", margin: 0 }}>REVIEW BEFORE APPROVAL</h2>
                  <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setApprovalReview(null)}>CLOSE</button>
                </div>
                <p style={{ fontSize: 12, color: "#B4C5CC", lineHeight: 1.55, marginBottom: 14 }}>
                  Approval is optional. It means committing to these sessions for eight weeks, completing them within each rolling eight-day cycle, then reviewing progress, stalls or the need for a deload.
                </p>
                {(approvalReview === "all" ? sessions : [sessions[approvalReview]].filter(Boolean)).map((session, sessionIndex) => (
                  <PlanSessionCard key={`${session.name}-${sessionIndex}`} session={session}
                    description={session.reasoning || session.notes || "This older plan does not include a saved coach explanation. Ask below about its placement, recovery or exercise choices before approving."} />
                ))}
                {approvalMessages.length > 0 && <div style={{ maxHeight: 180, overflowY: "auto", margin: "12px 0" }}>
                  {approvalMessages.map((message, index) => <div key={index} className="t3d-ai-msg" style={{ background: message.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2, whiteSpace: "pre-wrap" }}><div className="t3d-ai-tag" style={{ color: message.role === "user" ? NEON2 : NEON }}>{message.role === "user" ? "YOU" : "COACH"}</div>{message.role === "assistant" ? cleanAiText(message.content) : message.content}</div>)}
                </div>}
                <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                  <input className="t3d-ai-input" placeholder="Ask why, question a day, or suggest a change..." value={approvalQuestion} onChange={event => setApprovalQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); askApprovalCoach(); } }} />
                  <button className="t3d-btn t3d-btn-sm" onClick={askApprovalCoach} disabled={approvalLoading || !approvalQuestion.trim()}>{approvalLoading ? "ASKING..." : "ASK"}</button>
                </div>
                {planSaveError && <p role="alert" style={{ color: "#FF8AAD", fontSize: 11, lineHeight: 1.5, margin: "12px 0 0" }}>{planSaveError}</p>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <button className="t3d-btn t3d-btn-sm" onClick={() => { setApprovalReview(null); setEditDaysModal(true); }}>ADJUST PLAN FIRST</button>
                  <button className="t3d-btn" style={{ flex: 1, borderColor: NEON, background: "rgba(0,255,178,.12)" }} onClick={async () => { if (await approveProgramme(approvalReview === "all" ? null : approvalReview)) setApprovalReview(null); }}>APPROVE {approvalReview === "all" ? "FULL 8-WEEK SPLIT" : "THIS SESSION"}</button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Days Modal */}
          {editDaysModal && (
            <div onClick={cancelSessionEdits} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
              <div role="dialog" aria-modal="true" aria-labelledby="edit-sessions-title" onClick={event => event.stopPropagation()} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 380, maxHeight: "80vh", overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
                  <div id="edit-sessions-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2 }}>EDIT SESSIONS</div>
                  <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={cancelSessionEdits}>CLOSE</button>
                </div>
                {sessions.map((session, sIdx) => isActivitySession(session) ? (
                  <div key={sIdx} data-testid="edit-activity" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: NEON2, letterSpacing: 2 }}>{session.name}</div>
                      <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 4 }}>Activity · {sessionPlannedMinutes(session)} min · {(session.days || []).join(" / ")}</div>
                    </div>
                    <button className="t3d-btn t3d-btn-sm t3d-btn-red" aria-label={`Remove ${session.name} from the plan`} onClick={() => setSessions(prev => prev.filter((_, i) => i !== sIdx))}>REMOVE</button>
                  </div>
                ) : (
                  <div key={sIdx} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: NEON, letterSpacing: 2, marginBottom: 10 }}>{session.name}</div>
                    {session.exercises?.map((ex, eIdx) => (
                      <div key={eIdx} style={{ background: SURFACE2, borderRadius: 6, padding: "8px 12px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <input aria-label={`${session.name}: exercise ${eIdx + 1} name`} style={{ background: "transparent", border: "none", color: "#E0EAF0", fontFamily: "'Space Mono',monospace", fontSize: 11, outline: "none", width: "100%" }}
                            value={ex.name}
                            onChange={e => setSessions(prev => prev.map((s, i) => i === sIdx ? {
                              ...s, exercises: s.exercises.map((ex2, j) => j === eIdx ? { ...ex2, name: e.target.value } : ex2)
                            } : s))} />
                          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#8AABB8", fontSize: 9, marginTop: 6 }}>
                            SETS
                            <input type="number" inputMode="numeric" min="1" max="10" aria-label={`${ex.name || `Exercise ${eIdx + 1}`} sets`} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 4, color: "#E0EAF0", fontSize: 10, outline: "none", width: 48, padding: 5 }}
                              value={ex.sets}
                              onChange={e => setSessions(prev => prev.map((s, i) => i === sIdx ? {
                                ...s, exercises: s.exercises.map((ex2, j) => {
                                  if (j !== eIdx) return ex2;
                                  const sets = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                                  const ranges = Array.isArray(ex2.reps) ? ex2.reps : repTargets(ex2.reps, sets);
                                  return { ...ex2, sets, reps: Array.from({ length: sets }, (_, index) => ranges[index] || ranges.at(-1) || "8-12") };
                                })
                              } : s))} />
                          </label>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5, marginTop: 7 }}>
                            {Array.from({ length: Number(ex.sets) || 1 }, (_, setIndex) => (
                              <label key={setIndex} style={{ display: "flex", alignItems: "center", gap: 4, color: "#8AABB8", fontSize: 8 }}>
                                S{setIndex + 1}
                                <input aria-label={`${ex.name || `Exercise ${eIdx + 1}`} set ${setIndex + 1} reps`} style={{ minWidth: 0, width: "100%", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 4, color: "#E0EAF0", fontSize: 9, padding: 5 }}
                                  value={(Array.isArray(ex.reps) ? ex.reps[setIndex] : repTargets(ex.reps, Number(ex.sets) || 1)[setIndex]) || ""} placeholder="8-12"
                                  onChange={e => setSessions(prev => prev.map((s, i) => i === sIdx ? {
                                    ...s, exercises: s.exercises.map((ex2, j) => {
                                      if (j !== eIdx) return ex2;
                                      const ranges = Array.isArray(ex2.reps) ? [...ex2.reps] : repTargets(ex2.reps, Number(ex2.sets) || 1);
                                      ranges[setIndex] = e.target.value;
                                      return { ...ex2, reps: ranges };
                                    })
                                  } : s))} />
                              </label>
                            ))}
                          </div>
                        </div>
                        <button type="button" aria-label={`Remove ${ex.name || `exercise ${eIdx + 1}`} from ${session.name}`} style={{ background: "none", border: "none", color: "#E0EAF0", cursor: "pointer", fontSize: 16, minWidth: 44, minHeight: 44, padding: 0 }}
                          onClick={() => setSessions(prev => prev.map((s, i) => i === sIdx ? {
                            ...s, exercises: s.exercises.filter((_, j) => j !== eIdx)
                          } : s))}>×</button>
                      </div>
                    ))}
                    <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginTop: 6, fontSize: 8 }}
                      onClick={() => {
                        const name = prompt("Exercise name:");
                        if (!name) return;
                        const sets = prompt("Sets?") || "3";
                        const reps = prompt("Reps? (e.g. 8-10)") || "8-10";
                        setSessions(prev => prev.map((s, i) => i === sIdx ? {
                          ...s, exercises: [...(s.exercises||[]), { name, sets: parseInt(sets)||3, reps: Array.from({ length: parseInt(sets) || 3 }, () => reps), tempo: "" }]
                        } : s));
                      }}>+ ADD EXERCISE</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={cancelSessionEdits}>CANCEL</button>
                  <button className="t3d-btn" style={{ flex: 1 }} onClick={async () => {
                    const saved = await saveSplit(sessions);
                    if (!saved.ok) { setPlanSaveError(`Your changes were not saved: ${saved.error}. Please try again.`); return; }
                    setPlanSaveError("");
                    setEditDaysModal(false);
                  }}>SAVE ✓</button>
                </div>
                {planSaveError && <p role="alert" style={{ color: "#FF8AAD", fontSize: 11, lineHeight: 1.5, margin: "10px 0 0" }}>{planSaveError}</p>}
              </div>
            </div>
          )}

          <div className="t3d-card">
            <h2 className="t3d-ctitle" style={{ margin: 0 }}>
              <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(h => !h)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", minHeight: 44, padding: 0, background: "none", border: 0, color: "inherit", font: "inherit", letterSpacing: "inherit", textTransform: "inherit", textAlign: "left", cursor: "pointer" }}>
                WORKOUT HISTORY
                <span aria-hidden="true" style={{ color: "#E0EAF0", fontSize: 14, transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s" }}>▾</span>
              </button>
            </h2>
            {historyOpen && (
              <div style={{ marginTop: 16 }}>
                {emptyHistoryCount > 0 && (
                  <button type="button" onClick={() => setShowEmptyWorkouts(value => !value)} style={{ background: "none", border: 0, color: "#8AABB8", cursor: "pointer", fontSize: 10, padding: "0 0 10px", textDecoration: "underline" }}>
                    {showEmptyWorkouts ? "Hide" : "Show"} {emptyHistoryCount} empty session{emptyHistoryCount === 1 ? "" : "s"} (started but nothing logged)
                  </button>
                )}
                {history.length === 0 ? (
                  !workoutInProgress && <div style={{ fontSize: 11, color: "#E0EAF0", textAlign: "center", padding: "16px 0" }}>No workouts logged yet!</div>
                ) : (showEmptyWorkouts ? history : realHistory).map((log, i) => (
                  <div key={i} style={{ padding: "12px 0", borderBottom: `1px solid ${BORDER}`, cursor: "pointer" }}
                    onClick={() => { setViewingSession(log); setViewingExercise(null); setWorkoutSaveError(""); }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: NEON }}>{log.session_name}</div>
                      <div style={{ fontSize: 10, color: "#E0EAF0", whiteSpace: "nowrap" }}>{formatLogDate(log.date)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#E0EAF0" }}>
                      {activityOfLog(log) ? <span style={{ color: NEON2 }}>{activityTypeLabel(activityOfLog(log).type)} · {activitySummary(log)}</span> : <>
                        <span>{log.duration_mins || 0} min{log.duration_mins === 1 ? "" : "s"}</span>
                        <span>{Math.round(log.total_volume || 0).toLocaleString()} kg lifted</span>
                      </>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Session detail / exercise progression popup */}
          {viewingSession && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
              onClick={() => { setViewingSession(null); setViewingExercise(null); setEditingHistorySession(false); setHistoryEditOriginal(null); }}>
              <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 380, maxHeight: "85vh", overflowY: "auto" }}
                onClick={e => e.stopPropagation()}>
                {!viewingExercise ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: NEON, letterSpacing: 2 }}>{viewingSession.session_name}</div>
                      <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" aria-label="Close workout history" onClick={() => { setViewingSession(null); setEditingHistorySession(false); setHistoryEditOriginal(null); }}>✕</button>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: "#E0EAF0" }}>{formatLogDate(viewingSession.date)}</div>
                      {!editingHistorySession ? <div style={{ display: "flex", gap: 5 }}>{!activityOfLog(viewingSession) && <button className="t3d-btn t3d-btn-sm" onClick={beginHistoryEdit}>EDIT WORKOUT</button>}<button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => { setWorkoutSaveError(""); setDeleteHistoryWorkout(viewingSession); }}>DELETE WORKOUT</button></div> : <div style={{ display: "flex", gap: 5 }}>
                        <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={cancelHistoryEdit}>CANCEL</button>
                        <button className="t3d-btn t3d-btn-sm" onClick={saveHistoryEdit} disabled={historySaving}>{historySaving ? "SAVING..." : "SAVE CHANGES"}</button>
                      </div>}
                    </div>
                    {workoutSaveError && <div role="alert" style={{ color: "#FF8AAD", fontSize: 9, lineHeight: 1.5, marginBottom: 10 }}>{workoutSaveError}</div>}
                    {activityOfLog(viewingSession) && (
                      <div data-testid="activity-detail" style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: NEON2 }}>{activityTypeLabel(activityOfLog(viewingSession).type)}</div>
                        <div style={{ fontSize: 11, color: "#E0EAF0", marginTop: 4 }}>{activitySummary(viewingSession)}</div>
                        {activityOfLog(viewingSession).notes && <div style={{ fontSize: 10, color: "#8AABB8", marginTop: 6, lineHeight: 1.5 }}>{activityOfLog(viewingSession).notes}</div>}
                      </div>
                    )}
                    {(viewingSession.exercises || []).filter(ex => !ex?.activity).map((ex, i) => {
                      const loggedSets = ex.sets || [];
                      const prescribedSetCount = Math.max(loggedSets.length, Number(ex.prescribed_sets) || 0);
                      return <div key={i} style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 8, cursor: editingHistorySession ? "default" : "pointer" }}
                        onClick={() => { if (!editingHistorySession) setViewingExercise(ex.name); }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div style={{ fontSize: 12 }}>{ex.name}</div>
                          {!editingHistorySession && <div style={{ textAlign: "right" }}><div style={{ fontSize: 9, color: loggedSets.length < prescribedSetCount ? "#FFB547" : NEON }}>{loggedSets.length}/{prescribedSetCount || loggedSets.length} SETS COMPLETED</div><div style={{ fontSize: 8, color: NEON2, marginTop: 3 }}>VIEW PROGRESS →</div></div>}
                        </div>
                        {editingHistorySession ? <div style={{ display: "grid", gap: 6 }}>
                          {(ex.sets || []).map((set, setIndex) => <div key={setIndex} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr auto", alignItems: "end", gap: 6 }}>
                            <span style={{ color: "#6F8792", fontSize: 8, paddingBottom: 8 }}>S{setIndex + 1}</span>
                            <label style={{ color: "#8AABB8", fontSize: 7 }}>KG<input className="t3d-input" type="number" inputMode="decimal" aria-label={`${ex.name} set ${setIndex + 1} weight in kilograms`} value={set.weight ?? ""} onChange={event => updateHistorySet(i, setIndex, "weight", event.target.value)} /></label>
                            <label style={{ color: "#8AABB8", fontSize: 7 }}>REPS<input className="t3d-input" type="number" inputMode="numeric" aria-label={`${ex.name} set ${setIndex + 1} reps`} value={set.reps ?? ""} onChange={event => updateHistorySet(i, setIndex, "reps", event.target.value)} /></label>
                            <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" aria-label={`Delete ${ex.name} set ${setIndex + 1}`} style={{ minWidth: 44, minHeight: 44, padding: 0 }} onClick={() => deleteHistorySet(i, setIndex)}>×</button>
                          </div>)}
                          {(ex.sets || []).length === 0 && <div style={{ color: "#6F8792", fontSize: 9 }}>No sets remain for this exercise.</div>}
                        </div> : <div style={{ display: "grid", gap: 5 }}>
                          {Array.from({ length: prescribedSetCount || loggedSets.length }, (_, setIndex) => {
                            const set = loggedSets[setIndex];
                            return <div key={setIndex} style={{ display: "grid", gridTemplateColumns: "46px 1fr auto", gap: 7, fontSize: 9, alignItems: "center", padding: "4px 0", borderTop: `1px solid ${BORDER}` }}>
                              <span style={{ color: "#8AABB8" }}>SET {setIndex + 1}</span>
                              <span style={{ color: set ? "#E0EAF0" : "#6F8792" }}>{set ? `${set.reps || 0} reps @ ${set.weight || 0}kg` : `Target ${Array.isArray(ex.prescribed_reps) ? ex.prescribed_reps[setIndex] : ex.prescribed_reps || "—"} reps`}</span>
                              <span style={{ color: set ? NEON : "#FFB547", fontSize: 8 }}>{set ? "COMPLETED" : "SKIPPED / NOT LOGGED"}</span>
                            </div>;
                          })}
                        </div>}
                      </div>
                    })}
                    {!activityOfLog(viewingSession) && <div style={{ marginTop: 12, padding: 12, background: "rgba(0,200,255,.05)", border: "1px solid rgba(0,200,255,.2)", borderRadius: 6, textAlign: "left" }}>
                      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, color: NEON2, letterSpacing: 1, marginBottom: 6 }}>AI COACH FEEDBACK</div>
                      <div style={{ color: viewingSession.ai_feedback ? "#C5D6DC" : "#6F8792", fontSize: 10, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{viewingSession.ai_feedback ? cleanAiText(viewingSession.ai_feedback) : "No AI Coach feedback was saved for this older workout."}</div>
                    </div>}
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: NEON, letterSpacing: 2 }}>{viewingExercise}</div>
                      <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" aria-label="Close exercise progress" onClick={() => setViewingSession(null)}>✕</button>
                    </div>
                    <button className="t3d-btn t3d-btn-sm" style={{ marginBottom: 16 }} onClick={() => setViewingExercise(null)}>← BACK TO SESSION</button>
                    <ExerciseLineChart points={getExerciseProgression(viewingExercise)} />
                  </>
                )}
              </div>
            </div>
          )}

          {deleteHistoryWorkout && (
            <div role="alertdialog" aria-modal="true" aria-labelledby="delete-workout-title"
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.94)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, padding: 20 }}
              onClick={() => { if (!historySaving) setDeleteHistoryWorkout(null); }}>
              <div style={{ width: "100%", maxWidth: 380, padding: 24, background: SURFACE, border: "1px solid rgba(255,70,105,.55)", borderRadius: 8 }} onClick={event => event.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div id="delete-workout-title" style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#FF6B88", letterSpacing: 2 }}>DELETE WORKOUT?</div>
                  <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" aria-label="Close delete workout confirmation" disabled={historySaving} onClick={() => setDeleteHistoryWorkout(null)}>✕</button>
                </div>
                <div style={{ color: "#E0EAF0", fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>{deleteHistoryWorkout.session_name}</div>
                <div style={{ color: "#8AABB8", fontSize: 10, lineHeight: 1.6, marginBottom: 16 }}>This permanently removes the workout, its recorded sets and its AI Coach feedback. This cannot be undone.</div>
                {workoutSaveError && <div role="alert" style={{ color: "#FF8AAD", fontSize: 9, lineHeight: 1.5, marginBottom: 12 }}>{workoutSaveError}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
                  <button type="button" className="t3d-btn t3d-btn-sm" disabled={historySaving} onClick={() => setDeleteHistoryWorkout(null)}>KEEP WORKOUT</button>
                  <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" disabled={historySaving} onClick={confirmDeleteHistoryWorkout}>{historySaving ? "DELETING..." : "DELETE PERMANENTLY"}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}



// ─── Nutrition Section ────────────────────────────────────────────────────────
const COMMON_MEALS = {
  breakfast: [
    { name: "Oats & Banana", time: "08:00", ingredients: [{ name: "Oats", weight: 80, unit: "g" }, { name: "Banana", weight: 120, unit: "g" }, { name: "Whole milk", weight: 200, unit: "ml" }], calories: 420, protein: 14, carbs: 72, fats: 8 },
    { name: "Eggs on Toast", time: "08:00", ingredients: [{ name: "Eggs", weight: 150, unit: "g" }, { name: "Wholegrain bread", weight: 80, unit: "g" }, { name: "Butter", weight: 10, unit: "g" }], calories: 380, protein: 22, carbs: 32, fats: 16 },
    { name: "Greek Yogurt & Berries", time: "08:00", ingredients: [{ name: "Greek yogurt", weight: 200, unit: "g" }, { name: "Mixed berries", weight: 100, unit: "g" }, { name: "Honey", weight: 10, unit: "g" }], calories: 220, protein: 18, carbs: 28, fats: 4 },
    { name: "Protein Pancakes", time: "08:00", ingredients: [{ name: "Oats", weight: 60, unit: "g" }, { name: "Eggs", weight: 100, unit: "g" }, { name: "Protein powder", weight: 30, unit: "g" }], calories: 380, protein: 32, carbs: 38, fats: 8 },
  ],
  lunch: [
    { name: "Chicken & Rice", time: "13:00", ingredients: [{ name: "Chicken breast", weight: 200, unit: "g" }, { name: "White rice", weight: 100, unit: "g" }, { name: "Broccoli", weight: 150, unit: "g" }], calories: 520, protein: 52, carbs: 55, fats: 6 },
    { name: "Tuna Rice Bowl", time: "13:00", ingredients: [{ name: "Tuna in water", weight: 160, unit: "g" }, { name: "Brown rice", weight: 120, unit: "g" }, { name: "Spinach", weight: 80, unit: "g" }], calories: 440, protein: 48, carbs: 50, fats: 4 },
    { name: "Turkey Wrap", time: "13:00", ingredients: [{ name: "Turkey breast", weight: 150, unit: "g" }, { name: "Wholegrain wrap", weight: 60, unit: "g" }, { name: "Salad", weight: 80, unit: "g" }], calories: 380, protein: 38, carbs: 32, fats: 8 },
    { name: "Beef & Pasta", time: "13:00", ingredients: [{ name: "Lean beef mince", weight: 150, unit: "g" }, { name: "Pasta", weight: 100, unit: "g" }, { name: "Tomato sauce", weight: 100, unit: "g" }], calories: 580, protein: 42, carbs: 58, fats: 14 },
  ],
  dinner: [
    { name: "Salmon & Veg", time: "19:00", ingredients: [{ name: "Salmon fillet", weight: 180, unit: "g" }, { name: "Sweet potato", weight: 200, unit: "g" }, { name: "Asparagus", weight: 100, unit: "g" }], calories: 560, protein: 44, carbs: 42, fats: 18 },
    { name: "Chicken Stir Fry", time: "19:00", ingredients: [{ name: "Chicken breast", weight: 200, unit: "g" }, { name: "Mixed veg", weight: 200, unit: "g" }, { name: "Rice noodles", weight: 80, unit: "g" }], calories: 480, protein: 46, carbs: 48, fats: 8 },
    { name: "Steak & Potatoes", time: "19:00", ingredients: [{ name: "Sirloin steak", weight: 200, unit: "g" }, { name: "Baby potatoes", weight: 200, unit: "g" }, { name: "Green beans", weight: 100, unit: "g" }], calories: 620, protein: 52, carbs: 44, fats: 22 },
    { name: "Cod & Rice", time: "19:00", ingredients: [{ name: "Cod fillet", weight: 200, unit: "g" }, { name: "Brown rice", weight: 100, unit: "g" }, { name: "Spinach", weight: 100, unit: "g" }], calories: 440, protein: 46, carbs: 44, fats: 6 },
  ],
  snacks: [
    { name: "Protein Shake", time: "16:00", ingredients: [{ name: "Whey protein", weight: 30, unit: "g" }, { name: "Whole milk", weight: 300, unit: "ml" }], calories: 280, protein: 38, carbs: 14, fats: 6 },
    { name: "Rice Cakes & PB", time: "10:00", ingredients: [{ name: "Rice cakes", weight: 40, unit: "g" }, { name: "Peanut butter", weight: 30, unit: "g" }], calories: 220, protein: 8, carbs: 24, fats: 10 },
    { name: "Cottage Cheese", time: "21:00", ingredients: [{ name: "Cottage cheese", weight: 200, unit: "g" }, { name: "Pineapple", weight: 80, unit: "g" }], calories: 180, protein: 22, carbs: 14, fats: 4 },
    { name: "Mixed Nuts", time: "10:00", ingredients: [{ name: "Mixed nuts", weight: 40, unit: "g" }], calories: 240, protein: 6, carbs: 8, fats: 20 },
  ],
};

// ─── AI Tweaks Box ────────────────────────────────────────────────────────────
// Asks the coach for a meal plan, adds it up in code and checks it against
// its targets (calories within 5%, protein within 10%). If it is off, asks
// once more with the gap stated. Returns { meals, check }; check.ok is false
// when the plan is still off, so the screen can say so. A plan below the
// daily minimum (minCalories) is never returned: it is asked for again, and
// if every try is below it the error has belowMinimum set.
async function requestMealPlan(area, content, targets, { allergies = [], wakeTime = "", minCalories = 0 } = {}) {
  const minimumRule = minCalories > 0 ? `\nMinimum daily calories: ${minCalories} kcal. The plan must add up to at least this, even if asked for less.` : "";
  const messages = [{ role: "user", content: `${content}${minimumRule}\n\n${allergyRule(allergies)}` }];
  let best = null;
  let belowMinimum = null;
  // Up to two tries for the targets, and a third only to remove an allergen
  // or reach the minimum.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("/api/chat", { method: "POST", headers: await chatHeaders(), body: JSON.stringify({ area, responseTokens: 2500, messages }) });
    const reply = await readCoachReply(res);
    const parsed = extractJsonObject(reply)?.meals;
    if (!Array.isArray(parsed) || !parsed.length) {
      messages.push({ role: "assistant", content: reply }, { role: "user", content: "That could not be read. Return the full plan as JSON only." });
      continue;
    }
    // Meal times come from the user's wake-up time, not the model.
    const meals = applyMealTimes(parsed, wakeTime);
    const check = { ...mealPlanTargetCheck(meals, targets), allergyConflicts: mealAllergyConflicts(meals, allergies) };
    if (minCalories > 0 && check.totals.calories < minCalories) {
      belowMinimum = check.totals.calories;
      messages.push({ role: "assistant", content: reply }, { role: "user", content: `Your plan adds up to ${check.totals.calories} kcal, below the minimum of ${minCalories} kcal a day. Increase the portions so the total is at least ${Math.max(minCalories, Number(targets.calories) || 0)} kcal. Return the full plan as JSON only.` });
      continue;
    }
    const safe = !check.allergyConflicts.length;
    if (!best || (safe && best.check.allergyConflicts.length) || (safe === !best.check.allergyConflicts.length && check.ok && !best.check.ok)) best = { meals, check };
    if (check.ok && safe) return best;
    if (safe && attempt >= 1) break;
    const problems = [];
    if (!safe) problems.push(`It includes foods the user is allergic or intolerant to: ${allergyConflictText(check.allergyConflicts)}. Replace them with safe foods.`);
    if (!check.ok) problems.push(`Your plan adds up to ${check.totals.calories} kcal and ${check.totals.protein} g protein, but the targets are ${targets.calories} kcal and ${targets.protein} g protein (${check.problems.join("; ")}). Adjust the portions so calories are within 5% and protein within 10%.`);
    messages.push({ role: "assistant", content: reply }, { role: "user", content: `${problems.join(" ")} Return the full plan as JSON only.` });
  }
  if (!best && belowMinimum !== null) throw Object.assign(new Error(`the meal plan added up to ${belowMinimum} kcal, below the minimum of ${minCalories}`), { belowMinimum: true });
  if (!best) throw new Error("the meal plan could not be read");
  return best;
}

// Shown when the AI only came back with plans below the minimum.
const belowMinimumText = minCalories => `The AI's plan came out below your minimum of ${minCalories.toLocaleString("en-GB")} kcal a day, so it wasn't used. Please try again.`;

const mealPlanNeedsWarning = check => !check.ok || check.allergyConflicts?.length > 0;
const mealPlanWarningText = (check, targets) => [
  check.allergyConflicts?.length ? `Contains foods you listed as allergies: ${allergyConflictText(check.allergyConflicts)}. Swap or remove these before saving.` : "",
  check.ok ? "" : `This plan adds up to ${check.totals.calories.toLocaleString()} kcal and ${check.totals.protein} g protein, which is off your targets of ${Number(targets.calories).toLocaleString()} kcal and ${targets.protein} g. Adjust the portions or ask for a tweak before saving.`,
].filter(Boolean).join(" ");

// minCalories: the daily minimum; a tweak can never take the plan below it.
function AiTweaksBox({ meals, setMeals, macros, goal, allergies = [], preferences = "", wakeTime = "", minCalories = 0 }) {
  const [tweakInput, setTweakInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tweakDone, setTweakDone] = useState(false);
  const [planWarning, setPlanWarning] = useState("");

  const applyTweak = async () => {
    if (!tweakInput.trim() || loading) return;
    setLoading(true);
    setPlanWarning("");
    try {
      const targets = { calories: Math.max(macros.calories, minCalories), protein: macros.protein };
      const result = await requestMealPlan("meal_plan_tweak", `Current meal plan: ${JSON.stringify(meals)}. User wants to change: "${tweakInput}". Apply the changes and return the updated plan. Goal: ${goal}. Targets: ${targets.calories} kcal and ${macros.protein} g protein.${preferences ? `\nUser preferences:\n${preferences}` : ""}`, targets, { allergies, wakeTime, minCalories });
      setMeals(result.meals); setTweakDone(true); setTweakInput("");
      if (mealPlanNeedsWarning(result.check)) setPlanWarning(mealPlanWarningText(result.check, targets));
    } catch (e) {
      console.error(e);
      setPlanWarning(e?.belowMinimum ? `That change would take your plan below your minimum of ${minCalories.toLocaleString("en-GB")} kcal a day, so it wasn't made. Your plan is unchanged.` : "Couldn't update the plan just now. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ marginTop: 12 }}>
      {/* Tweaks box */}
      <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 12, marginBottom: 10 }}>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: NEON, letterSpacing: 2, marginBottom: 8 }}>WANT TO CHANGE ANYTHING?</div>
        <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 8 }}>e.g. "swap salmon for chicken", "remove eggs", "add more carbs at lunch"</div>
        {tweakDone && <div style={{ fontSize: 10, color: NEON, marginBottom: 8 }}>✓ Plan updated!</div>}
        {planWarning && <div role="alert" data-testid="meal-plan-warning" style={{ fontSize: 10, color: "#FFB547", marginBottom: 8, lineHeight: 1.5 }}>{planWarning}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <input className="t3d-ai-input" placeholder="Describe your changes..." value={tweakInput}
            onChange={e => { setTweakInput(e.target.value); setTweakDone(false); }}
            onKeyDown={e => e.key === "Enter" && applyTweak()} />
          <button className="t3d-btn t3d-btn-sm" onClick={applyTweak} disabled={loading || !tweakInput.trim()}>
            {loading ? "..." : "APPLY"}
          </button>
        </div>
      </div>

    </div>
  );
}

// ─── Log as you go ────────────────────────────────────────────────────────────
// Today's meals: ✓ (went to plan) or × (did not, with a short note) for
// planned meals, and macro boxes for flexible meals. Shared by Nutrition and
// the dashboard; onSave stores each change and returns true when it saved.
// showDetails: tapping a planned meal shows what's in it, so the Nutrition
// page lists each meal once. The yellow swap button replaces a planned meal
// for today with one from `library` or one made up there; onAddToLibrary
// keeps a made-up meal for next time.
const EMPTY_SWAP = { name: "", calories: "", protein: "", carbs: "", fats: "" };
const SWAP_YELLOW = "#FFD23F";
const SwapIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 4 3 8l4 4" /><path d="M3 8h13a4 4 0 0 1 4 4" /><path d="m17 20 4-4-4-4" /><path d="M21 16H8a4 4 0 0 1-4-4" />
  </svg>
);
function MealLogList({ meals, results, onResultsChange, onSave, compact = false, showDetails = false, library = [], onAddToLibrary = null }) {
  const [status, setStatus] = useState("");
  const [openMeal, setOpenMeal] = useState(null);
  const [swapOpen, setSwapOpen] = useState(null);
  const [swapDraft, setSwapDraft] = useState(EMPTY_SWAP);
  // Saving a swap to the library is a choice, not the default.
  const [keepSwap, setKeepSwap] = useState(false);
  const [lastChange, setLastChange] = useState(""); // what the last tap did, and how to undo it
  const commit = async updated => {
    onResultsChange(updated);
    setStatus("SAVING...");
    const saved = await onSave(updated);
    setStatus(saved ? "SAVED" : "COULD NOT SAVE");
    return saved;
  };
  const openSwap = index => {
    setSwapDraft(EMPTY_SWAP);
    setKeepSwap(false);
    setSwapOpen(current => (current === index ? null : index));
  };
  // Today's meal becomes the one chosen; the plan itself is unchanged.
  const swapIn = async (index, item, addToLibrary = false) => {
    const updated = { ...results, [index]: swappedMealResult(item) };
    setSwapOpen(null);
    setSwapDraft(EMPTY_SWAP);
    const saved = await commit(updated);
    if (saved && addToLibrary && onAddToLibrary) onAddToLibrary(updated[index].swap);
  };
  // ✓ and × are toggles: tapping the one already chosen clears the meal again.
  const withoutResult = index => Object.fromEntries(Object.entries(results || {}).filter(([key]) => key !== String(index)));
  const setMealStatus = (index, meal, status) => {
    const result = results[index];
    const current = mealWasMissed(result) ? "missed" : mealWasCompleted(result) && !mealSwap(result) ? "done" : null;
    if (current === status) {
      setLastChange(`${meal.name}: cleared.`);
      return commit(withoutResult(index));
    }
    setLastChange(status === "done"
      ? `${meal.name}: went to plan. Tap ✓ again to undo.`
      : `${meal.name}: didn't go to plan. Add what you had below, or tap × again to undo.`);
    return commit({ ...results, [index]: status === "done" ? true : { completed: false, note: typeof result === "object" && result ? result.note || "" : "" } });
  };
  // Today's other planned meals aren't offered as swaps; the library's other meals are.
  const plannedNames = new Set(meals.map(item => String(item?.name || "").trim().toLowerCase()));
  const undoSwap = index => {
    const rest = Object.fromEntries(Object.entries(results || {}).filter(([key]) => key !== String(index)));
    setSwapOpen(null);
    commit(rest);
  };
  if (!meals.length) return <div style={{ fontSize: 10, color: "#6F8792", padding: "6px 0" }}>No meals planned for today.</div>;
  return (
    <div data-testid="meal-log-list">
      {meals.map((meal, index) => {
        const result = results[index];
        const missed = mealWasMissed(result);
        if (isFlexibleMeal(meal)) {
          const flexibleResult = typeof result === "object" && result ? result : {};
          return <div key={`${meal.name}-${index}`} style={{ padding: compact ? "9px 0" : "12px 0", borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}><div><div style={{ color: NEON2, fontSize: 12 }}>{meal.name}</div><div style={{ color: "#6F8792", fontSize: 8 }}>Budget: {meal.calories || 0} kcal · {meal.protein || 0}g protein</div></div>{mealWasCompleted(result) && <span style={{ color: NEON, fontSize: 9 }}>LOGGED ✓</span>}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 5 }}>
              {[["calories","KCAL"],["protein","P (g)"],["carbs","C (g)"],["fats","F (g)"]].map(([key,label]) => <label key={key} style={{ color: "#6F8792", fontSize: 7 }}>{label}<input className="t3d-input" aria-label={`${label} for ${meal.name}`} type="number" inputMode="decimal" value={flexibleResult[key] ?? ""} onChange={event => { const value = event.target.value; onResultsChange(current => ({ ...current, [index]: { ...(typeof current[index] === "object" && current[index] ? current[index] : {}), completed: false, [key]: value } })); }} style={{ padding: "7px 4px", marginTop: 4, fontSize: 11 }} /></label>)}
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
              <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} disabled={!flexibleResult.calories} onClick={() => commit({ ...results, [index]: { ...flexibleResult, completed: true } })}>LOG &amp; SAVE</button>
              <button aria-label={`Clear ${meal.name}`} className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => commit({ ...results, [index]: { completed: false, note: "Skipped" } })}>SKIP</button>
            </div>
          </div>;
        }
        const detailsOpen = showDetails && openMeal === index;
        const swap = mealSwap(result);
        const wentToPlan = mealWasCompleted(result) && !swap;
        const swapOptions = (library || []).filter(item => item?.name && !isFlexibleMeal(item) && !plannedNames.has(item.name.trim().toLowerCase()));
        return <div key={`${meal.name}-${index}`} style={{ padding: compact ? "8px 0" : "10px 0", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {showDetails ? (
              <button type="button" aria-expanded={detailsOpen} aria-label={`${meal.name}: what's in it`} onClick={() => setOpenMeal(detailsOpen ? null : index)} style={{ flex: 1, minWidth: 0, minHeight: 44, background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ fontSize: 12, color: "#E0EAF0" }}>{meal.name} <span style={{ color: "#526873", fontSize: 9 }}>{detailsOpen ? "▴" : "▾"}</span></div>
                <div style={{ fontSize: 9, color: "#6F8792" }}>{meal.calories || 0} kcal {meal.time ? `· ${meal.time}` : ""}</div>
              </button>
            ) : <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, color: "#E0EAF0" }}>{meal.name}</div><div style={{ fontSize: 9, color: "#6F8792" }}>{meal.calories || 0} kcal {meal.time ? `· ${meal.time}` : ""}</div></div>}
            <button aria-label={`${meal.name} went to plan`} aria-pressed={wentToPlan} className="t3d-btn t3d-btn-sm" style={{ padding: "6px 10px", minHeight: 44, minWidth: 44, background: wentToPlan ? "rgba(0,255,178,.16)" : "transparent", borderColor: wentToPlan ? NEON : BORDER }} onClick={() => setMealStatus(index, meal, "done")}>✓</button>
            {/* Swap sits between went-to-plan and didn't: a quiet outline until a meal is swapped. */}
            <button type="button" aria-label={`Swap ${meal.name}`} aria-pressed={Boolean(swap)} aria-expanded={swapOpen === index} title="Swap this meal" onClick={() => openSwap(index)}
              style={{ width: 44, height: 44, minWidth: 44, padding: 0, border: 0, background: "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {/* A 30px circle, with a 44px tap area round it. */}
              <span style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${swap || swapOpen === index ? "rgba(255,210,63,.6)" : "rgba(255,210,63,.28)"}`, background: swap ? "rgba(255,210,63,.14)" : "transparent", color: swap || swapOpen === index ? SWAP_YELLOW : "rgba(255,210,63,.6)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <SwapIcon />
              </span>
            </button>
            <button aria-label={`${meal.name} did not go to plan`} aria-pressed={missed} className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ padding: "6px 10px", minHeight: 44, minWidth: 44, background: missed ? "rgba(255,45,120,.14)" : "transparent" }} onClick={() => setMealStatus(index, meal, "missed")}>×</button>
          </div>
          {swap && <div data-testid="meal-swapped" style={{ marginTop: 5, fontSize: 10, color: SWAP_YELLOW }}>Swapped for {swap.name} · {swap.calories.toLocaleString("en-GB")} kcal · {swap.protein}g P</div>}
          {swapOpen === index && (
            <div data-testid="swap-panel" style={{ marginTop: 8, padding: 10, border: "1px solid rgba(255,210,63,.4)", borderRadius: 7, background: "rgba(255,210,63,.05)" }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: SWAP_YELLOW, letterSpacing: 1, marginBottom: 8 }}>SWAP {String(meal.name || "THIS MEAL").toUpperCase()} FOR</div>
              <div style={{ fontSize: 8, color: "#8AABB8", letterSpacing: 1, marginBottom: 6 }}>FROM YOUR LIBRARY</div>
              {swapOptions.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  {swapOptions.map((option, optionIndex) => (
                    <button key={option.id || `${option.name}-${optionIndex}`} type="button" data-testid="swap-option" className="t3d-btn t3d-btn-sm" style={{ display: "flex", justifyContent: "space-between", gap: 8, textAlign: "left", whiteSpace: "normal" }} onClick={() => swapIn(index, option)}>
                      <span>{option.name}</span><span style={{ color: "#8AABB8", flexShrink: 0 }}>{Number(option.calories) || 0} kcal · {Number(option.protein) || 0}g P</span>
                    </button>
                  ))}
                </div>
              ) : <div style={{ fontSize: 10, color: "#6F8792", marginBottom: 12 }}>No other meals in your library yet (today&apos;s planned meals aren&apos;t listed). Make your own below.</div>}
              <div style={{ fontSize: 8, color: "#8AABB8", letterSpacing: 1, marginBottom: 6 }}>OR MAKE YOUR OWN</div>
              <input className="t3d-input" aria-label="Swap meal name" placeholder="e.g. Chicken wrap" value={swapDraft.name} onChange={event => { const value = event.target.value; setSwapDraft(draft => ({ ...draft, name: value })); }} style={{ marginBottom: 6 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 5 }}>
                {[["calories", "KCAL"], ["protein", "P (g)"], ["carbs", "C (g)"], ["fats", "F (g)"]].map(([key, label]) => (
                  <label key={key} style={{ color: "#6F8792", fontSize: 7 }}>{label}
                    <input className="t3d-input" aria-label={`Swap meal ${label}`} type="number" inputMode="decimal" min="0" value={swapDraft[key]} onChange={event => { const value = event.target.value; setSwapDraft(draft => ({ ...draft, [key]: value })); }} style={{ padding: "7px 4px", marginTop: 4, fontSize: 11 }} />
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 9, color: "#6F8792", lineHeight: 1.5, marginTop: 6 }}>Leave protein, carbs and fat blank for a rough split.</div>
              {onAddToLibrary && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#C5D6DC", marginTop: 8 }}><input type="checkbox" checked={keepSwap} onChange={event => setKeepSwap(event.target.checked)} /> Save it to my meal library</label>}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" className="t3d-btn t3d-btn-sm" style={{ flex: 1, borderColor: SWAP_YELLOW, color: SWAP_YELLOW }} disabled={!swapDraft.name.trim() || !(Number(swapDraft.calories) > 0)} onClick={() => swapIn(index, swapDraft, keepSwap)}>SWAP IT IN ✓</button>
                {swap && <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => undoSwap(index)}>UNDO SWAP</button>}
                <button type="button" className="t3d-btn t3d-btn-sm" onClick={() => setSwapOpen(null)}>CANCEL</button>
              </div>
            </div>
          )}
          {detailsOpen && (
            <div data-testid="meal-details" style={{ margin: "8px 0 2px", padding: "8px 10px", background: SURFACE2, borderRadius: 6 }}>
              {(meal.ingredients || []).map((ingredient, ingredientIndex) => <div key={ingredientIndex} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "#C5D6DC", padding: "2px 0" }}><span>{ingredient.name}</span><span>{ingredient.weight}{ingredient.unit}</span></div>)}
              {!(meal.ingredients || []).length && <div style={{ fontSize: 10, color: "#6F8792" }}>No ingredients saved for this meal.</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 10 }}>
                <span style={{ color: NEON }}>{meal.calories || 0} kcal</span>
                <span style={{ color: NEON2 }}>{meal.protein || 0}g P</span>
                <span style={{ color: "#FF8C00" }}>{meal.carbs || 0}g C</span>
                <span style={{ color: "#8AABB8" }}>{meal.fats || 0}g F</span>
              </div>
            </div>
          )}
          {missed && <div style={{ marginTop: 8 }}>
            <textarea className="t3d-input" rows={2} placeholder="How did it not go to plan?" value={typeof result === "object" && result ? result.note || "" : ""} onChange={event => { const value = event.target.value; onResultsChange(current => ({ ...current, [index]: { completed: false, note: value } })); }} />
            <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 6, borderColor: "rgba(255,181,71,.35)", color: "#FFB547" }} onClick={() => commit(results)}>SAVE NOTE</button>
          </div>}
        </div>;
      })}
      {status && <div role="status" style={{ color: status === "COULD NOT SAVE" ? NEON3 : NEON, fontSize: 9, marginTop: 9 }}>{lastChange && status !== "COULD NOT SAVE" ? `${lastChange} ` : ""}{status}</div>}
    </div>
  );
}

// "Log something else": one tap for common foods, the coach's estimate for
// anything described, or calories with protein, carbs and fat when known.
// Food logged as calories only gets a rough protein/carbs/fat split, so the
// day's macros always add up. onAdd(item) saves it and returns true or false.
function LogSomethingElse({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [values, setValues] = useState({ calories: "", protein: "", carbs: "", fats: "" });
  const [estimate, setEstimate] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = () => { setName(""); setValues({ calories: "", protein: "", carbs: "", fats: "" }); setEstimate(null); };
  const add = async item => {
    setBusy(true);
    setStatus("");
    const saved = await onAdd(item);
    setBusy(false);
    if (saved === false) { setStatus("That couldn't be saved. Check your connection and try again."); return; }
    setStatus(`Added ${item.name} · ${Math.round(Number(item.calories) || 0).toLocaleString("en-GB")} kcal`);
    reset();
    setOpen(false);
  };
  const estimateIt = async () => {
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: await chatHeaders(),
        body: JSON.stringify({ area: "food_estimate", messages: [{ role: "user", content: `Estimate this food exactly as I described it:\n- ${name.trim()}` }] }),
      });
      const result = sumFoodEstimate(extractJsonObject(await readCoachReply(res))?.items);
      if (!result.items.length) throw new Error("no items in the estimate");
      setEstimate(result);
    } catch (error) {
      console.log("Food estimate error:", error?.message);
      setStatus("Couldn't estimate that just now. Enter the calories instead.");
    }
    setBusy(false);
  };
  const typed = { name: name.trim(), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === "" ? undefined : Number(value)])) };
  return (
    <div data-testid="log-something-else" style={{ marginTop: 10 }}>
      {!open ? (
        <button type="button" className="t3d-btn t3d-btn-sm" style={{ width: "100%", borderColor: "rgba(255,140,0,.4)", color: "#FFB547" }} onClick={() => { setOpen(true); setStatus(""); }}>+ LOG SOMETHING ELSE</button>
      ) : (
        <div style={{ padding: 11, border: "1px solid rgba(255,140,0,.3)", borderRadius: 7, background: "rgba(255,140,0,.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#FFB547", letterSpacing: 1 }}>LOG SOMETHING ELSE</div>
            <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => { reset(); setOpen(false); }}>CANCEL</button>
          </div>
          <div style={{ fontSize: 8, color: "#8AABB8", letterSpacing: 1, marginBottom: 6 }}>QUICK ADD</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {QUICK_FOODS.map(food => (
              <button key={food.name} type="button" data-testid="quick-food" className="t3d-btn t3d-btn-sm" disabled={busy} style={{ fontSize: 9, whiteSpace: "normal", textAlign: "left" }} onClick={() => add(food)}>
                {food.name} <span style={{ color: "#8AABB8" }}>· {food.calories}</span>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 8, color: "#8AABB8", letterSpacing: 1, marginBottom: 6 }}>OR TYPE IT</div>
          <input className="t3d-input" aria-label="What did you have?" placeholder="e.g. 2 slices of toast with butter" value={name} onChange={event => { setName(event.target.value); setEstimate(null); }} style={{ marginBottom: 6 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 5 }}>
            {[["calories", "KCAL"], ["protein", "P (g)"], ["carbs", "C (g)"], ["fats", "F (g)"]].map(([key, label]) => (
              <label key={key} style={{ color: "#6F8792", fontSize: 7 }}>{label}
                <input className="t3d-input" aria-label={`Something else ${label}`} type="number" inputMode="decimal" min="0" value={values[key]} onChange={event => { const value = event.target.value; setValues(current => ({ ...current, [key]: value })); }} style={{ padding: "7px 4px", marginTop: 4, fontSize: 11 }} />
              </label>
            ))}
          </div>
          <div style={{ fontSize: 9, color: "#6F8792", lineHeight: 1.5, margin: "6px 0 8px" }}>Leave protein, carbs and fat blank for a rough split. No calories? Let the coach estimate it.</div>
          {estimate && (
            <div data-testid="something-else-estimate" style={{ fontSize: 10, color: "#C5D6DC", lineHeight: 1.6, marginBottom: 8 }}>
              Estimate: {estimate.caloriesLow.toLocaleString("en-GB")}–{estimate.caloriesHigh.toLocaleString("en-GB")} kcal · about {estimate.proteinMid} g protein, {estimate.carbsMid} g carbs, {estimate.fatsMid} g fat
              <button type="button" className="t3d-btn t3d-btn-sm" style={{ display: "block", marginTop: 6 }} disabled={busy} onClick={() => add({ name: typed.name, calories: estimate.caloriesMid, protein: estimate.proteinMid, carbs: estimate.carbsMid, fats: estimate.fatsMid })}>ADD ~{estimate.caloriesMid.toLocaleString("en-GB")} KCAL</button>
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} disabled={busy || !typed.name || !(typed.calories > 0)} onClick={() => add(typed)}>ADD</button>
            <button type="button" className="t3d-btn t3d-btn-sm" style={{ flex: 1, borderColor: "rgba(0,200,255,.35)", color: NEON2 }} disabled={busy || !typed.name || typed.calories > 0} onClick={estimateIt}>{busy && !estimate ? "ESTIMATING..." : "ESTIMATE IT"}</button>
          </div>
        </div>
      )}
      {status && <div role="status" style={{ fontSize: 9, color: status.startsWith("Added") ? NEON : "#FFB547", marginTop: 6 }}>{status}</div>}
    </div>
  );
}

// Today's meal ticks on the dashboard (LOG AS YOU GO and Next up), saved to
// the same nutrition_logs row as the Nutrition page, one save at a time so
// quick ticks never create two rows. The day review is left alone; off-plan
// food changes only through "Log something else".
function useDashboardMealLog({ user, today, meals, log, loaded, isTrainingDay, onLogged }) {
  const [results, setResults] = useState({});
  const [error, setError] = useState("");
  const logRef = useRef(log);
  useEffect(() => { logRef.current = log; }, [log]);
  const resultsRef = useRef(results);
  useEffect(() => { resultsRef.current = results; }, [results]);
  // Start from what is saved once today's data has loaded (or a row was created).
  const syncKey = `${loaded ? 1 : 0}:${today}:${log?.id || ""}`;
  useEffect(() => { setResults(logRef.current?.meals_completed || {}); }, [syncKey]);
  const saving = useRef(Promise.resolve());
  // build(currentLog) gives the meal results and, for added food, the new
  // off-plan food and calories.
  const persist = build => {
    const run = saving.current.then(async () => {
      setError("");
      const current = logRef.current;
      const { results: updated, offPlan = null } = build(current);
      const fields = {
        ...nutritionLogFields({
          meals, results: updated,
          offPlanCalories: offPlan ? offPlan.calories : current?.off_plan_calories || 0,
          reviewComplete: current ? current.meals_completed?._review_complete !== false : false,
          isTrainingDay,
        }),
        ...(offPlan ? { off_plan_food: offPlan.food, off_plan_calories: offPlan.calories } : {}),
      };
      try {
        const result = current?.id
          ? await supabase.from("nutrition_logs").update(fields).eq("id", current.id).eq("user_id", user.id).select("id").single()
          : await supabase.from("nutrition_logs").insert({ user_id: user.id, date: today, off_plan_food: "", off_plan_calories: 0, created_at: new Date().toISOString(), ...fields }).select("id").single();
        if (result.error) throw result.error;
        const next = { ...(current || {}), user_id: user.id, date: today, ...fields, id: result.data?.id || current?.id };
        logRef.current = next;
        onLogged(next);
        return true;
      } catch (saveError) {
        console.error("Dashboard meal log error:", saveError?.message);
        setError("That couldn't be saved. Check your connection and try again.");
        return false;
      }
    });
    saving.current = run.catch(() => false);
    return run;
  };
  const save = updated => persist(() => ({ results: updated }));
  const markEaten = index => {
    const updated = { ...results, [index]: true };
    setResults(updated);
    return save(updated);
  };
  const addExtra = item => persist(current => {
    const next = addExtraFood({ food: current?.off_plan_food || "", calories: current?.off_plan_calories || 0, results: resultsRef.current }, item);
    setResults(next.results);
    resultsRef.current = next.results;
    return { results: next.results, offPlan: { food: next.food, calories: next.calories } };
  });
  return { results, setResults, save, markEaten, addExtra, error };
}

// One part of the nutrition plan review, with a link to change it.
function PlanReviewSection({ title, onEdit, testId, children }) {
  return (
    <div data-testid={testId} style={{ padding: "10px 0", borderTop: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: NEON, letterSpacing: 1 }}>{title}</div>
        <button type="button" className="t3d-btn t3d-btn-sm" aria-label={`Edit ${title.toLowerCase()}`} style={{ fontSize: 8, padding: "4px 9px" }} onClick={onEdit}>EDIT</button>
      </div>
      <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

// ─── AI Reply Block ───────────────────────────────────────────────────────────
function AiReplyBlock({ feedback, plan, mealResults, isTrainingDay, offPlanFood, offPlanCals, activeMeals }) {
  const [reply, setReply] = useState("");
  const [messages, setMessages] = useState([{ role: "assistant", content: feedback }]);
  const [loading, setLoading] = useState(false);
  const [replyError, setReplyError] = useState("");
  const endRef = useRef(null);

  const send = async () => {
    if (!reply.trim() || loading) return;
    setLoading(true);
    setReplyError("");
    const updated = [...messages, { role: "user", content: reply }];
    setMessages(updated);
    setReply("");
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    try {
      const text = await streamCoachText({ area: "nutrition_chat", messages: recentChatMessages(updated) },
        partial => setMessages([...updated, { role: "assistant", content: partial }]));
      setMessages([...updated, { role: "assistant", content: text }]);
    } catch (e) {
      console.log("Nutrition chat error:", e?.message);
      setReplyError("The coach couldn't reply. Your message is above — try sending it again.");
    }
    setLoading(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  return (
    <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 14, marginBottom: 20, textAlign: "left" }}>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: NEON, letterSpacing: 2, marginBottom: 10 }}>AI COACH</div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 1, color: m.role === "user" ? NEON2 : NEON, fontFamily: "'Orbitron',monospace", marginBottom: 3 }}>{m.role === "user" ? "YOU" : "AI"}</div>
            <div style={{ fontSize: 12, color: m.role === "user" ? "#C0D8E8" : "#8AABB8", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{m.role === "assistant" ? cleanAiText(m.content) : m.content}</div>
          </div>
        ))}
        {loading && <div style={{ fontSize: 11, color: "#E0EAF0" }}>Thinking...</div>}
        {replyError && <div role="alert" style={{ fontSize: 11, color: "#FFB547" }}>{replyError}</div>}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input className="t3d-ai-input" placeholder="Ask a follow up question..." value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()} />
        <button className="t3d-btn t3d-btn-sm" onClick={send} disabled={loading || !reply.trim()}>SEND</button>
      </div>
    </div>
  );
}

function Nutrition({ user, userSessions, profile: savedProfile = null, onProfileChange = () => {} }) {
  const [view, setView] = useState("home");
  // Each screen change starts at the top, not wherever the last screen was scrolled to.
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [isTrainingDay, setIsTrainingDay] = useState(true);

  // Setup
  const [setupStep, setSetupStep] = useState(0);
  const [setupMode, setSetupMode] = useState(null);
  const [bodyWeight, setBodyWeight] = useState("");
  const [goal, setGoal] = useState("Maintain");
  const [activityLevel, setActivityLevel] = useState("Moderately active");
  const [height, setHeight] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  // The user's profile (height, date of birth, sex) fills in the setup; what
  // is entered there is saved back to it.
  const [profile, setProfile] = useState(null);
  const [editProfileFields, setEditProfileFields] = useState(false);
  const [profileSaveNote, setProfileSaveNote] = useState("");
  const [sex, setSex] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [routineWakeTime, setRoutineWakeTime] = useState("");
  const [latestWeight, setLatestWeight] = useState("");
  const [allergyCheckConfirmed, setAllergyCheckConfirmed] = useState(false);
  const [calculatedMacros, setCalculatedMacros] = useState(null);
  const [useCustomTargets, setUseCustomTargets] = useState(false);
  const [customCalories, setCustomCalories] = useState("");
  const [customProtein, setCustomProtein] = useState("");
  const [customCarbs, setCustomCarbs] = useState("");
  const [customFats, setCustomFats] = useState("");
  const [mealsPerDay, setMealsPerDay] = useState(4);
  const [nutritionStyle, setNutritionStyle] = useState("hybrid");
  const [hasRestDayPlan, setHasRestDayPlan] = useState(false);
  const [restBuildMode, setRestBuildMode] = useState(null); // how the rest day meals are being built
  const [restAiLoading, setRestAiLoading] = useState(false);
  const [restPlanNote, setRestPlanNote] = useState("");
  const [mealBuildMode, setMealBuildMode] = useState(null);
  const [planMeals, setPlanMeals] = useState([]);
  const [restDayMeals, setRestDayMeals] = useState([]);
  const [editingRestDay, setEditingRestDay] = useState(false);
  const [commonCategory, setCommonCategory] = useState("breakfast");
  const [addMealModal, setAddMealModal] = useState(false);
  const [editMealIdx, setEditMealIdx] = useState(null);
  const [newMeal, setNewMeal] = useState({ name: "", time: "", ingredients: [], calories: "", protein: "", carbs: "", fats: "" });
  const [newIngredient, setNewIngredient] = useState({ name: "", weight: "", unit: "g" });
  const [aiMealLoading, setAiMealLoading] = useState(false);
  const [aiNutritionStep, setAiNutritionStep] = useState(0);
  const [aiNutritionAnswers, setAiNutritionAnswers] = useState({});
  const [showAiQuestions, setShowAiQuestions] = useState(false);

  // Review
  const [reviewStep, setReviewStep] = useState(0);
  const [mealResults, setMealResults] = useState({});
  const [offPlanFood, setOffPlanFood] = useState("");
  const [offPlanCals, setOffPlanCals] = useState("");
  const [aiFeedback, setAiFeedback] = useState("");
  const [aiFeedbackLoading, setAiFeedbackLoading] = useState(false);
  const [aiFeedbackError, setAiFeedbackError] = useState("");
  const [mealPlanWarning, setMealPlanWarning] = useState(""); // AI meal plan off its own targets
  const [reviewSkipAnswered, setReviewSkipAnswered] = useState(false); // DAY REVIEW skips meals already logged
  const [foodEstimate, setFoodEstimate] = useState(null);
  const [foodEstimateStatus, setFoodEstimateStatus] = useState("");
  const [todayLogged, setTodayLogged] = useState(false);
  const [editingHistoryIdx, setEditingHistoryIdx] = useState(null);
  const [planSaveError, setPlanSaveError] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [nutritionSaveError, setNutritionSaveError] = useState("");
  const [mealLibrary, setMealLibrary] = useState([]);
  const [weeklyMealPlan, setWeeklyMealPlan] = useState({});
  const [plannerDate, setPlannerDate] = useState(() => homeDateKey(user, 1));
  const [showLibraryForm, setShowLibraryForm] = useState(false);
  const [libraryMealDraft, setLibraryMealDraft] = useState({ name: "", calories: "", protein: "", carbs: "", fats: "" });
  const [libraryEditIndex, setLibraryEditIndex] = useState(null); // library meal being edited, or null for a new one
  const [nutritionPlanningStatus, setNutritionPlanningStatus] = useState("");
  // Editing an existing plan opens on the review, with a link to each part.
  const [reviewReturn, setReviewReturn] = useState(false);
  const [setupNotice, setSetupNotice] = useState("");
  // Unsaved plan changes kept on this device, so leaving the editor (another
  // tab, a reload) never loses them.
  const [setupDraft, setSetupDraft] = useState(null);
  const setupBaselineRef = useRef(null);
  const setupDraftKey = `track3d-nutrition-setup-draft:${user?.id}`;
  const targetSuggestionStorageKey = `track3d-target-suggestion:${user?.id}`;
  const [dismissedTargetSuggestion, setDismissedTargetSuggestion] = useState(() => { try { return localStorage.getItem(targetSuggestionStorageKey) || ""; } catch { return ""; } });

  const today = homeDateKey(user);

  useEffect(() => { if (!user) return; loadData(); }, [user]);

  // The profile saved in the app (header PROFILE or the dashboard to-do).
  // Saved while the setup is open, it fills in what the setup still lacks.
  useEffect(() => {
    if (!savedProfile) return;
    setProfile(savedProfile);
    setHeight(current => current || (savedProfile.heightCm ? String(savedProfile.heightCm) : ""));
    setDateOfBirth(current => current || savedProfile.dateOfBirth || "");
    setSex(current => current || sexLabel(savedProfile.sex) || "");
  }, [savedProfile]);

  // Auto detect training day from fitness split
  useEffect(() => {
    if (!userSessions?.length) return;
    const todayShort = dateKeyDayCode(today);
    const isTraining = userSessions.some(s => s.days?.includes(todayShort));
    setIsTrainingDay(isTraining);
  }, [userSessions, today]);

  const readSetupDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(setupDraftKey) || "null");
      return draft?.state ? draft : null;
    } catch { return null; }
  };
  const clearSetupDraft = () => {
    try { localStorage.removeItem(setupDraftKey); } catch { /* nothing was kept */ }
    setSetupDraft(null);
  };
  // What the editor holds (not which step is open).
  const setupContent = {
    setupMode, bodyWeight, goal, activityLevel, height, dateOfBirth, sex, wakeTime, calculatedMacros, useCustomTargets,
    customCalories, customProtein, customCarbs, customFats, mealsPerDay, nutritionStyle, hasRestDayPlan, planMeals, restDayMeals, aiNutritionAnswers,
  };
  useEffect(() => {
    if (view !== "setup") { setupBaselineRef.current = null; return; }
    const content = JSON.stringify(setupContent);
    if (setupBaselineRef.current === null) { setupBaselineRef.current = content; return; }
    try {
      if (content === setupBaselineRef.current) localStorage.removeItem(setupDraftKey);
      else localStorage.setItem(setupDraftKey, JSON.stringify({ savedAt: Date.now(), planUpdatedAt: plan?.updated_at || null, baseline: setupBaselineRef.current, state: { ...setupContent, setupStep, editingRestDay, restBuildMode, mealBuildMode } }));
    } catch { /* the editor still works without browser storage */ }
  });
  const restoreSetupDraft = (draft, step = null) => {
    const saved = draft.state;
    setSetupStep(step ?? saved.setupStep ?? 0);
    setSetupMode(saved.setupMode ?? null);
    setBodyWeight(saved.bodyWeight ?? "");
    setGoal(saved.goal || "Maintain");
    setActivityLevel(saved.activityLevel || "Moderately active");
    setHeight(saved.height ?? "");
    setDateOfBirth(saved.dateOfBirth ?? "");
    setSex(saved.sex ?? "");
    setWakeTime(saved.wakeTime ?? "");
    setCalculatedMacros(saved.calculatedMacros ?? null);
    setUseCustomTargets(Boolean(saved.useCustomTargets));
    setCustomCalories(saved.customCalories ?? ""); setCustomProtein(saved.customProtein ?? "");
    setCustomCarbs(saved.customCarbs ?? ""); setCustomFats(saved.customFats ?? "");
    setMealsPerDay(saved.mealsPerDay || 4);
    setNutritionStyle(saved.nutritionStyle || "hybrid");
    setHasRestDayPlan(Boolean(saved.hasRestDayPlan));
    setRestBuildMode(saved.restBuildMode ?? null);
    setMealBuildMode(saved.mealBuildMode ?? null);
    setPlanMeals(saved.planMeals || []);
    setRestDayMeals(saved.restDayMeals || []);
    setEditingRestDay(Boolean(saved.editingRestDay));
    setAiNutritionAnswers(saved.aiNutritionAnswers || {});
    setAiNutritionStep(0);
    setShowAiQuestions(false);
    setEditProfileFields(false);
    setProfileSaveNote("");
    setRestPlanNote("");
    setAllergyCheckConfirmed(false);
    setMealPlanWarning("");
    setPlanSaveError(false);
    setReviewReturn(Boolean(plan));
    setSetupNotice("Your unsaved changes from earlier are back.");
    // Still unsaved compared with the plan.
    setupBaselineRef.current = draft.baseline ?? null;
    setView("setup");
  };
  // Leave the editor; unsaved changes stay kept for later.
  const leaveSetup = () => {
    setView("home");
    setSetupDraft(readSetupDraft());
  };
  // KEEP MY TARGETS is saved with the plan, so it holds on every device; this
  // browser keeps a copy in case the plan can't be updated.
  const dismissTargetSuggestion = async key => {
    setDismissedTargetSuggestion(key);
    try { localStorage.setItem(targetSuggestionStorageKey, key); } catch { /* the plan keeps it */ }
    if (!user || !plan) return;
    const setup = { ...(plan.setup || {}), targetSuggestionDismissed: key };
    const { error } = await supabase.from("nutrition_plans").update({ setup }).eq("user_id", user.id);
    if (error) { console.log("Target suggestion save error:", error.message); return; }
    setPlan(current => (current ? { ...current, setup } : current));
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: planData } = await readNutritionPlan(user.id);
      // Unsaved changes are only offered while the plan they started from is current.
      const draft = readSetupDraft();
      if (draft && draft.planUpdatedAt === (planData?.updated_at || null)) setSetupDraft(draft);
      else if (draft) clearSetupDraft();
      if (planData) {
        setPlan(planData);
        setNutritionStyle(inferNutritionStyle(planData.meals || []));
        setMealsPerDay(Math.max(1, planData.meals?.length || 4));
        setMealLibrary(mergeMealLibrary(planData.meal_library || [], planData.meals || []));
        setWeeklyMealPlan(planData.weekly_meal_plan || {});
      }
      // Wake-up time for meal times, and the last weigh-in to start the weight
      // field. The profile comes from the app, so a profile saved anywhere
      // shows here straight away.
      const [{ data: routineRow }, { data: weighIns }] = await Promise.all([
        readMorningRoutine(user.id),
        supabase.from("morning_checkins").select("date,data").eq("user_id", user.id).order("date", { ascending: false }).limit(14),
      ]);
      setRoutineWakeTime(routineRow?.wake_time || "");
      const weighed = (weighIns || []).find(row => Number(row.data?.weight) > 0);
      setLatestWeight(weighed ? String(weighed.data.weight) : "");
      const { data: logData } = await supabase.from("nutrition_logs").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(30);
      if (logData) {
        setLogs(logData);
        const currentLog = logData.find(l => l.date === today);
        if (currentLog) {
          setMealResults(currentLog.meals_completed || {});
          setOffPlanFood(currentLog.off_plan_food || "");
          setOffPlanCals(String(currentLog.off_plan_calories || ""));
          setTodayLogged(currentLog.meals_completed?._review_complete !== false);
        }
      }
    } catch (e) { console.log("Load error:", e); }
    setLoading(false);
  };

  const getFinalMacros = () => {
    if (useCustomTargets) {
      return { calories: parseInt(customCalories)||0, protein: parseInt(customProtein)||0, carbs: parseInt(customCarbs)||0, fats: parseInt(customFats)||0 };
    }
    return calculatedMacros || { calories: 2000, protein: 150, carbs: 200, fats: 65 };
  };

  // Returns the saved row, or false. The setup answers are kept so Edit Plan
  // starts from them; if the setup column is not in the database yet the
  // plan still saves without them.
  const savePlan = async (trainingMeals, restMeals, macros) => {
    if (!user) return false;
    const setup = {
      mode: setupMode,
      weight: Number(bodyWeight) || null,
      height: Number(height) || null,
      dateOfBirth: dateOfBirth || null,
      sex: sex || null,
      activityLevel,
      goal,
      mealsPerDay,
      wakeTime: wakeTime || null,
      answers: aiNutritionAnswers,
      tdee: macros.tdee ?? calculatedMacros?.tdee ?? null,
      // A KEEP MY TARGETS choice still holds after the plan is saved again.
      ...(plan?.setup?.targetSuggestionDismissed ? { targetSuggestionDismissed: plan.setup.targetSuggestionDismissed } : {}),
    };
    const row = {
      daily_calories: macros.calories,
      protein_target: macros.protein,
      carbs_target: macros.carbs,
      fats_target: macros.fats,
      goal,
      meals: trainingMeals,
      rest_day_meals: restMeals,
      setup,
      updated_at: new Date().toISOString(),
    };
    try {
      const { data: existing } = await supabase.from("nutrition_plans").select("id").eq("user_id", user.id).maybeSingle();
      const write = values => (existing
        ? supabase.from("nutrition_plans").update(values).eq("user_id", user.id)
        : supabase.from("nutrition_plans").insert({ user_id: user.id, ...values }));
      let result = await write(row);
      if (result.error && /setup/i.test(result.error.message || "")) {
        const { setup: _setup, ...withoutSetup } = row;
        result = await write(withoutSetup);
      }
      if (result.error) {
        console.error("savePlan error:", result.error.message, result.error.code, result.error.details, result.error.hint);
        setPlanSaveError(result.error.message || "database error");
        return false;
      }
      return row;
    } catch (e) {
      console.error("savePlan exception:", e.message || e);
      setPlanSaveError(e?.message || "connection problem");
      return false;
    }
  };

  const trainingDaysCount = new Set((userSessions || []).flatMap(session => session.days || [])).size;

  // Setup and Edit Plan both start here. Edit Plan fills in what the user
  // entered last time (or their plan and last weigh-in), so saving never
  // resets the goal or other answers.
  // step: where to open (an existing plan opens on the review).
  const openSetup = ({ step = null } = {}) => {
    const draft = readSetupDraft();
    if (draft && draft.planUpdatedAt === (plan?.updated_at || null)) { restoreSetupDraft(draft, step); return; }
    const saved = plan?.setup || {};
    setSetupStep(step ?? (plan ? 3 : 0));
    setReviewReturn(Boolean(plan));
    setSetupNotice("");
    setSetupMode(plan ? saved.mode || null : null);
    setUseCustomTargets(saved.mode === "custom");
    setBodyWeight(String(saved.weight || latestWeight || ""));
    // Profile first, then what this setup saved last time.
    setHeight(String(profile?.heightCm || saved.height || ""));
    setDateOfBirth(profile?.dateOfBirth || saved.dateOfBirth || "");
    setSex(sexLabel(profile?.sex) || saved.sex || "");
    setEditProfileFields(false);
    setProfileSaveNote("");
    setGoal(normaliseNutritionGoal(saved.goal || plan?.goal) || "Maintain");
    setActivityLevel(ACTIVITY_LEVELS.some(level => level.id === saved.activityLevel) ? saved.activityLevel : suggestActivityLevel(trainingDaysCount));
    setAiNutritionAnswers(saved.answers || {});
    setAiNutritionStep(0);
    setShowAiQuestions(false);
    setWakeTime(saved.wakeTime || routineWakeTime || "");
    setEditingRestDay(false);
    setRestPlanNote("");
    setAllergyCheckConfirmed(false);
    setMealPlanWarning("");
    setPlanSaveError(false);
    if (plan) {
      setCustomCalories(String(plan.daily_calories || "")); setCustomProtein(String(plan.protein_target || ""));
      setCustomCarbs(String(plan.carbs_target || "")); setCustomFats(String(plan.fats_target || ""));
      setCalculatedMacros({ calories: plan.daily_calories, protein: plan.protein_target, carbs: plan.carbs_target, fats: plan.fats_target, tdee: saved.tdee || null });
      setNutritionStyle(inferNutritionStyle(plan.meals || []));
      setMealsPerDay(Math.max(1, Number(saved.mealsPerDay) || plan.meals?.length || 4));
      setPlanMeals(plan.meals || []);
      setRestDayMeals(plan.rest_day_meals || []);
      setHasRestDayPlan(Boolean(plan.rest_day_meals?.length));
      setMealBuildMode(plan.meals?.length ? "own" : null);
      setRestBuildMode(plan.rest_day_meals?.length ? "own" : null);
    }
    setView("setup");
  };

  // EDIT MEALS / EDIT MEAL PLAN: straight to the meals step, keeping the
  // current targets.
  const openMealEditor = (restDay = false) => {
    openSetup({ step: 2 });
    setEditingRestDay(Boolean(restDay && plan?.rest_day_meals?.length));
  };

  // New targets worked out from the profile: shown on the review with the
  // meals, ready to save.
  const openTargetUpdate = suggestion => {
    openSetup({ step: 3 });
    setSetupMode("guided");
    setUseCustomTargets(false);
    setBodyWeight(String(suggestion.stats.weight || ""));
    setHeight(String(suggestion.stats.height || ""));
    setDateOfBirth(profile?.dateOfBirth || "");
    setSex(suggestion.stats.sex || "");
    setGoal(suggestion.stats.goal);
    setActivityLevel(suggestion.stats.activityLevel);
    setCalculatedMacros(suggestion.targets);
    setSetupNotice(`New targets from your profile: ${suggestion.targets.calories.toLocaleString("en-GB")} kcal (was ${Number(plan?.daily_calories || 0).toLocaleString("en-GB")}). Check your meals still fit, then save.`);
  };

  const persistNutritionPlanning = async (library = mealLibrary, datedPlan = weeklyMealPlan) => {
    if (!user) return false;
    setNutritionPlanningStatus("SAVING...");
    const { error } = await supabase.from("nutrition_plans").update({ meal_library: library, weekly_meal_plan: datedPlan, updated_at: new Date().toISOString() }).eq("user_id", user.id);
    if (error) {
      console.error("Nutrition planning save error:", error.message);
      setNutritionPlanningStatus("COULD NOT SAVE — DATABASE UPDATE REQUIRED");
      return false;
    }
    setNutritionPlanningStatus("SAVED");
    return true;
  };

  const saveLibraryMeal = async () => {
    if (!libraryMealDraft.name.trim()) return;
    const editing = libraryEditIndex !== null ? mealLibrary[libraryEditIndex] : null;
    const meal = {
      ...(editing || {}),
      id: editing?.id || globalThis.crypto?.randomUUID?.() || `meal-${Date.now()}`,
      name: libraryMealDraft.name.trim(),
      ingredients: editing?.ingredients || [],
      mealType: "fixed",
      repeatDaily: true,
      calories: Number(libraryMealDraft.calories) || 0,
      protein: Number(libraryMealDraft.protein) || 0,
      carbs: Number(libraryMealDraft.carbs) || 0,
      fats: Number(libraryMealDraft.fats) || 0,
    };
    const next = editing
      ? mealLibrary.map((item, index) => (index === libraryEditIndex ? meal : item))
      : mergeMealLibrary(mealLibrary, [meal]);
    setMealLibrary(next);
    closeLibraryForm();
    await persistNutritionPlanning(next, weeklyMealPlan);
  };

  // A meal made up while swapping a meal is kept in the library for next time.
  const addMealToLibrary = async meal => {
    const next = mergeMealLibrary(mealLibrary, [{ ...meal, id: globalThis.crypto?.randomUUID?.() || `meal-${Date.now()}`, ingredients: [] }]);
    setMealLibrary(next);
    await persistNutritionPlanning(next, weeklyMealPlan);
  };

  const closeLibraryForm = () => {
    setLibraryMealDraft({ name: "", calories: "", protein: "", carbs: "", fats: "" });
    setLibraryEditIndex(null);
    setShowLibraryForm(false);
  };

  const editLibraryMeal = index => {
    const meal = mealLibrary[index];
    setLibraryMealDraft({ name: meal.name || "", calories: String(meal.calories ?? ""), protein: String(meal.protein ?? ""), carbs: String(meal.carbs ?? ""), fats: String(meal.fats ?? "") });
    setLibraryEditIndex(index);
    setShowLibraryForm(true);
  };

  const deleteLibraryMeal = async index => {
    const next = mealLibrary.filter((_, mealIndex) => mealIndex !== index);
    setMealLibrary(next);
    closeLibraryForm();
    await persistNutritionPlanning(next, weeklyMealPlan);
  };

  const updateDatedMealPlan = async (dateKey, meals) => {
    const next = { ...weeklyMealPlan, [dateKey]: meals };
    setWeeklyMealPlan(next);
    await persistNutritionPlanning(mealLibrary, next);
  };

  // offPlan overrides the off-plan food and calories in state (for food
  // added just now, before state has updated).
  const saveLog = async (resultsOverride = mealResults, reviewComplete = true, offPlan = null) => {
    if (!user) return false;
    setNutritionSaveError("");
    const food = offPlan ? offPlan.food : offPlanFood;
    const calories = offPlan ? offPlan.calories : offPlanCals;
    const activeMeals = mealsForDay({ ...plan, weekly_meal_plan: weeklyMealPlan }, today, isTrainingDay);
    // Off-plan figures only apply while there are off-plan calories.
    const { _off_plan: offPlanMacros, ...mealOnlyResults } = resultsOverride || {};
    const results = Number(calories) > 0 && offPlanMacros ? { ...mealOnlyResults, _off_plan: offPlanMacros } : mealOnlyResults;
    const totals = calculateLoggedNutrition(activeMeals, results, calories);
    const row = {
      meals_completed: { ...results, _review_complete: reviewComplete },
      off_plan_food: food, off_plan_calories: parseInt(calories)||0,
      total_calories: totals.calories, total_protein: totals.protein,
      ai_feedback: aiFeedback, is_training_day: isTrainingDay,
      created_at: new Date().toISOString(),
    };
    try {
      const { data: existing, error: lookupError } = await supabase.from("nutrition_logs").select("id").eq("user_id", user.id).eq("date", today).maybeSingle();
      if (lookupError) throw lookupError;
      const result = existing
        ? await supabase.from("nutrition_logs").update(row).eq("id", existing.id).eq("user_id", user.id).select("id").single()
        : await supabase.from("nutrition_logs").insert({ user_id: user.id, date: today, ...row }).select("id").single();
      if (result.error) throw result.error;
      setLogs(current => [{ ...(current.find(log => log.date === today) || {}), id: result.data.id, user_id: user.id, date: today, ...row }, ...current.filter(log => log.date !== today)]);
      return true;
    } catch (error) {
      console.error("Nutrition save error:", error);
      setNutritionSaveError(error?.message || "Your nutrition could not be saved. Please try again.");
      return false;
    }
  };

  // Save meal answers as they are given during the review, so leaving part-way
  // never loses them. A finished day keeps its finished status.
  const reviewAutosaveRef = useRef(false);
  useEffect(() => {
    if (view !== "review") { reviewAutosaveRef.current = false; return; }
    if (!reviewAutosaveRef.current) { reviewAutosaveRef.current = true; return; }
    saveLog(mealResults, todayLogged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealResults, view]);

  // "Log something else": the food joins today's off-plan food and counts
  // towards every target straight away.
  const addExtraToToday = async item => {
    const next = addExtraFood({ food: offPlanFood, calories: offPlanCals, results: mealResults }, item);
    setOffPlanFood(next.food);
    setOffPlanCals(String(next.calories));
    setMealResults(next.results);
    return saveLog(next.results, todayLogged, { food: next.food, calories: next.calories });
  };

  // Asks the coach for per-item ranges using the user's own amounts; the
  // totals are added up in code.
  const estimateUnloggedFood = async items => {
    setFoodEstimateStatus("ESTIMATING...");
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: await chatHeaders(),
        body: JSON.stringify({ area: "food_estimate", messages: [{ role: "user", content: `Estimate this food exactly as I described it:\n${items.map(item => `- ${item.food}`).join("\n")}` }] }),
      });
      const parsed = extractJsonObject(await readCoachReply(res));
      const estimate = sumFoodEstimate(parsed?.items);
      if (!estimate.items.length) throw new Error("no items in the estimate");
      setFoodEstimate(estimate);
      setFoodEstimateStatus("");
    } catch (error) {
      console.log("Food estimate error:", error?.message);
      setFoodEstimateStatus("Couldn't estimate that just now. You can type the calories in the off-plan step instead.");
    }
  };

  const getAIFeedback = async () => {
    setAiFeedbackLoading(true);
    setAiFeedbackError("");
    const activeMeals = mealsForDay({ ...plan, weekly_meal_plan: weeklyMealPlan }, today, isTrainingDay);
    const totals = calculateLoggedNutrition(activeMeals, mealResults, offPlanCals);
    const completedCount = totals.completedMeals;
    const totalCals = totals.calories;
    const targets = dayTargets(plan, isTrainingDay);
    const calorieTarget = targets.calories || 2000;
    const diff = totalCals - calorieTarget;
    try {
      const text = await streamCoachText({
          area: "nutrition_day",
          messages: [{ role: "user", content: `Nutrition day summary: ${completedCount}/${activeMeals.length} meals logged. Planning style: ${inferNutritionStyle(activeMeals)}. Off plan: ${offPlanFood || "none"} (${Number(offPlanCals) > 0 ? `${offPlanCals} extra kcal` : "no calories entered"}). Meal notes: ${activeMeals.map((meal, index) => { const result = mealResults[index]; const swap = mealSwap(result); return swap ? `${meal.name}: swapped for ${swap.name} (${swap.calories} kcal, ${swap.protein}g protein)` : result && typeof result === "object" && result.note ? `${meal.name}: ${result.note}` : null; }).filter(Boolean).join("; ") || "none"}. Unlogged food with no calories: ${unloggedFood(activeMeals, mealResults, offPlanFood, offPlanCals).map(item => item.food).join("; ") || "none"}. Logged total: ${totalCals} kcal vs ${calorieTarget} target (${diff>0?"+":""}${diff})${unloggedFood(activeMeals, mealResults, offPlanFood, offPlanCals).length ? " — incomplete, excludes the unlogged food" : ""}. Protein: ${totals.protein}g vs ${targets.protein}g target. Goal: ${plan?.goal}. ${isTrainingDay ? "Training day." : targets.restDay ? "Rest day (lighter rest day target)." : "Rest day."} Give brief feedback.` }],
      }, setAiFeedback);
      setAiFeedback(text);
    } catch (e) {
      console.log("Nutrition feedback error:", e?.message);
      setAiFeedback("");
      setAiFeedbackError("Couldn't get feedback on your day.");
    }
    setAiFeedbackLoading(false);
  };

  // A lighter rest day version of the training day meals: the rest day
  // target (about 12% fewer calories, mostly from carbs, the same protein).
  // Allergies still apply.
  const buildRestDayAI = async () => {
    if (!planMeals.length || restAiLoading) return;
    setRestAiLoading(true);
    setRestPlanNote("");
    const macros = getFinalMacros();
    const minCalories = calorieFloor(sex);
    const restCals = Math.max(restDayCalories(macros.calories, minCalories), minCalories);
    const targets = { calories: restCals, protein: macros.protein };
    const preferences = preferencesText(aiNutritionAnswers);
    try {
      const result = await requestMealPlan("rest_day_plan", `Build a ${mealsPerDay} meal REST DAY plan. Targets: ${restCals} kcal (slightly lower than training day ${macros.calories}), ${macros.protein}g protein, fewer carbs. Goal: ${goal}. Base it loosely on similar foods to: ${planMeals.map(m => m.name).join(", ")}${preferences ? `\nUser preferences:\n${preferences}` : ""}`, targets, { allergies: parseAllergies(aiNutritionAnswers.allergies), wakeTime, minCalories });
      setRestDayMeals(result.meals);
      setRestBuildMode("ai");
      if (mealPlanNeedsWarning(result.check)) setRestPlanNote(`Rest day: ${mealPlanWarningText(result.check, targets)}`);
    } catch (error) {
      console.error("Rest day plan error:", error);
      setRestPlanNote(error?.belowMinimum ? belowMinimumText(minCalories) : "Couldn't build the rest day plan just now. Please try again.");
    }
    setRestAiLoading(false);
  };

  // answers is passed in when the last answer was just chosen (state is not updated yet).
  const buildAIMeals = async (answers = aiNutritionAnswers) => {
    setAiMealLoading(true);
    setShowAiQuestions(false);
    const macros = getFinalMacros();
    const minCalories = calorieFloor(sex);
    const slots = mealTimeSlots(wakeTime, mealsPerDay);
    setMealPlanWarning("");
    try {
      const targets = { calories: Math.max(macros.calories, minCalories), protein: macros.protein };
      const result = await requestMealPlan("meal_plan_build", `Build a ${mealsPerDay} meal daily plan. Goal: ${goal}. Targets: ${targets.calories} kcal, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fats}g fats.${slots.length ? ` The user wakes at ${wakeTime}; use these meal times in order: ${slots.join(", ")}.` : ""}\nUser preferences:\n${preferencesText(answers) || "none given"}`, targets, { allergies: parseAllergies(answers.allergies), wakeTime, minCalories });
      setPlanMeals(result.meals);
      if (mealPlanNeedsWarning(result.check)) setMealPlanWarning(mealPlanWarningText(result.check, targets));
    } catch (e) { console.error("AI meals error:", e); setMealPlanWarning(e?.belowMinimum ? belowMinimumText(minCalories) : "Couldn't build your meal plan just now. Please try again."); }
    setAiMealLoading(false);
  };

  const activeMeals = plan ? mealsForDay({ ...plan, weekly_meal_plan: weeklyMealPlan }, today, isTrainingDay) : [];
  const activeNutritionStyle = inferNutritionStyle(activeMeals);
  const loggedNutrition = calculateLoggedNutrition(activeMeals, mealResults, offPlanCals);
  // Today's targets: rest days with their own meals have a lighter one.
  const todayTargets = dayTargets(plan, isTrainingDay);
  const remainingNutrition = remainingNutritionTargets(todayTargets, loggedNutrition);
  const offPlanRoughCalories = offPlanNutrition(offPlanCals, mealResults?._off_plan).roughCalories;
  const planningDates = Array.from({ length: 7 }, (_, index) => {
    const key = shiftDateKey(today, index + 1);
    return { key, label: index === 0 ? "TOMORROW" : dateKeyLabel(key, { weekday: "short", day: "numeric", month: "short" }).toUpperCase() };
  });
  const plannerMeals = weeklyMealPlan[plannerDate] || [];
  const plannerDayCode = plannerDate ? dateKeyDayCode(plannerDate) : "";
  const plannerIsTrainingDay = userSessions?.some(session => session.days?.includes(plannerDayCode));
  const plannerTemplateMeals = plannerIsTrainingDay ? (plan?.meals || []) : (plan?.rest_day_meals?.length ? plan.rest_day_meals : plan?.meals || []);

  const last7Logs = Array.from({ length: 7 }, (_, i) => {
    const ds = shiftDateKey(today, -(6 - i));
    return { date: ds, label: dateKeyLabel(ds, { weekday: "short" }), log: logs.find(l => l.date === ds) };
  });

  // This week runs from Sunday, as before, but on the home-timezone date.
  const weekStartKey = shiftDateKey(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
  const weekLogs = logs.filter(l => l.date >= weekStartKey && l.date <= today);
  const avgCals = weekLogs.length ? Math.round(weekLogs.reduce((a,l) => a+(l.total_calories||0),0)/weekLogs.length) : 0;
  const avgProtein = weekLogs.length ? Math.round(weekLogs.reduce((a,l) => a+(l.total_protein||0),0)/weekLogs.length) : 0;
  const nutritionLogOnTarget = log => nutritionDayOnTarget(log, plan);
  const onPlanDays = weekLogs.filter(nutritionLogOnTarget).length;

  const streak = (() => {
    let s = 0;
    while (s < 100) {
      const ds = shiftDateKey(today, -s);
      const log = logs.find(l => l.date === ds);
      if (!log) break;
      if (!nutritionLogOnTarget(log)) break;
      s++;
    }
    return s;
  })();

  if (loading) return <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 11, color: "#E0EAF0", letterSpacing: 2 }}>LOADING NUTRITION...</div></div></div>;

  // ── DAY REVIEW ────────────────────────────────────────────────────────────
  if (view === "review") {
    const meals = activeMeals;
    // Leaves the review without saving its answers; what was saved before stays.
    const reviewBack = (
      <button type="button" className="t3d-btn t3d-btn-sm" style={{ marginBottom: 14, minHeight: 44 }} onClick={() => {
        const savedToday = logs.find(log => log.date === today);
        setMealResults(savedToday?.meals_completed || {});
        setOffPlanFood(savedToday?.off_plan_food || "");
        setOffPlanCals(String(savedToday?.off_plan_calories || ""));
        setView("home");
      }}>← BACK TO NUTRITION</button>
    );
    const isOffPlanStep = reviewStep === meals.length;
    const isCompleteStep = reviewStep > meals.length;

    if (isCompleteStep) {
      const totals = calculateLoggedNutrition(meals, mealResults, offPlanCals);
      const totalCals = totals.calories;
      const totalProtein = totals.protein;
      const targetCals = todayTargets.calories || 2000;
      const diff = totalCals - targetCals;
      const completedMeals = totals.completedMeals;
      // Food eaten without calories makes the total incomplete: never call
      // that day under target.
      const unlogged = unloggedFood(meals, mealResults, offPlanFood, offPlanCals);

      return (
        <div className="t3d-fade">
          {reviewBack}
          <div className="t3d-card" style={{ textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: NEON, letterSpacing: 3, marginBottom: 24 }}>DAY COMPLETE</div>
            <div className="t3d-grid3" style={{ marginBottom: 20 }}>
              <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: completedMeals===meals.length?NEON:"#FF8C00" }}>{completedMeals}/{meals.length}</div><div style={{ fontSize: 9, color: "#E0EAF0" }}>MEALS LOGGED</div></div>
              <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: Math.abs(diff)<100?NEON:diff>0?NEON3:"#FF8C00" }}>{totalCals}</div><div style={{ fontSize: 9, color: "#E0EAF0" }}>KCAL TOTAL</div></div>
              <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: totalProtein>=todayTargets.protein?NEON:"#FF8C00" }}>{totalProtein}g</div><div style={{ fontSize: 9, color: "#E0EAF0" }}>PROTEIN</div></div>
            </div>
            {unlogged.length > 0 ? (
              <div data-testid="total-excludes" style={{ background: "rgba(255,181,71,.06)", border: "1px solid rgba(255,181,71,.3)", borderRadius: 8, padding: 16, marginBottom: 20, textAlign: "left" }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: "#FFB547", letterSpacing: 2, marginBottom: 8 }}>TOTAL IS INCOMPLETE</div>
                <div style={{ fontSize: 11, color: "#C5D6DC", lineHeight: 1.6 }}>Total excludes: {unlogged.map(item => item.food).join(", ")}. Add calories for it, or let the coach estimate it.</div>
                {foodEstimate && (
                  <div data-testid="food-estimate" style={{ marginTop: 10, fontSize: 11, color: "#C5D6DC", lineHeight: 1.6 }}>
                    {foodEstimate.items.map(item => <div key={item.name}>- {item.name}{item.amount ? ` (${item.amount})` : ""}: {item.caloriesLow}–{item.caloriesHigh} kcal, {item.proteinLow}–{item.proteinHigh} g protein</div>)}
                    <div style={{ color: "#FFB547", marginTop: 4 }}>Estimate: {foodEstimate.caloriesLow.toLocaleString()}–{foodEstimate.caloriesHigh.toLocaleString()} kcal, {foodEstimate.proteinLow}–{foodEstimate.proteinHigh} g protein · about {foodEstimate.carbsMid} g carbs, {foodEstimate.fatsMid} g fat</div>
                    <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 8 }} onClick={() => {
                      setOffPlanFood([offPlanFood, ...unlogged.filter(item => item.meal !== "Off plan").map(item => item.food)].filter(Boolean).join("; "));
                      setOffPlanCals(String((Number(offPlanCals) || 0) + foodEstimate.caloriesMid));
                      // The protein, carbs and fat count towards today too, not just the calories.
                      setMealResults(current => addOffPlanMacros(current, foodEstimate, offPlanCals));
                      setFoodEstimate(null);
                      setFoodEstimateStatus(`Added ${foodEstimate.caloriesMid.toLocaleString()} kcal, ${foodEstimate.proteinMid} g protein, ${foodEstimate.carbsMid} g carbs and ${foodEstimate.fatsMid} g fat (the middle of the estimate).`);
                    }}>ADD ~{foodEstimate.caloriesMid.toLocaleString()} KCAL TO TODAY</button>
                  </div>
                )}
                {!foodEstimate && <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 10 }} disabled={foodEstimateStatus === "ESTIMATING..."} onClick={() => estimateUnloggedFood(unlogged)}>{foodEstimateStatus === "ESTIMATING..." ? "ESTIMATING..." : "ESTIMATE IT"}</button>}
                {foodEstimateStatus && foodEstimateStatus !== "ESTIMATING..." && <div role="status" style={{ fontSize: 10, color: "#FFB547", marginTop: 6 }}>{foodEstimateStatus}</div>}
              </div>
            ) : (
            <div style={{ background: diff>200?"rgba(255,45,120,.06)":diff<-200?"rgba(255,140,0,.06)":"rgba(0,255,178,.06)", border: `1px solid ${diff>200?"rgba(255,45,120,.2)":diff<-200?"rgba(255,140,0,.2)":"rgba(0,255,178,.2)"}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: diff>200?NEON3:diff<-200?"#FF8C00":NEON, letterSpacing: 2, marginBottom: 8 }}>
                {diff>200?"OVER TARGET":diff<-200?"UNDER TARGET":"ON TARGET"} {diff>0?`+${diff}`:diff} KCAL
              </div>
              <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>
                {diff>200?`${diff} extra kcal. Over 7 days this pattern = ~${Math.round(diff*7/7700*10)/10}kg gained per week.`:diff<-200?`${Math.abs(diff)} kcal under target. Regularly eating well under target makes it harder to keep muscle and train well.`:"Close to your calorie target today."}
              </div>
            </div>
            )}
            {foodEstimateStatus && unlogged.length === 0 && <div role="status" style={{ fontSize: 10, color: NEON, marginBottom: 12 }}>{foodEstimateStatus}</div>}
            {offPlanFood && (
              <div style={{ background: "rgba(255,140,0,.05)", border: "1px solid rgba(255,140,0,.2)", borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 11, color: "#8AABB8", textAlign: "left" }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#FF8C00", letterSpacing: 2, marginBottom: 4 }}>OFF PLAN — EXTRA ON TOP</div>
                {offPlanFood}{offPlanCals ? ` — +${offPlanCals} extra kcal added to total` : " — no calories estimated"}
              </div>
            )}
            {aiFeedbackError && !aiFeedbackLoading && <p role="alert" style={{ fontSize: 11, color: "#FFB547", margin: "0 0 8px" }}>{aiFeedbackError}</p>}
            {!aiFeedback && !aiFeedbackLoading && <button className="t3d-btn" style={{ width: "100%", marginBottom: 16 }} onClick={getAIFeedback}>{aiFeedbackError ? "TRY AGAIN" : "GET AI FEEDBACK"}</button>}
            {aiFeedbackLoading && <div style={{ fontSize: 11, color: aiFeedback ? "#8AABB8" : "#E0EAF0", marginBottom: 16, lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign: "left" }}>{aiFeedback ? cleanAiText(aiFeedback) : "AI analysing your day..."}</div>}
            {aiFeedback && !aiFeedbackLoading && <AiReplyBlock feedback={aiFeedback} plan={plan} mealResults={mealResults} isTrainingDay={isTrainingDay} offPlanFood={offPlanFood} offPlanCals={offPlanCals} activeMeals={activeMeals} />}
            {nutritionSaveError && <div role="alert" style={{ color: NEON3, fontSize: 10, lineHeight: 1.5, marginBottom: 10 }}>Could not save: {nutritionSaveError}</div>}
            <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={async () => { const saved = await saveLog(); if (!saved) return; setTodayLogged(true); await loadData(); setView("home"); }}>SAVE & FINISH</button>
          </div>
        </div>
      );
    }

    if (isOffPlanStep) {
      return (
        <div className="t3d-fade">
          {reviewBack}
          <div className="t3d-card">
            <div className="t3d-progress-dots">
              {[...meals.map((_,i)=>i), "offplan"].map((_,i) => <div key={i} className={`t3d-dot-step ${i===reviewStep?"active":i<reviewStep?"done":""}`} />)}
            </div>
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🍕</div>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, color: "#E0EAF0", letterSpacing: 2, marginBottom: 16 }}>BE HONEST</div>
              {(() => {
                const noted = unloggedFood(meals, mealResults, "", 0);
                return noted.length ? (
                  <div data-testid="already-noted" style={{ fontSize: 11, color: "#8AABB8", marginBottom: 14, lineHeight: 1.6, textAlign: "left" }}>
                    Already noted: {noted.map(item => `${item.meal} — ${item.food}`).join("; ")}.
                  </div>
                ) : null;
              })()}
              <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 20, lineHeight: 1.6 }}>{unloggedFood(meals, mealResults, "", 0).length ? "Anything else off plan today?" : "Did you eat anything off plan today?"}</div>

              {/* Off plan input first */}
              <div style={{ background: SURFACE2, borderRadius: 8, padding: 16, marginBottom: 16, textAlign: "left" }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 8, letterSpacing: 1 }}>WHAT DID YOU HAVE?</div>
                <input className="t3d-input" placeholder="e.g. chocolate bar, crisps, takeaway..." value={offPlanFood} onChange={e => setOffPlanFood(e.target.value)} style={{ marginBottom: 10 }} />
                <input className="t3d-input" type="number" placeholder="Estimated extra calories (optional)" value={offPlanCals} onChange={e => setOffPlanCals(e.target.value)} />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button className="t3d-btn" style={{ flex: 1, padding: 14, background: "rgba(0,255,178,.1)", borderColor: NEON, color: NEON }}
                  onClick={() => { setOffPlanFood(""); setOffPlanCals(""); setReviewStep(s => s+1); }}>
                  {unloggedFood(meals, mealResults, "", 0).length ? "✓ Nothing else" : "✓ Clean day"}
                </button>
                <button className="t3d-btn" style={{ flex: 1, padding: 14 }} disabled={!offPlanFood}
                  onClick={() => setReviewStep(s => s+1)}>
                  LOG IT →
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const meal = meals[reviewStep];
    if (isFlexibleMeal(meal)) {
      const flexibleResult = typeof mealResults[reviewStep] === "object" ? mealResults[reviewStep] : {};
      const updateFlexibleResult = (key, value) => setMealResults(results => ({ ...results, [reviewStep]: { ...flexibleResult, completed: false, [key]: value } }));
      return (
        <div className="t3d-fade">
          {reviewBack}
          <div className="t3d-card">
            <div className="t3d-progress-dots">
              {[...meals.map((_,i)=>i), "offplan"].map((_,i) => <div key={i} className={`t3d-dot-step ${i===reviewStep?"active":i<reviewStep?"done":""}`} />)}
            </div>
            <div style={{ textAlign: "center", marginBottom: 8, fontSize: 10, color: "#E0EAF0", letterSpacing: 2 }}>MEAL {reviewStep+1} OF {meals.length}</div>
            <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, color: NEON2, marginBottom: 6 }}>FLEXIBLE MEAL</div>
              <div style={{ color: "#8AABB8", fontSize: 10, lineHeight: 1.5, marginBottom: 15 }}>Log what this meal contributed. Your daily totals matter more than matching a prescribed food.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, textAlign: "left", marginBottom: 14 }}>
                {[["calories","Calories","kcal"],["protein","Protein","g"],["carbs","Carbs","g"],["fats","Fats","g"]].map(([key,label,unit]) => (
                  <label key={key} style={{ color: "#8AABB8", fontSize: 9 }}>{label} <span style={{ color: "#526873" }}>target {meal[key] || 0}{unit}</span>
                    <input className="t3d-input" aria-label={`${label} for flexible meal ${reviewStep + 1}`} type="number" inputMode="decimal" value={flexibleResult[key] ?? ""} onChange={event => updateFlexibleResult(key, event.target.value)} style={{ marginTop: 5 }} />
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => { setMealResults(results => ({ ...results, [reviewStep]: { completed: false, note: "Skipped" } })); setReviewStep(step => nextReviewStep(activeMeals, mealResults, step, reviewSkipAnswered)); }}>SKIPPED</button>
                <button className="t3d-btn" style={{ flex: 2 }} disabled={!flexibleResult.calories} onClick={() => { setMealResults(results => ({ ...results, [reviewStep]: { ...flexibleResult, completed: true } })); setReviewStep(step => nextReviewStep(activeMeals, mealResults, step, reviewSkipAnswered)); }}>LOG MEAL →</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="t3d-fade">
        {reviewBack}
        <div className="t3d-card">
          <div className="t3d-progress-dots">
            {[...meals.map((_,i)=>i), "offplan"].map((_,i) => <div key={i} className={`t3d-dot-step ${i===reviewStep?"active":i<reviewStep?"done":""}`} />)}
          </div>
          <div style={{ textAlign: "center", marginBottom: 8, fontSize: 10, color: "#E0EAF0", letterSpacing: 2 }}>MEAL {reviewStep+1} OF {meals.length}</div>
          <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, color: "#E0EAF0", marginBottom: 4 }}>{meal?.name}</div>
            {meal?.time && <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 14 }}>{meal.time}</div>}
            <div style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 14, textAlign: "left" }}>
              {meal?.ingredients?.map((ing, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11, borderBottom: i<meal.ingredients.length-1?`1px solid ${BORDER}`:"none" }}>
                  <span style={{ color: "#8AABB8" }}>{ing.name}</span><span style={{ color: "#E0EAF0" }}>{ing.weight}{ing.unit}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: 20, fontSize: 10 }}>
              <span style={{ color: NEON }}>{meal?.calories} kcal</span>
              <span style={{ color: NEON2 }}>{meal?.protein}g P</span>
              <span style={{ color: "#FF8C00" }}>{meal?.carbs}g C</span>
              <span style={{ color: "#8AABB8" }}>{meal?.fats}g F</span>
            </div>
            <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 16 }}>Did you have this exactly as planned?</div>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button className="t3d-tick-btn" onClick={() => { setMealResults(r => ({ ...r, [reviewStep]: true })); setReviewStep(step => nextReviewStep(activeMeals, mealResults, step, reviewSkipAnswered)); }}>✓</button>
              <button className="t3d-cross-btn" onClick={() => setMealResults(r => ({ ...r, [reviewStep]: { completed: false, note: typeof r[reviewStep] === "object" ? r[reviewStep].note || "" : "" } }))}>✗</button>
            </div>
            {mealWasMissed(mealResults[reviewStep]) && (
              <div style={{ marginTop: 14, textAlign: "left" }}>
                <label style={{ fontSize: 10, color: "#8AABB8" }}>HOW DID IT NOT GO TO PLAN?
                  <textarea className="t3d-input" rows={3} autoFocus placeholder="e.g. ate something different, skipped it, portion changed..." value={typeof mealResults[reviewStep] === "object" ? mealResults[reviewStep].note || "" : ""} onChange={event => setMealResults(results => ({ ...results, [reviewStep]: { completed: false, note: event.target.value } }))} style={{ marginTop: 7 }} />
                </label>
                <button className="t3d-btn" style={{ width: "100%", marginTop: 9 }} onClick={() => setReviewStep(step => nextReviewStep(activeMeals, mealResults, step, reviewSkipAnswered))}>CONTINUE →</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── SETUP VIEW ────────────────────────────────────────────────────────────
  if (view === "setup") {
    const currentMeals = editingRestDay ? restDayMeals : planMeals;
    const setCurrentMeals = editingRestDay ? setRestDayMeals : setPlanMeals;
    const preparedPlanMeals = prepareNutritionMeals(planMeals, nutritionStyle, mealsPerDay, getFinalMacros());
    // Rest days only get their own meals when that was chosen and some exist.
    const preparedRestDayMeals = hasRestDayPlan && restDayMeals.length ? prepareNutritionMeals(restDayMeals, nutritionStyle, mealsPerDay, getFinalMacros()) : [];
    const buildMode = editingRestDay ? restBuildMode : mealBuildMode;
    const setBuildMode = editingRestDay ? setRestBuildMode : setMealBuildMode;
    const allergyList = parseAllergies(aiNutritionAnswers.allergies);
    const currentConflicts = mealAllergyConflicts(currentMeals, allergyList);
    const reviewConflicts = mealAllergyConflicts([...preparedPlanMeals, ...preparedRestDayMeals], allergyList);
    const reviewTargets = { calories: getFinalMacros().calories, protein: getFinalMacros().protein };
    const reviewPlanGap = mealPlanGapText(mealPlanTargetCheck(preparedPlanMeals, reviewTargets), reviewTargets);
    const reviewRestTargets = { calories: restDayCalories(reviewTargets.calories, calorieFloor(sex)), protein: reviewTargets.protein };
    const reviewRestGap = preparedRestDayMeals.length ? mealPlanGapText(mealPlanTargetCheck(preparedRestDayMeals, reviewRestTargets), reviewRestTargets) : "";
    const age = ageFromDateOfBirth(dateOfBirth, today);
    const stats = { weight: bodyWeight, height, age, sex, activityLevel, goal };
    // Fields the profile already holds are shown as one line with EDIT;
    // only missing ones are asked for.
    const fromProfile = {
      height: !editProfileFields && Boolean(profile?.heightCm) && String(profile.heightCm) === String(height),
      dateOfBirth: !editProfileFields && Boolean(profile?.dateOfBirth) && profile.dateOfBirth === dateOfBirth,
      sex: !editProfileFields && Boolean(profile?.sex) && sexLabel(profile.sex) === sex,
    };
    const profileSummary = [
      fromProfile.height && `${height} cm`,
      fromProfile.dateOfBirth && `born ${formatDateOfBirth(dateOfBirth)} (age ${age})`,
      fromProfile.sex && sex,
    ].filter(Boolean).join(" · ");
    const sexText = sex === "Prefer not to say" ? "sex not given (average of male and female)" : sex.toLowerCase();
    const saveProfileFromSetup = async () => {
      const changes = profileChanges(profile || {}, { heightCm: height, dateOfBirth, sex });
      if (!Object.keys(changes).length) return;
      const { error } = await supabase.from("user_profiles").upsert({ user_id: user.id, ...changes, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) {
        console.error("Profile save error:", error.message);
        setProfileSaveNote(`${profileSaveError(error)} These details are still used for this plan.`);
        return;
      }
      const { experienceLevel: _level, ...fields } = normaliseProfile({ height_cm: height, date_of_birth: dateOfBirth, sex: changes.sex || profile?.sex });
      const merged = { ...(profile || {}), ...fields };
      setProfile(merged);
      onProfileChange(merged);
      setProfileSaveNote("");
    };
    const statsProblem = setupStatsProblem(stats);
    const wakeSlots = mealTimeSlots(wakeTime, mealsPerDay);
    // The times the meals actually have, earliest first.
    const currentMealTimes = currentMeals.map(meal => String(meal?.time || "")).filter(time => /^\d{1,2}:\d{2}$/.test(time)).map(time => time.padStart(5, "0")).sort();
    // Rest days with their own meals aim for the lighter rest day target.
    const finalMacros = getFinalMacros();
    const minCalories = calorieFloor(sex);
    const restTarget = { calories: restDayCalories(finalMacros.calories, minCalories), protein: finalMacros.protein };
    // Calorie safety: no target or day of meals below the daily minimum (Save
    // is blocked), and a warning for losing more than 1% of body weight a
    // week. Custom targets estimate maintenance from the profile when they can.
    const customCaloriesProblem = calorieTargetProblem(customCalories, sex);
    const targetMinimumProblem = calorieTargetProblem(finalMacros.calories, sex);
    const mealMinimumProblems = targetMinimumProblem ? [] : [
      mealPlanFloorProblem(preparedPlanMeals, sex, preparedRestDayMeals.length ? "Your training day meals" : "Your meals"),
      mealPlanFloorProblem(preparedRestDayMeals, sex, "Your rest day meals"),
    ].filter(Boolean);
    const currentWeight = bodyWeight || latestWeight;
    const maintenance = calculatedMacros?.tdee || calculateNutritionTargets({ ...stats, weight: currentWeight })?.tdee || null;
    const lossWarningFor = calories => weeklyLossWarning({ calories, maintenance, weight: currentWeight, estimated: !calculatedMacros?.tdee });
    const minimumAlert = (problem, testId) => (
      <div role="alert" data-testid={testId} style={{ border: "1px solid rgba(255,77,109,.45)", background: "rgba(255,77,109,.07)", borderRadius: 6, padding: 12, margin: "0 0 12px", fontSize: 11, color: "#FFD0D8", lineHeight: 1.55 }}>
        {problem}
        <div style={{ color: "#8AABB8", fontSize: 10, marginTop: 6 }}>{EATING_SUPPORT_TEXT}</div>
      </div>
    );
    const lossAlert = (warning, testId) => (
      <div role="alert" data-testid={testId} style={{ border: "1px solid rgba(255,181,71,.4)", background: "rgba(255,181,71,.06)", borderRadius: 6, padding: 12, margin: "0 0 12px", fontSize: 11, color: "#FFD08A", lineHeight: 1.55 }}>{warning}</div>
    );
    const changeWakeTime = value => {
      setWakeTime(value);
      setPlanMeals(meals => applyMealTimes(meals, value));
      setRestDayMeals(meals => applyMealTimes(meals, value));
    };
    const optionStyle = selected => ({ background: selected ? "rgba(0,255,178,.12)" : "transparent", borderColor: selected ? NEON : BORDER, color: selected ? NEON : "#8AABB8" });

    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <h2 className="t3d-ctitle" style={{ margin: 0 }}>{plan ? "EDIT YOUR PLAN" : "SET UP YOUR NUTRITION"}</h2>
            <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={leaveSetup}>✕ CLOSE</button>
          </div>
          {/* An existing plan can jump to any part; a new one goes in order. */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {["GOALS", "TARGETS", "MEALS", "REVIEW"].map((label, i) => {
              const style = { flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 5, fontSize: 9, letterSpacing: 1, fontFamily: "'Orbitron',monospace",
                background: setupStep===i?"rgba(0,255,178,.08)":"transparent", border: `1px solid ${setupStep===i?NEON:BORDER}`, color: setupStep===i?NEON:"#E0EAF0" };
              return reviewReturn && calculatedMacros
                ? <button key={label} type="button" aria-current={setupStep === i ? "step" : undefined} style={{ ...style, cursor: "pointer" }} onClick={() => { if (i === 2) setEditingRestDay(false); setSetupStep(i); }}>{label}</button>
                : <div key={label} style={style}>{label}</div>;
            })}
          </div>
          {reviewReturn && calculatedMacros && setupStep !== 3 && (
            <button type="button" className="t3d-btn t3d-btn-sm" style={{ marginBottom: 14 }} onClick={() => { setEditingRestDay(false); setSetupStep(3); }}>← BACK TO REVIEW</button>
          )}
          {setupNotice && <div role="status" data-testid="setup-notice" style={{ fontSize: 10, color: "#FFD08A", lineHeight: 1.5, marginBottom: 12 }}>{setupNotice}</div>}

          {/* Step 0: Goals */}
          {setupStep === 0 && !setupMode && (
            <div>
              <h2 className="t3d-ctitle">HOW WOULD YOU LIKE TO SET YOUR TARGETS?</h2>
              <button className="t3d-btn" style={{ width: "100%", textAlign: "left", whiteSpace: "normal", padding: 16, marginBottom: 10 }} onClick={() => { setSetupMode("guided"); setUseCustomTargets(false); }}>
                STEP-BY-STEP SETUP
                <span style={{ display: "block", marginTop: 5, color: "#8AABB8", fontFamily: "'Inter',sans-serif", fontSize: 11, fontWeight: 400 }}>Use your weight, height, age, goal and activity to calculate a starting target.</span>
              </button>
              <button className="t3d-btn" style={{ width: "100%", textAlign: "left", whiteSpace: "normal", padding: 16, borderColor: "rgba(0,200,255,.35)", color: NEON2 }} onClick={() => {
                setSetupMode("custom"); setUseCustomTargets(true);
                setCustomCalories(String(plan?.daily_calories || "")); setCustomProtein(String(plan?.protein_target || "")); setCustomCarbs(String(plan?.carbs_target || "")); setCustomFats(String(plan?.fats_target || ""));
              }}>
                ENTER MY OWN TARGETS
                <span style={{ display: "block", marginTop: 5, color: "#8AABB8", fontFamily: "'Inter',sans-serif", fontSize: 11, fontWeight: 400 }}>Fill in calories and macros yourself, then build your meals.</span>
              </button>
            </div>
          )}

          {setupStep === 0 && setupMode === "guided" && (
            <div>
              <h2 className="t3d-ctitle">YOUR GOALS & STATS</h2>
              <button className="t3d-btn t3d-btn-sm" style={{ marginBottom: 14, borderColor: BORDER, color: "#8AABB8" }} onClick={() => setSetupMode(null)}>← CHANGE SETUP METHOD</button>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginBottom: 6 }}>
                <label style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>WEIGHT (kg)
                  <input className="t3d-input" type="number" inputMode="decimal" aria-label="WEIGHT (kg)" placeholder="e.g. 80" value={bodyWeight} onChange={e => setBodyWeight(e.target.value)} style={{ marginTop: 5 }} />
                </label>
                {!fromProfile.height && <label style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>HEIGHT (cm)
                  <input className="t3d-input" type="number" inputMode="decimal" aria-label="HEIGHT (cm)" placeholder="e.g. 178" value={height} onChange={e => setHeight(e.target.value)} style={{ marginTop: 5 }} />
                </label>}
                {!fromProfile.dateOfBirth && <label style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1, gridColumn: "span 2" }}>DATE OF BIRTH
                  <input className="t3d-input" type="date" aria-label="DATE OF BIRTH" min="1900-01-01" max={today} value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} style={{ marginTop: 5 }} />
                </label>}
              </div>
              {latestWeight && String(bodyWeight) === latestWeight && !plan?.setup?.weight && <div style={{ fontSize: 9, color: "#8AABB8", marginBottom: 8 }}>Weight from your last morning check-in.</div>}
              {profileSummary && (
                <div data-testid="profile-summary" style={{ fontSize: 9, color: "#8AABB8", margin: "4px 0 8px", lineHeight: 1.6 }}>
                  From your profile: {profileSummary} –{" "}
                  <button type="button" onClick={() => setEditProfileFields(true)} style={{ background: "none", border: "none", padding: 0, color: NEON, fontSize: 9, textDecoration: "underline", cursor: "pointer" }}>edit</button>
                </div>
              )}
              {!fromProfile.sex && <div style={{ margin: "10px 0 14px" }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 8 }}>SEX <span style={{ color: "#8AABB8", letterSpacing: 0 }}>· used in the calorie sum</span></div>
                <div style={{ display: "flex", gap: 6 }}>
                  {SEX_OPTIONS.map(option => (
                    <button key={option} type="button" className="t3d-btn t3d-btn-sm" style={{ flex: 1, fontSize: 9, whiteSpace: "normal", ...optionStyle(sex === option) }} onClick={() => setSex(option)}>{option.toUpperCase()}</button>
                  ))}
                </div>
              </div>}
              {sex === "Prefer not to say" && <div data-testid="sex-average-note" style={{ fontSize: 10, color: "#8AABB8", margin: "-6px 0 14px", lineHeight: 1.5 }}>{PREFER_NOT_TO_SAY_NOTE}</div>}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 8 }}>GOAL</div>
                {NUTRITION_GOALS.map(option => (
                  <button key={option.id} type="button" className="t3d-btn" style={{ width: "100%", textAlign: "left", whiteSpace: "normal", padding: "10px 14px", marginBottom: 6, fontSize: 11, ...optionStyle(goal === option.id) }} onClick={() => setGoal(option.id)}>
                    {option.id.toUpperCase()}
                    <span style={{ display: "block", marginTop: 3, color: "#8AABB8", fontFamily: "'Inter',sans-serif", fontSize: 10, fontWeight: 400 }}>{option.description}</span>
                  </button>
                ))}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 4 }}>ACTIVITY LEVEL</div>
                <div style={{ fontSize: 10, color: "#8AABB8", marginBottom: 8, lineHeight: 1.5 }}>
                  {trainingDaysCount ? `Suggested from the ${trainingDaysCount} training day${trainingDaysCount === 1 ? "" : "s"} a week in your split. ` : ""}Count your job and daily steps too, not just workouts.
                </div>
                {ACTIVITY_LEVELS.map(level => {
                  const preview = calculateNutritionTargets({ ...stats, activityLevel: level.id });
                  return (
                    <button key={level.id} type="button" data-testid="activity-option" className="t3d-btn" style={{ width: "100%", textAlign: "left", whiteSpace: "normal", padding: "10px 14px", marginBottom: 6, fontSize: 11, ...optionStyle(activityLevel === level.id) }} onClick={() => setActivityLevel(level.id)}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{level.id.toUpperCase()}</span>{preview && <span style={{ fontFamily: "'Inter',sans-serif", fontWeight: 400 }}>≈ {preview.calories.toLocaleString()} kcal</span>}</span>
                      <span style={{ display: "block", marginTop: 3, color: "#8AABB8", fontFamily: "'Inter',sans-serif", fontSize: 10, fontWeight: 400 }}>{level.description}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", letterSpacing: 1, marginBottom: 8 }}>HOW MANY MEALS PER DAY?</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[3,4,5,6].map(n => (
                    <button key={n} className="t3d-btn" style={{ flex: 1, height: 44, fontSize: 16, padding: 0, background: mealsPerDay===n?"rgba(0,255,178,.15)":"transparent", borderColor: mealsPerDay===n?NEON:BORDER }} onClick={() => setMealsPerDay(n)}>{n}</button>
                  ))}
                </div>
              </div>
              {statsProblem && (bodyWeight || height || age) && <div data-testid="stats-problem" style={{ fontSize: 10, color: "#FFB547", marginBottom: 8 }}>{statsProblem}</div>}
              <button className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={Boolean(statsProblem)}
                onClick={() => { setCalculatedMacros(calculateNutritionTargets(stats)); setUseCustomTargets(false); setSetupStep(1); saveProfileFromSetup(); }}>
                CALCULATE MY TARGETS →
              </button>
            </div>
          )}

          {setupStep === 0 && setupMode === "custom" && (
            <div>
              <h2 className="t3d-ctitle">ENTER YOUR DAILY TARGETS</h2>
              <button className="t3d-btn t3d-btn-sm" style={{ marginBottom: 14, borderColor: BORDER, color: "#8AABB8" }} onClick={() => setSetupMode(null)}>← CHANGE SETUP METHOD</button>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
                {[["CALORIES", customCalories, setCustomCalories], ["PROTEIN (g)", customProtein, setCustomProtein], ["CARBS (g)", customCarbs, setCustomCarbs], ["FATS (g)", customFats, setCustomFats]].map(([label, value, setter]) => (
                  <label key={label} style={{ fontSize: 9, color: "#8AABB8" }}>{label}<input className="t3d-input" type="number" inputMode="decimal" min="0" value={value} onChange={event => setter(event.target.value)} style={{ marginTop: 5 }} /></label>
                ))}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 8 }}>GOAL</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                  {NUTRITION_GOALS.map(option => <button key={option.id} type="button" className="t3d-btn t3d-btn-sm" style={{ fontSize: 9, ...optionStyle(goal === option.id) }} onClick={() => setGoal(option.id)}>{option.id.toUpperCase()}</button>)}
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 8 }}>HOW MANY MEALS PER DAY?</div>
                <div style={{ display: "flex", gap: 8 }}>{[3,4,5,6].map(number => <button key={number} className="t3d-btn" style={{ flex: 1, padding: 10, background: mealsPerDay === number ? "rgba(0,255,178,.12)" : "transparent" }} onClick={() => setMealsPerDay(number)}>{number}</button>)}</div>
              </div>
              {!fromProfile.sex && <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 8 }}>SEX <span style={{ color: "#8AABB8" }}>· sets your minimum daily calories</span></div>
                <div style={{ display: "flex", gap: 6 }}>
                  {SEX_OPTIONS.map(option => (
                    <button key={option} type="button" className="t3d-btn t3d-btn-sm" style={{ flex: 1, fontSize: 9, whiteSpace: "normal", ...optionStyle(sex === option) }} onClick={() => setSex(option)}>{option.toUpperCase()}</button>
                  ))}
                </div>
              </div>}
              {customCaloriesProblem ? minimumAlert(customCaloriesProblem, "calorie-minimum") : lossWarningFor(customCalories) && lossAlert(lossWarningFor(customCalories), "weekly-loss-warning")}
              <button className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={!customCalories || !customProtein || Boolean(customCaloriesProblem)} onClick={() => {
                setCalculatedMacros({ calories: parseInt(customCalories) || 0, protein: parseInt(customProtein) || 0, carbs: parseInt(customCarbs) || 0, fats: parseInt(customFats) || 0, tdee: null });
                setSetupStep(1);
              }}>USE THESE TARGETS →</button>
              <div style={{ color: "#6F8792", fontSize: 9, lineHeight: 1.5, marginTop: 9 }}>Use targets supplied by a qualified professional where appropriate.</div>
            </div>
          )}

          {/* Step 1: Targets + structure */}
          {setupStep === 1 && calculatedMacros && (
            <div>
              {/* Recommended targets */}
              <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: NEON, letterSpacing: 2 }}>{setupMode === "custom" ? "YOUR TARGETS" : "RECOMMENDED TARGETS"}</div>
                  {setupMode !== "custom" && <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 8, opacity: 0.6 }} onClick={() => {
                    // Customising starts from the recommended targets.
                    if (!useCustomTargets && !customCalories) {
                      setCustomCalories(String(calculatedMacros.calories)); setCustomProtein(String(calculatedMacros.protein));
                      setCustomCarbs(String(calculatedMacros.carbs)); setCustomFats(String(calculatedMacros.fats));
                    }
                    setUseCustomTargets(v => !v);
                  }}>
                    {useCustomTargets ? "USE RECOMMENDED" : "CUSTOMISE"}
                  </button>}
                </div>
                {!useCustomTargets ? (
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ color: NEON, fontSize: 12 }}>{calculatedMacros.calories} kcal</span>
                    <span style={{ color: NEON2, fontSize: 12 }}>{calculatedMacros.protein}g P</span>
                    <span style={{ color: "#FF8C00", fontSize: 12 }}>{calculatedMacros.carbs}g C</span>
                    <span style={{ color: "#8AABB8", fontSize: 12 }}>{calculatedMacros.fats}g F</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["Kcal", customCalories, setCustomCalories], ["P(g)", customProtein, setCustomProtein], ["C(g)", customCarbs, setCustomCarbs], ["F(g)", customFats, setCustomFats]].map(([l, v, s]) => (
                      <div key={l} style={{ flex: 1 }}>
                        <div style={{ fontSize: 8, color: "#E0EAF0", marginBottom: 4 }}>{l}</div>
                        <input className="t3d-input" type="number" placeholder={l} value={v} onChange={e => s(e.target.value)} style={{ padding: "6px 4px", fontSize: 11 }} />
                      </div>
                    ))}
                  </div>
                )}
                {setupMode === "guided" && calculatedMacros.tdee && <div style={{ fontSize: 9, color: "#8AABB8", marginTop: 8, lineHeight: 1.5 }}>Based on {bodyWeight} kg, {height} cm, age {age}, {sexText} · {goal} · {activityLevel}. Maintenance ≈ {calculatedMacros.tdee.toLocaleString()} kcal{calculatedMacros.adjustment ? `, ${calculatedMacros.adjustment > 0 ? "+" : "−"}${Math.abs(calculatedMacros.adjustment)} kcal for your goal` : ""}. A starting point: adjust after 2–3 weeks of weigh-ins.</div>}
                {setupMode === "guided" && profileSaveNote && <div role="alert" style={{ fontSize: 9, color: "#FFB547", marginTop: 6 }}>{profileSaveNote}</div>}
              </div>
              {targetMinimumProblem ? minimumAlert(targetMinimumProblem, "calorie-minimum") : lossWarningFor(finalMacros.calories) && lossAlert(lossWarningFor(finalMacros.calories), "weekly-loss-warning")}

              <div style={{ marginBottom: 16 }}>
                <h2 className="t3d-ctitle">HOW MUCH STRUCTURE DO YOU WANT?</h2>
                {[
                  ["hybrid", "HYBRID · RECOMMENDED", "Repeat the meals that help you stay consistent. Use flexible macro targets for the rest."],
                  ["flexible", "FLEXIBLE MACROS", "Choose your own food each day and log the macros for each meal."],
                  ["fixed", "SAME MEALS DAILY", "Follow the same planned meals each day for maximum simplicity."],
                ].map(([value, label, description]) => (
                  <button key={value} type="button" className="t3d-btn" onClick={() => {
                    setNutritionStyle(value);
                    if (value === "flexible") {
                      setPlanMeals(prepareNutritionMeals([], "flexible", mealsPerDay, getFinalMacros()));
                      setMealBuildMode("own");
                    } else if (nutritionStyle === "flexible") {
                      setPlanMeals([]);
                      setMealBuildMode(null);
                    }
                  }} style={{ width: "100%", textAlign: "left", whiteSpace: "normal", padding: 13, marginBottom: 7, background: nutritionStyle === value ? "rgba(0,255,178,.09)" : "transparent", borderColor: nutritionStyle === value ? NEON : BORDER, color: nutritionStyle === value ? NEON : "#C5D6DC" }}>
                    {label}
                    <span style={{ display: "block", color: "#8AABB8", fontFamily: "'Inter',sans-serif", fontSize: 10, fontWeight: 400, lineHeight: 1.5, marginTop: 4 }}>{description}</span>
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setSetupStep(0)}>← BACK</button>
                <button className="t3d-btn" style={{ flex: 1, padding: 12 }} disabled={Boolean(targetMinimumProblem)} onClick={() => setSetupStep(2)}>NEXT: BUILD MEALS →</button>
              </div>
            </div>
          )}

          {/* Step 2: Meals */}
          {setupStep === 2 && calculatedMacros && (
            <div>
              <h2 className="t3d-ctitle">ABOUT YOUR DAY</h2>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 120px) minmax(0, 1fr)", gap: 8, marginBottom: 6 }}>
                <label style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>WAKE-UP TIME
                  <input className="t3d-input" type="time" aria-label="Wake-up time" value={wakeTime} onChange={e => changeWakeTime(e.target.value)} style={{ marginTop: 5 }} />
                </label>
                <label style={{ fontSize: 9, color: "#E0EAF0", letterSpacing: 1 }}>ALLERGIES OR INTOLERANCES
                  <input className="t3d-input" aria-label="Allergies or intolerances" placeholder="e.g. peanuts, or none" value={aiNutritionAnswers.allergies || ""} onChange={e => { const value = e.target.value; setAiNutritionAnswers(answers => ({ ...answers, allergies: value })); setAllergyCheckConfirmed(false); }} style={{ marginTop: 5 }} />
                </label>
              </div>
              <div data-testid="meal-times" style={{ fontSize: 9, color: "#8AABB8", marginBottom: 14, lineHeight: 1.5 }}>
                {currentMealTimes.length
                  ? `Your ${editingRestDay ? "rest day " : ""}meals run from ${currentMealTimes[0]} to ${currentMealTimes.at(-1)}.`
                  : wakeSlots.length ? `Meals will run from ${wakeSlots[0]} to ${wakeSlots.at(-1)}${routineWakeTime && wakeTime === routineWakeTime ? ", from your morning routine's wake-up time" : ""}.` : "Add your wake-up time so meal times fit your day."} Every meal plan is checked against your allergies.
              </div>

              {/* Training days / rest days, when rest days have their own meals */}
              {hasRestDayPlan && (
                <div role="tablist" aria-label="Which days" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <button role="tab" aria-selected={!editingRestDay} className="t3d-btn t3d-btn-sm" style={{ flex: 1, background: !editingRestDay?"rgba(0,255,178,.12)":"transparent", borderColor: !editingRestDay?NEON:BORDER, color: !editingRestDay?NEON:"#E0EAF0" }} onClick={() => setEditingRestDay(false)}>TRAINING DAYS</button>
                  <button role="tab" aria-selected={editingRestDay} className="t3d-btn t3d-btn-sm" style={{ flex: 1, background: editingRestDay?"rgba(0,200,255,.12)":"transparent", borderColor: editingRestDay?NEON2:BORDER, color: editingRestDay?NEON2:"#E0EAF0" }} onClick={() => setEditingRestDay(true)}>REST DAYS{restDayMeals.length ? ` · ${restDayMeals.length}` : ""}</button>
                </div>
              )}

              {editingRestDay && !restBuildMode && !restDayMeals.length ? (
                // Starting the rest day plan: copying the training day is the quickest way.
                <div data-testid="rest-day-start">
                  <h2 className="t3d-ctitle">BUILD YOUR REST DAY MEALS</h2>
                  <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.5, marginBottom: 12 }}>Rest days are usually a little lighter. Your rest day target is {restTarget.calories.toLocaleString("en-GB")} kcal: about 12% fewer calories, mostly from carbs, with the same protein.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <button className="t3d-btn" style={{ padding: "14px", textAlign: "left", whiteSpace: "normal", fontSize: 11 }} disabled={!planMeals.length} onClick={() => { setRestDayMeals(planMeals.map(meal => ({ ...meal }))); setRestBuildMode("own"); }}>
                      📋 Copy my training day meals
                      <div style={{ fontSize: 9, color: "#E0EAF0", marginTop: 4 }}>Then remove, swap or shrink anything you don&apos;t need on rest days</div>
                    </button>
                    <button className="t3d-btn" style={{ padding: "14px", textAlign: "left", whiteSpace: "normal", fontSize: 11, borderColor: "rgba(0,200,255,.3)", color: NEON2 }} disabled={!planMeals.length || restAiLoading} onClick={buildRestDayAI}>
                      🤖 {restAiLoading ? "Building your rest day..." : "AI: lighter version of my training day"}
                      <div style={{ fontSize: 9, color: "#E0EAF0", marginTop: 4 }}>Similar foods, about 12% fewer calories, checked against your allergies</div>
                    </button>
                    <button className="t3d-btn" style={{ padding: "14px", textAlign: "left", whiteSpace: "normal", fontSize: 11 }} onClick={() => setRestBuildMode("common")}>
                      🍽️ Choose from common meals
                    </button>
                    <button className="t3d-btn" style={{ padding: "14px", textAlign: "left", whiteSpace: "normal", fontSize: 11 }} onClick={() => setRestBuildMode("own")}>
                      📝 Build my own meals
                    </button>
                  </div>
                  {restPlanNote && <div role="alert" data-testid="rest-plan-note" style={{ fontSize: 11, color: "#FFB547", marginTop: 10, lineHeight: 1.5 }}>{restPlanNote}</div>}
                </div>
              ) : !buildMode ? (
                <div>
                  <h2 className="t3d-ctitle">BUILD YOUR {hasRestDayPlan ? "TRAINING DAY " : ""}MEALS</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <button className="t3d-btn" style={{ padding: "14px", textAlign: "left", whiteSpace: "normal", fontSize: 11 }} onClick={() => setBuildMode("own")}>
                      📝 Build my own meals
                      <div style={{ fontSize: 9, color: "#E0EAF0", marginTop: 4 }}>Add custom meals with ingredients</div>
                    </button>
                    <button className="t3d-btn" style={{ padding: "14px", textAlign: "left", whiteSpace: "normal", fontSize: 11 }} onClick={() => setBuildMode("common")}>
                      🍽️ Choose from common meals
                      <div style={{ fontSize: 9, color: "#E0EAF0", marginTop: 4 }}>Pick from breakfast, lunch, dinner, snacks</div>
                    </button>
                    <button className="t3d-btn" style={{ padding: "14px", textAlign: "left", whiteSpace: "normal", fontSize: 11, borderColor: "rgba(0,200,255,.3)", color: NEON2 }} onClick={() => { if (editingRestDay) { buildRestDayAI(); return; } setMealBuildMode("ai"); setShowAiQuestions(true); }}>
                      🤖 AI build my meal plan
                      <div style={{ fontSize: 9, color: "#E0EAF0", marginTop: 4 }}>5 quick questions, allergies first</div>
                    </button>
                  </div>
                </div>
              ) : !editingRestDay && showAiQuestions ? (() => {
                // Five questions (allergies first) and an optional budget.
                // Goal, meals per day and training days come from the setup.
                const question = AI_NUTRITION_QUESTIONS[aiNutritionStep];
                const answer = String(aiNutritionAnswers[question.id] || "");
                const isLast = aiNutritionStep === AI_NUTRITION_QUESTIONS.length - 1;
                const requiredCount = AI_NUTRITION_QUESTIONS.filter(item => !item.optional).length;
                const answerAndContinue = (value, delay = 0) => {
                  const updated = { ...aiNutritionAnswers, [question.id]: value };
                  setAiNutritionAnswers(updated);
                  setTimeout(() => { if (isLast) buildAIMeals(updated); else setAiNutritionStep(step => step + 1); }, delay);
                };
                const setAnswer = value => setAiNutritionAnswers(answers => ({ ...answers, [question.id]: value }));
                return (
                  <div data-testid="ai-nutrition-questions">
                    <div style={{ display: "flex", gap: 3, marginBottom: 16 }}>
                      {AI_NUTRITION_QUESTIONS.map((item, i) => <div key={item.id} style={{ flex: 1, height: 3, borderRadius: 2, opacity: item.optional ? 0.5 : 1, background: i<=aiNutritionStep?NEON:BORDER }} />)}
                    </div>
                    <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>{question.optional ? "OPTIONAL" : `QUESTION ${aiNutritionStep + 1} OF ${requiredCount}`}</div>
                    <div style={{ fontSize: 14, color: "#E0EAF0", marginBottom: 20, lineHeight: 1.6 }}>{question.q}</div>
                    {question.type === "choice" && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                          {question.options.map(opt => (
                            <button key={opt} className="t3d-btn" style={{ textAlign: "left", padding: "11px 16px", fontSize: 11, ...optionStyle(answer === opt) }} onClick={() => answerAndContinue(opt, 300)}>{opt}</button>
                          ))}
                        </div>
                        <div style={{ color: "#8AABB8", fontSize: 9, marginBottom: 6 }}>OR TYPE YOUR OWN ANSWER</div>
                        <input className="t3d-input" placeholder="Type what suits you..." value={answer} onChange={event => setAnswer(event.target.value)} />
                        <button className="t3d-btn" style={{ width: "100%", marginTop: 9 }} disabled={!answer.trim()} onClick={() => answerAndContinue(answer)}>{isLast ? "BUILD MY PLAN" : "USE MY ANSWER →"}</button>
                      </div>
                    )}
                    {question.type === "text" && (
                      <div>
                        <input className="t3d-input" placeholder={question.placeholder} value={answer} onChange={e => setAnswer(e.target.value)} />
                        {question.quick && <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginTop: 10 }} onClick={() => answerAndContinue("None")}>{question.quick}</button>}
                        <button className="t3d-btn" style={{ width: "100%", padding: 12, marginTop: 10 }} disabled={question.required && !answer.trim()} onClick={() => answerAndContinue(answer)}>
                          {isLast ? "BUILD MY PLAN" : "NEXT →"}
                        </button>
                      </div>
                    )}
                    {question.optional && <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginTop: 4 }} onClick={() => answerAndContinue("")}>SKIP — BUILD MY PLAN</button>}
                    {aiNutritionStep > 0 && <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ marginTop: 8 }} onClick={() => setAiNutritionStep(step => step - 1)}>← BACK</button>}
                  </div>
                );
              })() : (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h2 className="t3d-ctitle" style={{ margin: 0 }}>{editingRestDay ? "REST DAY MEALS" : buildMode==="ai"?"AI MEAL PLAN":buildMode==="common"?"COMMON MEALS":"YOUR MEALS"}</h2>
                    <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => { setBuildMode(null); setCurrentMeals([]); if (editingRestDay) setRestPlanNote(""); }}>{editingRestDay ? "START AGAIN" : "CHANGE"}</button>
                  </div>

                  {!editingRestDay && aiMealLoading && <div style={{ textAlign: "center", padding: 20, fontSize: 11, color: "#E0EAF0" }}>🤖 Building your meal plan...</div>}
                  {/* AI tweaks box */}
                  {editingRestDay && restAiLoading && <div style={{ textAlign: "center", padding: 20, fontSize: 11, color: "#E0EAF0" }}>🤖 Building your rest day meals...</div>}
                  {editingRestDay && restPlanNote && <div role="alert" data-testid="rest-plan-note" style={{ fontSize: 11, color: "#FFB547", margin: "10px 0", lineHeight: 1.5 }}>{restPlanNote}</div>}
                  {!editingRestDay && mealPlanWarning && <div role="alert" data-testid="meal-plan-warning" style={{ fontSize: 11, color: "#FFB547", margin: "10px 0", lineHeight: 1.5 }}>{mealPlanWarning}</div>}
                  {!editingRestDay && buildMode === "ai" && currentMeals.length > 0 && !aiMealLoading && (
                    <AiTweaksBox
                      meals={currentMeals}
                      setMeals={setCurrentMeals}
                      macros={getFinalMacros()}
                      goal={goal}
                      allergies={allergyList}
                      preferences={preferencesText(aiNutritionAnswers)}
                      wakeTime={wakeTime}
                      minCalories={minCalories}
                    />
                  )}

                  {buildMode === "common" && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                        {["breakfast","lunch","dinner","snacks"].map(cat => (
                          <button key={cat} className="t3d-btn t3d-btn-sm" style={{ flex: 1, fontSize: 8, background: commonCategory===cat?"rgba(0,255,178,.12)":"transparent", borderColor: commonCategory===cat?NEON:BORDER, color: commonCategory===cat?NEON:"#E0EAF0" }} onClick={() => setCommonCategory(cat)}>
                            {cat.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      {COMMON_MEALS[commonCategory]?.map((m, i) => {
                        const selected = currentMeals.find(p => p.name===m.name);
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${BORDER}`, cursor: "pointer" }}
                            onClick={() => setCurrentMeals(prev => applyMealTimes(selected ? prev.filter(p => p.name !== m.name) : [...prev, m], wakeTime))}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${selected?NEON:BORDER}`, background: selected?"rgba(0,255,178,.1)":"transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: NEON, flexShrink: 0 }}>{selected?"✓":""}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12 }}>{m.name}</div>
                              <div style={{ fontSize: 10, color: "#E0EAF0" }}>{m.calories} kcal · {m.protein}g P</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {currentMeals.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      {currentMeals.map((m, i) => (
                        <div key={i} style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <div style={{ fontSize: 12 }}>{isFlexibleMeal(m) || (nutritionStyle === "hybrid" && m.repeatDaily === false) ? `Flexible meal ${i + 1}` : m.name} {m.time && !isFlexibleMeal(m) && <span style={{ fontSize: 10, color: "#E0EAF0" }}>· {m.time}</span>}</div>
                            <div style={{ display: "flex", gap: 6 }}>
                              {!isFlexibleMeal(m) && <button className="t3d-btn t3d-btn-sm" aria-label={`Edit ${m.name}`} style={{ fontSize: 8 }} onClick={() => { setNewMeal({ ...m, calories: String(m.calories), protein: String(m.protein), carbs: String(m.carbs), fats: String(m.fats) }); setEditMealIdx(i); setAddMealModal(true); }}>EDIT</button>}
                              {nutritionStyle !== "flexible" && <button className="t3d-btn t3d-btn-sm t3d-btn-red" aria-label={`Remove ${m.name}`} style={{ fontSize: 8 }} onClick={() => setCurrentMeals(prev => prev.filter((_,j)=>j!==i))}>✕</button>}
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: "#E0EAF0" }}>{m.calories} kcal · {m.protein}g P · {m.carbs}g C · {m.fats}g F</div>
                          {currentConflicts.filter(conflict => conflict.index === i).map(conflict => <div key={conflict.allergy} data-testid="meal-allergy" style={{ fontSize: 10, color: NEON3, marginTop: 5 }}>⚠ Contains {conflict.term}: you listed {conflict.allergy}</div>)}
                          {nutritionStyle === "hybrid" && !isFlexibleMeal(m) && <button type="button" className="t3d-btn t3d-btn-sm" onClick={() => setCurrentMeals(meals => meals.map((meal, mealIndex) => mealIndex === i ? { ...meal, repeatDaily: meal.repeatDaily === false } : meal))} style={{ marginTop: 8, fontSize: 8, padding: "5px 8px", background: m.repeatDaily === false ? "rgba(0,200,255,.09)" : "rgba(0,255,178,.09)", color: m.repeatDaily === false ? NEON2 : NEON, borderColor: m.repeatDaily === false ? "rgba(0,200,255,.35)" : "rgba(0,255,178,.35)" }}>{m.repeatDaily === false ? "FLEXIBLE · USE MACRO BUDGET" : "REPEAT THIS MEAL DAILY ✓"}</button>}
                          {(isFlexibleMeal(m) || m.repeatDaily === false) && <div style={{ color: "#6F8792", fontSize: 9, lineHeight: 1.45, marginTop: 6 }}>{m.exampleName || (m.repeatDaily === false ? `Example: ${m.name}. ` : "")}Choose any food and log its actual macros.</div>}
                        </div>
                      ))}
                      {/* Totals vs target */}
                      <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 10 }}>
                        <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>{editingRestDay ? "REST DAY TOTALS vs REST DAY TARGETS" : "TOTALS vs TARGETS"}</div>
                        {[["Calories", currentMeals.reduce((a,m)=>a+(m.calories||0),0), editingRestDay ? restTarget.calories : finalMacros.calories, NEON, "kcal"],
                          ["Protein", currentMeals.reduce((a,m)=>a+(m.protein||0),0), finalMacros.protein, NEON2, "g"]].map(([l,v,t,c,u]) => (
                          <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                            <span style={{ color: "#E0EAF0" }}>{l}</span>
                            <span style={{ color: Math.abs(v-t)/t<0.1?NEON:"#FF8C00" }}>{v} / {t}{u}</span>
                          </div>
                        ))}
                        {!targetMinimumProblem && mealPlanFloorProblem(editingRestDay ? preparedRestDayMeals : preparedPlanMeals, sex) && (
                          <div data-testid="meals-below-minimum" style={{ fontSize: 10, color: "#FF8FA3", marginTop: 6, lineHeight: 1.5 }}>{mealPlanFloorProblem(editingRestDay ? preparedRestDayMeals : preparedPlanMeals, sex, editingRestDay ? "Your rest day meals" : "Your meals")} You can&apos;t save the plan until they do.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {editingRestDay && currentMeals.length > 0 && <div style={{ fontSize: 9, color: "#8AABB8", lineHeight: 1.5, margin: "-6px 0 10px" }}>Rest day target: {restTarget.calories.toLocaleString("en-GB")} kcal, about 12% lighter than training days (mostly from carbs, the same protein).</div>}
                  {editingRestDay && planMeals.length > 0 && !restAiLoading && <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginBottom: 8, borderColor: "rgba(0,200,255,.3)", color: NEON2 }} onClick={buildRestDayAI}>🤖 {currentMeals.length ? "REBUILD WITH AI (LIGHTER)" : "AI: LIGHTER VERSION OF MY TRAINING DAY"}</button>}
                  {(buildMode === "own" || editingRestDay) && nutritionStyle !== "flexible" && <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginBottom: 14 }} onClick={() => { setEditMealIdx(null); setNewMeal({ name:"",time:"",ingredients:[],calories:"",protein:"",carbs:"",fats:"" }); setAddMealModal(true); }}>+ ADD MEAL</button>}
                </div>
              )}


              {/* Rest days: same as training days, or their own meals */}
              {!editingRestDay && !showAiQuestions && !aiMealLoading && planMeals.length > 0 && nutritionStyle !== "flexible" && (
                <div data-testid="rest-day-choice" style={{ marginBottom: 12, padding: 12, border: `1px solid ${BORDER}`, borderRadius: 7 }}>
                  <h2 className="t3d-ctitle" style={{ marginBottom: 6 }}>REST DAYS</h2>
                  <div style={{ fontSize: 10, color: "#8AABB8", marginBottom: 8 }}>On days with no workout, eat:</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-pressed={!hasRestDayPlan} style={{ whiteSpace: "normal", ...optionStyle(!hasRestDayPlan) }} onClick={() => setHasRestDayPlan(false)}>THE SAME MEALS</button>
                    <button type="button" className="t3d-btn t3d-btn-sm" aria-pressed={hasRestDayPlan} style={{ whiteSpace: "normal", ...optionStyle(hasRestDayPlan) }} onClick={() => { setHasRestDayPlan(true); setEditingRestDay(true); }}>DIFFERENT REST DAY MEALS</button>
                  </div>
                  {hasRestDayPlan && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10, fontSize: 10, color: "#C5D6DC" }}>
                      <span>{restDayMeals.length ? `Rest day plan: ${restDayMeals.length} meals · ${restDayMeals.reduce((total, meal) => total + (Number(meal.calories) || 0), 0).toLocaleString()} kcal` : "No rest day meals yet."}</span>
                      <button className="t3d-btn t3d-btn-sm" onClick={() => setEditingRestDay(true)}>{restDayMeals.length ? "EDIT REST DAYS →" : "BUILD REST DAYS →"}</button>
                    </div>
                  )}
                </div>
              )}

              {!(showAiQuestions && !editingRestDay) && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => (editingRestDay ? setEditingRestDay(false) : setSetupStep(1))}>← BACK</button>
                  {planMeals.length > 0 && <button className="t3d-btn" style={{ flex: 1, padding: 12 }} onClick={() => { setEditingRestDay(false); setSetupStep(3); }}>REVIEW →</button>}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Review, with a link to change each part */}
          {setupStep === 3 && (
            <div>
              <h2 className="t3d-ctitle">REVIEW YOUR PLAN</h2>
              <PlanReviewSection title="TARGETS" testId="review-section-targets" onEdit={() => setSetupStep(0)}>
                <div style={{ color: "#E0EAF0" }}>{finalMacros.calories.toLocaleString("en-GB")} kcal · {finalMacros.protein} g protein · {finalMacros.carbs} g carbs · {finalMacros.fats} g fat</div>
                {preparedRestDayMeals.length > 0 && <div>Rest days: {restTarget.calories.toLocaleString("en-GB")} kcal, about 12% lighter (from carbs, the same protein).</div>}
                <div>{goal} · {setupMode === "custom" ? "your own targets" : activityLevel}</div>
              </PlanReviewSection>
              <PlanReviewSection title="STRUCTURE" testId="review-section-structure" onEdit={() => setSetupStep(1)}>
                <div data-testid="review-style">{nutritionStyle === "hybrid"
                  ? `Hybrid plan: repeated meals give you consistency; flexible meals let you choose foods while aiming for the remaining macros.${preparedRestDayMeals.length ? " Rest days have their own meals." : ""}`
                  : nutritionStyle === "flexible" ? "Flexible macro plan: choose your food and log what each meal contributes toward the daily targets."
                    : preparedRestDayMeals.length ? "Fixed plan: your training day meals repeat on training days, and your rest day meals on rest days." : "Fixed plan: these meals repeat each day."}</div>
              </PlanReviewSection>
              <PlanReviewSection title="YOUR DAY" testId="review-section-day" onEdit={() => { setEditingRestDay(false); setSetupStep(2); }}>
                <div>Wake-up {wakeTime || "not set"} · Allergies: {aiNutritionAnswers.allergies?.trim() || "none given"}</div>
              </PlanReviewSection>
              <PlanReviewSection title={preparedRestDayMeals.length ? "TRAINING DAY MEALS" : "MEALS"} testId="review-section-meals" onEdit={() => { setEditingRestDay(false); setSetupStep(2); }}>
                {preparedPlanMeals.map((m, i) => (
                  <div key={i} style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, marginBottom: 4, color: isFlexibleMeal(m) ? NEON2 : "#E0EAF0" }}>{m.name} {m.time && <span style={{ fontSize: 10, color: "#E0EAF0" }}>· {m.time}</span>}</div>
                    {isFlexibleMeal(m) ? <div style={{ fontSize: 9, color: "#8AABB8" }}>Choose any food and log the actual macros.</div> : m.ingredients?.map((ing,j) => <div key={j} style={{ fontSize: 10, color: "#E0EAF0" }}>{ing.name} — {ing.weight}{ing.unit}</div>)}
                    <div style={{ fontSize: 10, color: "#4A6070", marginTop: 6 }}>{m.calories} kcal · {m.protein}g P · {m.carbs}g C · {m.fats}g F</div>
                  </div>
                ))}
                {preparedPlanMeals.length === 0 && <div>No meals yet.</div>}
              </PlanReviewSection>
              {nutritionStyle !== "flexible" && (
                <PlanReviewSection title="REST DAY MEALS" testId="review-section-rest" onEdit={() => { setEditingRestDay(hasRestDayPlan); setSetupStep(2); }}>
                  {preparedRestDayMeals.length === 0 ? <div data-testid="review-rest-same">Rest days: the same meals as training days.</div> : preparedRestDayMeals.map((m, i) => (
                    <div key={i} style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "#E0EAF0" }}>{m.name} {m.time && <span style={{ fontSize: 10 }}>· {m.time}</span>}</div>
                      <div style={{ fontSize: 10, color: "#4A6070", marginTop: 4 }}>{m.calories} kcal · {m.protein}g P</div>
                    </div>
                  ))}
                </PlanReviewSection>
              )}
              {reviewPlanGap && (
                <div role="alert" data-testid="review-target-gap" style={{ border: "1px solid rgba(255,181,71,.4)", background: "rgba(255,181,71,.06)", borderRadius: 6, padding: 12, marginTop: 12, fontSize: 11, color: "#FFD08A", lineHeight: 1.55 }}>
                  <strong style={{ color: "#FFB547" }}>Check your totals.</strong> {preparedRestDayMeals.length ? reviewPlanGap.replace("These meals", "Your training day meals") : reviewPlanGap} You can still save, or go back and adjust portions.
                </div>
              )}
              {reviewRestGap && (
                <div role="alert" data-testid="review-rest-gap" style={{ border: "1px solid rgba(255,181,71,.4)", background: "rgba(255,181,71,.06)", borderRadius: 6, padding: 12, marginTop: 12, fontSize: 11, color: "#FFD08A", lineHeight: 1.55 }}>
                  <strong style={{ color: "#FFB547" }}>Check your rest days.</strong> {reviewRestGap.replace("These meals", "Your rest day meals")} You can still save, or adjust them.
                </div>
              )}
              {reviewConflicts.length > 0 && (
                <div role="alert" data-testid="review-allergy" style={{ border: `1px solid ${NEON3}`, borderRadius: 6, padding: 12, marginTop: 12, fontSize: 11, color: "#E0EAF0", lineHeight: 1.55 }}>
                  <div style={{ color: NEON3, fontWeight: 700, marginBottom: 4 }}>These meals contain foods you listed as allergies or intolerances:</div>
                  {allergyConflictText(reviewConflicts)}.
                  <div style={{ marginTop: 6, color: "#8AABB8" }}>Go back and swap them. Only save if you have checked they are safe for you (for example a lactose-free version).</div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 10 }}>
                    <input type="checkbox" checked={allergyCheckConfirmed} onChange={e => setAllergyCheckConfirmed(e.target.checked)} /> I have checked these are safe for me
                  </label>
                </div>
              )}
              {(targetMinimumProblem || mealMinimumProblems.length > 0) && (
                <div style={{ marginTop: 12 }}>
                  {minimumAlert(<><strong style={{ color: "#FF4D6D" }}>Raise this before saving.</strong> {[targetMinimumProblem, ...mealMinimumProblems].filter(Boolean).join(" ")}</>, "review-calorie-minimum")}
                </div>
              )}
              {!targetMinimumProblem && lossWarningFor(finalMacros.calories) && <div style={{ marginTop: 12 }}>{lossAlert(lossWarningFor(finalMacros.calories), "review-weekly-loss")}</div>}
              {planSaveError && (
                <div style={{ fontSize: 11, color: NEON3, marginTop: 12, textAlign: "center" }}>
                  Couldn&apos;t save your plan: {planSaveError}. Please try again.
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                {reviewReturn
                  ? <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={leaveSetup}>CLOSE</button>
                  : <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setSetupStep(2)}>← BACK</button>}
                <button className="t3d-btn" style={{ flex: 1, padding: 12 }} disabled={savingPlan || !preparedPlanMeals.length || (reviewConflicts.length > 0 && !allergyCheckConfirmed) || Boolean(targetMinimumProblem) || mealMinimumProblems.length > 0} onClick={async () => {
                  setSavingPlan(true);
                  setPlanSaveError(false);
                  const realMacros = getFinalMacros();
                  const saved = await savePlan(preparedPlanMeals, preparedRestDayMeals, realMacros);
                  setSavingPlan(false);
                  if (!saved) return;
                  clearSetupDraft();
                  const nextLibrary = mergeMealLibrary(mealLibrary, preparedPlanMeals);
                  setMealLibrary(nextLibrary);
                  await persistNutritionPlanning(nextLibrary, weeklyMealPlan);
                  setPlan(current => ({ ...current, ...saved, meal_library: nextLibrary, weekly_meal_plan: weeklyMealPlan }));
                  setView("home");
                }}>{savingPlan ? "SAVING..." : "SAVE PLAN ✓"}</button>
              </div>
            </div>
          )}
        </div>

        {/* Add/Edit meal modal */}
        {addMealModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 380, maxHeight: "85vh", overflowY: "auto" }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 16 }}>{editMealIdx !== null ? "EDIT MEAL" : "ADD MEAL"}</div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>MEAL NAME</div>
                <input className="t3d-input" placeholder="e.g. Chicken & Rice" value={newMeal.name} onChange={e => setNewMeal(n => ({ ...n, name: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>TIME (OPTIONAL)</div>
                <input className="t3d-input" type="time" value={newMeal.time} onChange={e => setNewMeal(n => ({ ...n, time: e.target.value, manualTime: Boolean(e.target.value) }))} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 8 }}>INGREDIENTS</div>
                {newMeal.ingredients.map((ing, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11, color: "#8AABB8" }}>
                    <span>{ing.name}</span><span>{ing.weight}{ing.unit}</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <input className="t3d-input" placeholder="Ingredient" value={newIngredient.name} onChange={e => setNewIngredient(n => ({ ...n, name: e.target.value }))} style={{ flex: 2 }} />
                  <input className="t3d-input" type="number" placeholder="100" value={newIngredient.weight} onChange={e => setNewIngredient(n => ({ ...n, weight: e.target.value }))} style={{ flex: 1 }} />
                  <select value={newIngredient.unit} onChange={e => setNewIngredient(n => ({ ...n, unit: e.target.value }))} style={{ background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 5, color: "#E0EAF0", padding: "8px 4px", fontSize: 11, outline: "none" }}>
                    <option>g</option><option>ml</option><option>oz</option>
                  </select>
                </div>
                <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 8, width: "100%" }} disabled={!newIngredient.name||!newIngredient.weight}
                  onClick={() => { setNewMeal(n => ({ ...n, ingredients: [...n.ingredients, newIngredient] })); setNewIngredient({ name:"",weight:"",unit:"g" }); }}>+ ADD INGREDIENT</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[["calories","KCAL",NEON],["protein","PROTEIN (g)",NEON2],["carbs","CARBS (g)","#FF8C00"],["fats","FATS (g)","#8AABB8"]].map(([key,label,color]) => (
                  <div key={key} style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color, letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                    <input className="t3d-input" type="number" placeholder="0" value={newMeal[key]} onChange={e => setNewMeal(n => ({ ...n, [key]: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => { setAddMealModal(false); setEditMealIdx(null); setNewMeal({ name:"",time:"",ingredients:[],calories:"",protein:"",carbs:"",fats:"" }); }}>CANCEL</button>
                <button className="t3d-btn" style={{ flex: 1 }} disabled={!newMeal.name} onClick={() => {
                  const meal = { ...newMeal, calories: parseInt(newMeal.calories)||0, protein: parseInt(newMeal.protein)||0, carbs: parseInt(newMeal.carbs)||0, fats: parseInt(newMeal.fats)||0 };
                  if (editMealIdx !== null) setCurrentMeals(prev => prev.map((m,i) => i===editMealIdx?meal:m));
                  else setCurrentMeals(prev => applyMealTimes([...prev, meal], wakeTime));
                  setAddMealModal(false); setEditMealIdx(null);
                  setNewMeal({ name:"",time:"",ingredients:[],calories:"",protein:"",carbs:"",fats:"" });
                }}>{editMealIdx !== null ? "SAVE CHANGES ✓" : "ADD MEAL ✓"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── HOME VIEW ─────────────────────────────────────────────────────────────
  const todayLog = logs.find(l => l.date === today);
  // Each day type's meals against that day's targets: say so when they miss.
  const restPlan = hasRestDayMeals(plan);
  const trainingTargets = dayTargets(plan, true);
  const restTargets = dayTargets(plan, false);
  const gapFor = (meals, targets) => (meals?.length ? mealPlanGapText(mealPlanTargetCheck(meals, targets), targets) : "");
  const trainingGap = gapFor(plan?.meals, trainingTargets);
  const restGap = restPlan ? gapFor(plan.rest_day_meals, restTargets) : "";
  const mealsTotal = meals => (meals || []).reduce((total, meal) => ({ calories: total.calories + (Number(meal.calories) || 0), protein: total.protein + (Number(meal.protein) || 0) }), { calories: 0, protein: 0 });
  const planStyle = inferNutritionStyle(plan?.meals || []);
  const planStyleText = planStyle === "hybrid"
    ? `Repeat your anchor meals; choose freely for the flexible slots.${restPlan ? " Rest days have their own meals." : ""}`
    : planStyle === "flexible" ? "Choose your food and work toward the daily totals."
      : restPlan ? "Your training day meals repeat on training days, and your rest day meals on rest days." : "The same planned meals repeat each day.";
  const planMealNames = new Set([...(plan?.meals || []), ...(plan?.rest_day_meals || [])].map(meal => String(meal?.name || "").trim().toLowerCase()).filter(Boolean));
  // Plan meals show once, in LOG AS YOU GO; the library lists the others.
  const libraryOnly = mealLibrary.map((meal, index) => ({ meal, index })).filter(({ meal }) => !planMealNames.has(String(meal.name || "").trim().toLowerCase()));
  // A profile completed after the plan was made can change the targets.
  const targetSuggestion = plan ? targetUpdateSuggestion({ plan, profile, weight: latestWeight, activityLevel: suggestActivityLevel(trainingDaysCount), todayKey: today }) : null;
  // Kept dismissed while the plan's target and the suggested one stay the same.
  const targetSuggestionKey = targetSuggestion ? `${Number(plan?.daily_calories) || 0}|${targetSuggestion.targets.calories}` : "";
  const showTargetSuggestion = Boolean(targetSuggestion) && dismissedTargetSuggestion !== targetSuggestionKey && plan?.setup?.targetSuggestionDismissed !== targetSuggestionKey;
  // The week's average target: rest days count with their own target.
  const avgTarget = weekLogs.length ? Math.round(weekLogs.reduce((total, log) => total + dayTargets(plan, log.is_training_day !== false).calories, 0) / weekLogs.length) : trainingTargets.calories;
  // A plan saved before the daily minimum existed can be below it.
  const planSex = plan?.setup?.sex || sexLabel(profile?.sex);
  const planMinimumProblem = plan ? calorieTargetProblem(plan.daily_calories, planSex)
    || mealPlanFloorProblem(plan.meals, planSex, restPlan ? "Your training day meals" : "Your planned meals")
    || (restPlan ? mealPlanFloorProblem(plan.rest_day_meals, planSex, "Your rest day meals") : "") : "";
  const planLossWarning = plan ? weeklyLossWarning({ calories: plan.daily_calories, maintenance: plan.setup?.tdee, weight: plan.setup?.weight || latestWeight }) : "";

  return (
    <div className="t3d-fade">
      {setupDraft && (
        <div className="t3d-card" data-testid="setup-draft" style={{ marginBottom: 16, borderColor: "rgba(255,181,71,.45)" }}>
          <h2 className="t3d-ctitle" style={{ color: "#FFB547" }}>UNSAVED PLAN CHANGES</h2>
          <div style={{ fontSize: 11, color: "#C5D6DC", lineHeight: 1.6, marginBottom: 10 }}>You started changing your nutrition plan and didn&apos;t save it. Your changes are kept on this device.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="t3d-btn t3d-btn-sm" onClick={() => restoreSetupDraft(setupDraft)}>CONTINUE EDITING →</button>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={clearSetupDraft}>DISCARD CHANGES</button>
          </div>
        </div>
      )}
      {!plan ? (
        <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🥗</div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, letterSpacing: 3, color: NEON, marginBottom: 8 }}>NUTRITION</div>
          <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 28, lineHeight: 1.7 }}>Build your nutrition plan.<br />Track every meal. Hit every target.</div>
          <button className="t3d-btn" style={{ fontSize: 11, padding: "14px 28px" }} onClick={() => openSetup()}>SET UP MY NUTRITION</button>
          <div style={{ marginTop: 16, fontSize: 10, color: "#2A3A48", lineHeight: 1.6 }}>Calorie targets are estimates. Consult a dietitian for medical nutrition advice.</div>
        </div>
      ) : (
        <>
          {planMinimumProblem && (
            <div className="t3d-card" role="alert" data-testid="plan-below-minimum" style={{ marginBottom: 16, borderColor: "rgba(255,77,109,.5)", background: "rgba(255,77,109,.05)" }}>
              <h2 className="t3d-ctitle" style={{ color: "#FF4D6D" }}>YOUR PLAN IS BELOW THE MINIMUM</h2>
              <div style={{ fontSize: 11, color: "#FFD0D8", lineHeight: 1.6, marginBottom: 8 }}>{planMinimumProblem}</div>
              <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.5, marginBottom: 10 }}>{EATING_SUPPORT_TEXT}</div>
              <button className="t3d-btn t3d-btn-sm" onClick={() => openSetup()}>EDIT PLAN →</button>
            </div>
          )}
          {/* Today: log meals as they happen, then the day review */}
          <div className="t3d-card" data-testid="nutrition-today" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <h2 className="t3d-ctitle" style={{ margin: 0 }}>LOG AS YOU GO</h2>
              <div role="group" aria-label="Today is a" style={{ display: "flex", gap: 6 }}>
                <button className="t3d-btn t3d-btn-sm" aria-pressed={isTrainingDay} style={{ background: isTrainingDay?"rgba(0,255,178,.12)":"transparent", borderColor: isTrainingDay?NEON:BORDER, color: isTrainingDay?NEON:"#E0EAF0" }} onClick={() => setIsTrainingDay(true)}>TRAINING DAY</button>
                <button className="t3d-btn t3d-btn-sm" aria-pressed={!isTrainingDay} style={{ background: !isTrainingDay?"rgba(0,200,255,.12)":"transparent", borderColor: !isTrainingDay?NEON2:BORDER, color: !isTrainingDay?NEON2:"#E0EAF0" }} onClick={() => setIsTrainingDay(false)}>REST DAY</button>
              </div>
            </div>
            <div style={{ fontSize: 10, color: "#8AABB8", lineHeight: 1.5, marginBottom: 4 }}>{activeNutritionStyle === "fixed" ? "Tick each planned meal when you have it. If it changes, tap × and briefly say what happened. Tap a meal to see what's in it." : "Tick repeated meals when you have them. For flexible meals, enter what the meal contributed to your macros."}</div>
            <MealLogList meals={activeMeals} results={mealResults} onResultsChange={setMealResults} onSave={updated => saveLog(updated, todayLogged)} showDetails library={mealLibrary} onAddToLibrary={addMealToLibrary} />
            <LogSomethingElse onAdd={addExtraToToday} />
            {nutritionSaveError && <div role="alert" style={{ color: NEON3, fontSize: 9, lineHeight: 1.5, marginTop: 6 }}>{nutritionSaveError}</div>}
            {/* Day review */}
            <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 12, paddingTop: 16, textAlign: "center" }}>
            {todayLogged ? (
              <>
                <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: NEON, letterSpacing: 2, marginBottom: 4 }}>TODAY LOGGED</div>
                <div style={{ fontSize: 11, color: "#E0EAF0", marginBottom: 12 }}>{todayLog?.total_calories} kcal · {todayLog?.total_protein}g protein</div>
                <button className="t3d-btn t3d-btn-sm" style={{ opacity: 0.6 }} onClick={() => { setMealResults(todayLog?.meals_completed||{}); setOffPlanFood(todayLog?.off_plan_food||""); setOffPlanCals(String(todayLog?.off_plan_calories||"")); setReviewSkipAnswered(false); setFoodEstimate(null); setFoodEstimateStatus(""); setReviewStep(0); setAiFeedback(""); setView("review"); }}>EDIT TODAY</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#8AABB8", marginBottom: 12, letterSpacing: 1 }}>FINISHED EATING FOR TODAY?</div>
                <button className="t3d-big-btn"
                  style={{ background: "linear-gradient(90deg, rgba(0,255,178,.15), rgba(0,200,255,.15))", border: `1px solid ${NEON}`, color: NEON, fontSize: 14, letterSpacing: 3 }}
                  onClick={() => { setReviewSkipAnswered(true); setFoodEstimate(null); setFoodEstimateStatus(""); setReviewStep(nextReviewStep(activeMeals, mealResults, -1, true)); setAiFeedback(""); setView("review"); }}>
                  🥗 DAY REVIEW
                </button>
              </>
            )}
          </div>

          </div>

          <div className="t3d-card" data-testid="today-targets" style={{ marginBottom: 16, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <h2 className="t3d-ctitle" style={{ margin: 0 }}>REMAINING TODAY</h2>
              <div style={{ fontSize: 9, color: todayTargets.restDay ? NEON2 : "#8AABB8" }}>{todayTargets.restDay ? "REST DAY" : "TRAINING DAY"} TARGET · {todayTargets.calories.toLocaleString("en-GB")} KCAL</div>
            </div>
            {offPlanRoughCalories > 0 && <div data-testid="offplan-rough" style={{ color: "#8AABB8", fontSize: 9, lineHeight: 1.5, marginBottom: 6 }}>Includes a rough protein, carbs and fat split for {Math.round(offPlanRoughCalories).toLocaleString("en-GB")} kcal of extra food logged without them.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, textAlign: "center" }}>
              {[["calories","KCAL",NEON],["protein","PROTEIN",NEON2],["carbs","CARBS","#FF8C00"],["fats","FATS","#C5D6DC"]].map(([key,label,color]) => <div key={key} data-testid={`remaining-${key}`} style={{ padding: "8px 3px", background: SURFACE2, borderRadius: 5 }}><div style={{ color, fontSize: 13, fontWeight: 700 }}>{remainingNutrition[key]}{key === "calories" ? "" : "g"}</div><div style={{ color: "#6F8792", fontSize: 7, marginTop: 3 }}>{label}</div></div>)}
            </div>
          </div>

          {showTargetSuggestion && (
            <div className="t3d-card" role="status" data-testid="target-suggestion" style={{ marginBottom: 16, borderColor: "rgba(0,200,255,.45)", background: "rgba(0,200,255,.04)" }}>
              <h2 className="t3d-ctitle" style={{ color: NEON2 }}>UPDATE YOUR TARGETS?</h2>
              <div style={{ fontSize: 11, color: "#C5D6DC", lineHeight: 1.6, marginBottom: 10 }}>
                With your profile ({targetSuggestion.stats.height} cm, age {targetSuggestion.stats.age}, {String(targetSuggestion.stats.sex).toLowerCase()}) and {targetSuggestion.stats.weight} kg, {targetSuggestion.stats.goal} and {String(targetSuggestion.stats.activityLevel).toLowerCase()}, your target works out at <strong>{targetSuggestion.targets.calories.toLocaleString("en-GB")} kcal</strong> and {targetSuggestion.targets.protein} g protein. Your plan uses {Number(plan.daily_calories).toLocaleString("en-GB")} kcal.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="t3d-btn t3d-btn-sm" style={{ borderColor: NEON2, color: NEON2 }} onClick={() => openTargetUpdate(targetSuggestion)}>REVIEW NEW TARGETS →</button>
                <button className="t3d-btn t3d-btn-sm" onClick={() => dismissTargetSuggestion(targetSuggestionKey)}>KEEP MY TARGETS</button>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="t3d-grid3">
            <div className="t3d-card" style={{ textAlign: "center" }}>
              <h2 className="t3d-ctitle">{todayTargets.restDay ? "REST DAY TARGET" : "DAILY TARGET"}</h2>
              <div className="t3d-sval" style={{ color: NEON, fontSize: 22 }}>{todayTargets.calories}</div>
              <div className="t3d-slabel">KCAL</div>
            </div>
            <div className="t3d-card" style={{ textAlign: "center" }}>
              <h2 className="t3d-ctitle">ON PLAN STREAK</h2>
              <div className="t3d-sval" style={{ color: streak>=3?"#FF8C00":NEON2 }}>{streak}{streak>=3?" 🔥":""}</div>
              <div className="t3d-slabel">DAYS</div>
            </div>
            <div className="t3d-card" style={{ textAlign: "center" }}>
              <h2 className="t3d-ctitle">PROTEIN TARGET</h2>
              <div className="t3d-sval" style={{ color: "#FF8C00", fontSize: 22 }}>{todayTargets.protein}g</div>
              <div className="t3d-slabel">PER DAY</div>
            </div>
          </div>

          {/* The plan: a summary per day type (the meals themselves are in LOG AS YOU GO) */}
          <div className="t3d-card" data-testid="your-plan" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <h2 className="t3d-ctitle" style={{ margin: 0 }}>YOUR PLAN · {planStyle === "hybrid" ? "HYBRID" : planStyle === "flexible" ? "FLEXIBLE MACROS" : "FIXED MEALS"}</h2>
              <button className="t3d-btn t3d-btn-sm" onClick={() => openSetup()}>EDIT PLAN</button>
            </div>
            <div data-testid="plan-style" style={{ color: "#8AABB8", fontSize: 10, lineHeight: 1.5, marginBottom: 10 }}>{planStyleText}</div>
            {!planMinimumProblem && planLossWarning && <div role="status" data-testid="plan-weekly-loss" style={{ color: "#FFD08A", fontSize: 10, lineHeight: 1.5, marginBottom: 10 }}>{planLossWarning}</div>}
            {[
              { key: "training", label: "TRAINING DAYS", meals: plan.meals || [], targets: trainingTargets, gap: trainingGap, rest: false },
              { key: "rest", label: "REST DAYS", meals: restPlan ? plan.rest_day_meals : [], targets: restTargets, gap: restGap, rest: true },
            ].map(day => {
              const totals = mealsTotal(day.meals);
              return (
                <div key={day.key} data-testid={`plan-${day.key}`} style={{ padding: "10px 0", borderTop: `1px solid ${BORDER}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: day.rest ? NEON2 : NEON, letterSpacing: 1 }}>{day.label}</div>
                      <div style={{ fontSize: 11, color: "#C5D6DC", marginTop: 3 }}>
                        {day.rest && !restPlan ? "The same meals as training days" : `${day.meals.length} meal${day.meals.length === 1 ? "" : "s"} · ${totals.calories.toLocaleString("en-GB")} kcal · ${totals.protein} g protein`}
                      </div>
                      <div style={{ fontSize: 9, color: "#6F8792", marginTop: 2 }}>Target {day.targets.calories.toLocaleString("en-GB")} kcal · {day.targets.protein} g protein{day.targets.restDay ? " (about 12% lighter)" : ""}</div>
                    </div>
                    <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 8, flexShrink: 0 }} onClick={() => openMealEditor(day.rest)}>EDIT MEALS</button>
                  </div>
                  {day.gap && (
                    <div role="alert" data-testid={day.rest ? "plan-rest-gap" : "plan-target-gap"} style={{ border: "1px solid rgba(255,181,71,.4)", background: "rgba(255,181,71,.06)", borderRadius: 6, padding: 10, marginTop: 8, fontSize: 10, color: "#FFD08A", lineHeight: 1.55 }}>
                      <strong style={{ color: "#FFB547" }}>Your meals don&apos;t match your targets.</strong> {day.gap.replace("These meals", day.rest ? "Your rest day meals" : "Your training day meals")}
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <button className="t3d-btn t3d-btn-sm" style={{ borderColor: "rgba(255,181,71,.45)", color: "#FFB547" }} onClick={() => openMealEditor(day.rest)}>EDIT MEALS</button>
                        <button className="t3d-btn t3d-btn-sm" onClick={() => openSetup({ step: 0 })}>CHANGE TARGETS</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {activeNutritionStyle !== "fixed" && <div className="t3d-card" style={{ marginBottom: 16 }}>
            <h2 className="t3d-ctitle">PLAN TOMORROW &amp; THE WEEK</h2>
            <div style={{ color: "#8AABB8", fontSize: 10, lineHeight: 1.55, marginBottom: 12 }}>Decide the night before what you are aiming for. Repeated meals, library meals and flexible slots can all be mixed.</div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 7, marginBottom: 10 }}>
              {planningDates.map(date => <button key={date.key} className="t3d-btn t3d-btn-sm" onClick={() => setPlannerDate(date.key)} style={{ flex: "0 0 auto", background: plannerDate === date.key ? "rgba(0,200,255,.12)" : "transparent", borderColor: plannerDate === date.key ? NEON2 : BORDER, color: plannerDate === date.key ? NEON2 : "#8AABB8" }}>{date.label}{weeklyMealPlan[date.key]?.length ? ` · ${weeklyMealPlan[date.key].length}` : ""}</button>)}
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
              <button className="t3d-btn t3d-btn-sm" onClick={() => updateDatedMealPlan(plannerDate, plannerTemplateMeals.map(meal => ({ ...meal, plannedId: globalThis.crypto?.randomUUID?.() || `planned-${Date.now()}-${Math.random()}` })))}>USE {plannerIsTrainingDay ? "TRAINING" : "DAILY"} TEMPLATE</button>
              <button className="t3d-btn t3d-btn-sm" style={{ borderColor: "rgba(0,200,255,.35)", color: NEON2 }} onClick={() => {
                const flexibleTemplate = (plan?.meals || []).find(isFlexibleMeal) || { name: "Flexible meal", mealType: "flexible", calories: Math.round((plan?.daily_calories || 0) / Math.max(1, plan?.meals?.length || 4)), protein: Math.round((plan?.protein_target || 0) / Math.max(1, plan?.meals?.length || 4)), carbs: Math.round((plan?.carbs_target || 0) / Math.max(1, plan?.meals?.length || 4)), fats: Math.round((plan?.fats_target || 0) / Math.max(1, plan?.meals?.length || 4)) };
                updateDatedMealPlan(plannerDate, [...plannerMeals, { ...flexibleTemplate, plannedId: globalThis.crypto?.randomUUID?.() || `planned-${Date.now()}` }]);
              }}>+ FLEXIBLE SLOT</button>
            </div>
            {mealLibrary.length > 0 && <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#8AABB8", fontSize: 8, letterSpacing: 1, marginBottom: 6 }}>ADD FROM YOUR LIBRARY</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{mealLibrary.map((meal, index) => <button key={meal.id || `${meal.name}-${index}`} className="t3d-btn t3d-btn-sm" onClick={() => updateDatedMealPlan(plannerDate, [...plannerMeals, { ...meal, plannedId: globalThis.crypto?.randomUUID?.() || `planned-${Date.now()}-${index}` }])}>+ {meal.name}</button>)}</div>
            </div>}
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 9 }}>
              <div style={{ color: NEON2, fontFamily: "'Orbitron',monospace", fontSize: 9, letterSpacing: 1, marginBottom: 7 }}>{planningDates.find(date => date.key === plannerDate)?.label || plannerDate} PLAN</div>
              {plannerMeals.length === 0 ? <div style={{ color: "#6F8792", fontSize: 10, padding: "8px 0" }}>Nothing planned yet. Use your template or add meals from the library.</div> : plannerMeals.map((meal, index) => <div key={meal.plannedId || `${meal.name}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ flex: 1 }}><div style={{ color: isFlexibleMeal(meal) ? NEON2 : "#E0EAF0", fontSize: 11 }}>Meal {index + 1} · {meal.name}</div><div style={{ color: "#6F8792", fontSize: 8 }}>{meal.calories || 0} kcal · {meal.protein || 0}g protein</div></div>
                <button aria-label={`Remove ${meal.name} from ${plannerDate}`} className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => updateDatedMealPlan(plannerDate, plannerMeals.filter((_, mealIndex) => mealIndex !== index))}>×</button>
              </div>)}
              {mealPlanFloorProblem(plannerMeals, planSex) && <div role="status" data-testid="planner-below-minimum" style={{ color: "#FF8FA3", fontSize: 9, lineHeight: 1.5, marginTop: 8 }}>{mealPlanFloorProblem(plannerMeals, planSex, "This day's meals")}</div>}
            </div>
            {nutritionPlanningStatus && <div role="status" style={{ color: nutritionPlanningStatus === "SAVED" ? NEON : nutritionPlanningStatus.startsWith("COULD") ? NEON3 : "#8AABB8", fontSize: 8, marginTop: 8 }}>{nutritionPlanningStatus}</div>}
          </div>}


          <div className="t3d-card" data-testid="meal-library" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}><div><h2 className="t3d-ctitle" style={{ marginBottom: 3 }}>MY MEAL LIBRARY</h2><div style={{ color: "#8AABB8", fontSize: 9 }}>Meals you like that aren&apos;t in your plan, ready for planning the week. Your plan&apos;s meals are in LOG AS YOU GO.</div></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}><button className="t3d-btn t3d-btn-sm" onClick={() => (showLibraryForm ? closeLibraryForm() : setShowLibraryForm(true))}>{showLibraryForm ? "CANCEL" : "+ NEW MEAL"}</button><button className="t3d-btn t3d-btn-sm" style={{ borderColor: "rgba(0,200,255,.35)", color: NEON2 }} onClick={() => openMealEditor(false)}>EDIT MEAL PLAN →</button></div></div>
            {showLibraryForm && <div style={{ padding: 11, background: SURFACE2, borderRadius: 6, marginBottom: 10 }}>
              <input className="t3d-input" placeholder="Meal name" value={libraryMealDraft.name} onChange={event => setLibraryMealDraft(meal => ({ ...meal, name: event.target.value }))} style={{ marginBottom: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 5 }}>
                {[["calories","KCAL"],["protein","P (g)"],["carbs","C (g)"],["fats","F (g)"]].map(([key,label]) => <label key={key} style={{ color: "#6F8792", fontSize: 7 }}>{label}<input className="t3d-input" type="number" inputMode="decimal" value={libraryMealDraft[key]} onChange={event => setLibraryMealDraft(meal => ({ ...meal, [key]: event.target.value }))} style={{ padding: "7px 4px", marginTop: 4 }} /></label>)}
              </div>
              <button className="t3d-btn" disabled={!libraryMealDraft.name.trim()} onClick={saveLibraryMeal} style={{ width: "100%", marginTop: 9 }}>{libraryEditIndex !== null ? "SAVE CHANGES" : "SAVE TO LIBRARY"}</button>
              {libraryEditIndex !== null && <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => deleteLibraryMeal(libraryEditIndex)} style={{ width: "100%", marginTop: 7 }}>DELETE FROM LIBRARY</button>}
            </div>}
            {libraryOnly.length === 0 ? <div style={{ color: "#6F8792", fontSize: 10 }}>No other meals saved yet. Add meals you like with + NEW MEAL.</div> : libraryOnly.map(({ meal, index }) => (
              <div key={meal.id || `${meal.name}-${index}`} data-testid="library-meal" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#E0EAF0", fontSize: 11 }}>{meal.name}</div>
                  <div style={{ color: "#8AABB8", fontSize: 9 }}>{meal.calories || 0} kcal · {meal.protein || 0}g P</div>
                </div>
                <button className="t3d-btn t3d-btn-sm" aria-label={`Edit ${meal.name}`} style={{ fontSize: 8 }} onClick={() => editLibraryMeal(index)}>EDIT</button>
              </div>
            ))}
          </div>

          {/* 7-day chart */}
          <div className="t3d-card" style={{ marginBottom: 16 }}>
            <h2 className="t3d-ctitle">7-DAY CALORIES</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80, padding: "0 4px" }}>
              {last7Logs.map((d, i) => {
                const cals = d.log?.total_calories||0;
                const target = dayTargets(plan, d.log?.is_training_day !== false).calories || 2000;
                const pct = cals?Math.min((cals/target)*100,130):0;
                const color = !cals?BORDER:Math.abs(cals-target)/target<0.1?NEON:cals>target*1.1?NEON3:"#FF8C00";
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", height: 60, display: "flex", alignItems: "flex-end" }}>
                      <div style={{ width: "100%", height: `${Math.max(pct,4)}%`, background: color, borderRadius: "3px 3px 0 0", minHeight: 4 }} />
                    </div>
                    <div style={{ fontSize: 9, color: d.date===today?NEON:"#2A3A48" }}>{d.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weekly summary */}
          <div className="t3d-card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setWeeklyOpen(w=>!w)}>
              <h2 className="t3d-ctitle" style={{ margin: 0 }}>WEEKLY SUMMARY</h2>
              <div style={{ color: "#E0EAF0", fontSize: 14, transform: weeklyOpen?"rotate(180deg)":"rotate(0deg)", transition: "transform .2s" }}>▾</div>
            </div>
            {weeklyOpen && (
              <div style={{ marginTop: 16 }}>
                <div className="t3d-grid3">
                  <div style={{ textAlign: "center" }}><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: NEON }}>{avgCals}</div><div style={{ fontSize: 9, color: "#E0EAF0" }}>AVG KCAL</div><div style={{ fontSize: 8, color: avgTarget && Math.abs(avgCals-avgTarget)/avgTarget<0.05?NEON:"#FF8C00" }}>target {avgTarget}</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: NEON2 }}>{avgProtein}g</div><div style={{ fontSize: 9, color: "#E0EAF0" }}>AVG PROTEIN</div><div style={{ fontSize: 8, color: avgProtein>=plan.protein_target?NEON:"#FF8C00" }}>target {plan.protein_target}g</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: "#FF8C00" }}>{onPlanDays}/7</div><div style={{ fontSize: 9, color: "#E0EAF0" }}>ON PLAN DAYS</div></div>
                </div>
              </div>
            )}
          </div>

          {/* History */}
          <div className="t3d-card">
            <h2 className="t3d-ctitle" style={{ margin: 0 }}>
              <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(h => !h)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", minHeight: 44, padding: 0, background: "none", border: 0, color: "inherit", font: "inherit", letterSpacing: "inherit", textTransform: "inherit", textAlign: "left", cursor: "pointer" }}>
                NUTRITION HISTORY
                <span aria-hidden="true" style={{ color: "#E0EAF0", fontSize: 14, transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s" }}>▾</span>
              </button>
            </h2>
            {historyOpen && (
              <div style={{ marginTop: 16 }}>
                {logs.length===0 ? (
                  <div style={{ fontSize: 11, color: "#E0EAF0", textAlign: "center", padding: "16px 0" }}>No history yet!</div>
                ) : logs.map((log, i) => {
                  const completed = countCompletedMeals(log.meals_completed);
                  const total = plan?.meals?.length||1;
                  // Meals marked as not to plan, and whether any food has no calories yet,
                  // so a day isn't shown as "0 kcal" when food was eaten.
                  const missedCount = Object.entries(log.meals_completed || {}).filter(([key, value]) => !key.startsWith("_") && mealWasMissed(value)).length;
                  const caloriesMissing = !(Number(log.total_calories) > 0) && (missedCount > 0 || unloggedFoodFromLog(log).length > 0);
                  const reviewOpen = log.meals_completed && !Array.isArray(log.meals_completed) && log.meals_completed._review_complete === false;
                  return (
                    <div key={i} style={{ padding: "12px 0", borderBottom: `1px solid ${BORDER}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ fontSize: 10, color: "#E0EAF0", fontFamily: "'Orbitron',monospace" }}>{dateKeyLabel(log.date, { weekday: "short", day: "numeric", month: "short" })}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div style={{ fontSize: 10, color: completed/total>=0.8?NEON:"#FF8C00" }}>{completed}/{total} on plan{missedCount ? ` · ${missedCount} not` : ""}{reviewOpen ? " · review not done" : ""}</div>
                          <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 8 }} onClick={() => {
                            setMealResults(log.meals_completed||{});
                            setOffPlanFood(log.off_plan_food||"");
                            setOffPlanCals(String(log.off_plan_calories||""));
                            setReviewSkipAnswered(false);
                            setFoodEstimate(null);
                            setReviewStep(plan.meals.length+1);
                            setView("review");
                          }}>EDIT</button>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#E0EAF0" }}>
                        <span style={{ color: caloriesMissing ? "#FFB547" : NEON }}>{caloriesMissing ? "kcal not logged yet" : `${log.total_calories} kcal`}</span>
                        <span style={{ color: NEON2 }}>{log.total_protein}g P</span>
                        {log.off_plan_food && <span style={{ color: "#FF8C00" }}>+ off plan</span>}
                      </div>
                      {log.ai_feedback && <div style={{ fontSize: 10, color: "#4A6070", marginTop: 6, fontStyle: "italic" }}>"{log.ai_feedback.slice(0,80)}..."</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}



// ─── Habits ───────────────────────────────────────────────────────────────────

// ─── Calendar Section ─────────────────────────────────────────────────────────
function Calendar({ user, fitnessSessions, nutritionPlan, isTrainingDay: defaultTrainingDay }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => homeDateKey(user));
  const [addModal, setAddModal] = useState(null);
  const [newTask, setNewTask] = useState({ title: "", startTime: "", endTime: "", addDaily: false });
  const [library, setLibrary] = useState([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [newLibTask, setNewLibTask] = useState("");
  const [debrief, setDebrief] = useState(null);
  const [debriefView, setDebriefView] = useState(false);
  const [debriefStep, setDebriefStep] = useState(0);
  const [taskResults, setTaskResults] = useState({});
  const [aiFeedback, setAiFeedback] = useState("");
  const [aiFeedbackLoading, setAiFeedbackLoading] = useState(false);
  const [aiFeedbackError, setAiFeedbackError] = useState("");
  const [todayDebriefed, setTodayDebriefed] = useState(false);
  const [dragTask, setDragTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [morningRoutine, setMorningRoutine] = useState([]);
  const [nutritionMeals, setNutritionMeals] = useState([]);
  const [fitnessData, setFitnessData] = useState(null);

  const today = homeDateKey(user);
  const isToday = selectedDate === today;
  const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

  useEffect(() => { if (!user) return; loadData(); }, [user, selectedDate]);

  useEffect(() => {
    if (!user) return;
    // Load morning routine, nutrition, fitness for auto-populate
    Promise.all([
      readMorningRoutine(user.id),
      readNutritionPlan(user.id),
      readWorkoutSplit(user.id),
    ]).then(([morning, nutrition, fitness]) => {
      if (morning.data?.tasks) setMorningRoutine(morning.data.tasks);
      if (nutrition.data) {
        const todayShort = dateKeyDayCode(selectedDate);
        const isTraining = fitness.data?.sessions?.some(s => s.days?.includes(todayShort));
        const meals = mealsForDay(nutrition.data, selectedDate, isTraining);
        setNutritionMeals(meals);
        setFitnessData({ sessions: fitness.data?.sessions || [], isTraining });
      }
    });
    // Load library from localStorage equivalent via supabase metadata
    const saved = localStorage.getItem(`track3d_task_library_${user.id}`);
    if (saved) setLibrary(JSON.parse(saved));
  }, [user, selectedDate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: taskData } = await supabase.from("calendar_tasks").select("*").eq("user_id", user.id).eq("date", selectedDate).order("start_time");
      if (taskData) setTasks(taskData);
      if (isToday) {
        const { data: debriefData } = await supabase.from("daily_debrief").select("*").eq("user_id", user.id).eq("date", today).maybeSingle();
        if (debriefData) { setDebrief(debriefData); setTodayDebriefed(true); }
      }
    } catch (e) { console.log("Load error:", e); }
    setLoading(false);
  };

  const navigateDay = (dir) => {
    setSelectedDate(shiftDateKey(selectedDate, dir));
  };

  const addTask = async (taskData) => {
    if (!taskData.title.trim()) return;
    const baseTask = { user_id: user.id, title: taskData.title, start_time: taskData.startTime || addModal, end_time: taskData.endTime || "", status: "pending", created_at: new Date().toISOString() };

    if (taskData.addDaily) {
      // Add for next 7 days
      const inserts = Array.from({ length: 7 }, (_, i) => ({ ...baseTask, date: shiftDateKey(selectedDate, i) }));
      await supabase.from("calendar_tasks").insert(inserts);
    } else {
      await supabase.from("calendar_tasks").insert({ ...baseTask, date: selectedDate });
    }
    await loadData();
    setAddModal(null);
    setNewTask({ title: "", startTime: "", endTime: "", addDaily: false });
  };

  const addFromLibrary = async (title) => {
    await addTask({ title, startTime: addModal || "09:00", endTime: "", addDaily: false });
  };

  const saveToLibrary = (title) => {
    if (!title.trim()) return;
    const updated = [...new Set([...library, title.trim()])];
    setLibrary(updated);
    localStorage.setItem(`track3d_task_library_${user.id}`, JSON.stringify(updated));
    setNewLibTask("");
  };

  const removeFromLibrary = (title) => {
    const updated = library.filter(t => t !== title);
    setLibrary(updated);
    localStorage.setItem(`track3d_task_library_${user.id}`, JSON.stringify(updated));
  };

  const updateTaskStatus = async (taskId, status) => {
    await supabase.from("calendar_tasks").update({ status }).eq("id", taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
  };

  const deleteTask = async (taskId) => {
    await supabase.from("calendar_tasks").delete().eq("id", taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const saveEditTask = async (task) => {
    await supabase.from("calendar_tasks").update({ title: task.title, start_time: task.start_time, end_time: task.end_time }).eq("id", task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...task } : t));
    setEditingTask(null);
  };

  const moveTask = async (taskId, newTime) => {
    await supabase.from("calendar_tasks").update({ start_time: newTime }).eq("id", taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, start_time: newTime } : t).sort((a,b) => (a.start_time||"").localeCompare(b.start_time||"")));
  };

  const getAIDebrief = async (results, score) => {
    setAiFeedbackLoading(true);
    setAiFeedbackError("");
    const done = Object.values(results).filter(v => v==="done").length;
    const half = Object.values(results).filter(v => v==="half").length;
    const missed = Object.values(results).filter(v => v==="none").length;
    try {
      const text = await streamCoachText({
          area: "daily_debrief",
          messages: [{ role: "user", content: `Day review: ${done} tasks done, ${half} partial, ${missed} missed. Score: ${score}/10. Tasks: ${tasks.map(t=>`${t.title} (${t.start_time}) — ${results[t.id]||"pending"}`).join(", ")}. Give feedback.` }],
      }, setAiFeedback);
      setAiFeedback(text);
    } catch (e) {
      console.log("Debrief feedback error:", e?.message);
      setAiFeedback("");
      setAiFeedbackError("Couldn't get feedback on your day.");
    }
    setAiFeedbackLoading(false);
  };

  const saveDebrief = async (results, score) => {
    await supabase.from("daily_debrief").upsert({
      user_id: user.id, date: today, task_scores: results,
      overall_score: score, ai_feedback: aiFeedback,
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id,date" });
    setTodayDebriefed(true);
    await loadData();
  };

  const calcScore = (results) => {
    if (!tasks.length) return 0;
    const points = tasks.reduce((a, t) => a + (results[t.id]==="done"?1:results[t.id]==="half"?0.5:0), 0);
    return Math.round((points/tasks.length)*10);
  };

  const statusColor = (s) => s==="done"?NEON:s==="half"?"#FF8C00":s==="none"?NEON3:BORDER;
  const statusIcon = (s) => s==="done"?"✓":s==="half"?"⏰":s==="none"?"✗":"";

  // Auto blocks from other sections
  const getAutoBlocks = () => {
    const blocks = [];
    const dateShort = dateKeyDayCode(selectedDate);

    morningRoutine.forEach(t => {
      if (t.scheduledTime) blocks.push({ time: t.scheduledTime, title: t.name, type: "morning", icon: t.icon||"☀️" });
    });
    nutritionMeals.forEach(m => {
      if (m.time) blocks.push({ time: m.time, title: m.name, type: "nutrition", icon: "🥗" });
    });
    if (fitnessData?.sessions) {
      const session = fitnessData.sessions.find(s => s.days?.includes(dateShort));
      if (session) blocks.push({ time: "17:00", title: session.name + " workout", type: "fitness", icon: "⚡" });
    }
    return blocks;
  };

  const autoBlocks = getAutoBlocks();

  const getBlocksForHour = (hour) => {
    const timeStr = `${String(hour).padStart(2,"0")}:`;
    return {
      auto: autoBlocks.filter(b => b.time?.startsWith(timeStr)),
      user: tasks.filter(t => (t.start_time||"").startsWith(timeStr)),
    };
  };

  const selectedDateFormatted = new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const doneCount = tasks.filter(t=>t.status==="done").length;
  const halfCount = tasks.filter(t=>t.status==="half").length;

  if (loading) return <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 11, color: "#E0EAF0", letterSpacing: 2 }}>LOADING CALENDAR...</div></div></div>;

  // ── DEBRIEF VIEW ──────────────────────────────────────────────────────────
  if (debriefView) {
    const pendingTasks = tasks;
    const currentTask = pendingTasks[debriefStep];
    const isComplete = debriefStep >= pendingTasks.length;

    if (isComplete) {
      const score = calcScore(taskResults);
      return (
        <div className="t3d-fade">
          <div className="t3d-card" style={{ textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🌙</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: NEON, letterSpacing: 3, marginBottom: 20 }}>DAY COMPLETE</div>
            <div style={{ margin: "0 auto 20px" }}><ScoreRing score={score*10} size={120} /></div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: "#E0EAF0", letterSpacing: 2, marginBottom: 20 }}>DAY SCORE: {score}/10</div>
            <div style={{ marginBottom: 20, textAlign: "left" }}>
              {tasks.map((t,i) => {
                const result = taskResults[t.id] || t.status;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 11 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, background: `${statusColor(result)}20`, border: `1px solid ${statusColor(result)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: statusColor(result), flexShrink: 0 }}>{statusIcon(result)}</div>
                    <div style={{ flex: 1, color: "#8AABB8" }}>{t.title}</div>
                    <div style={{ fontSize: 9, color: "#E0EAF0" }}>{t.start_time}</div>
                  </div>
                );
              })}
            </div>
            {aiFeedbackError && !aiFeedbackLoading && <p role="alert" style={{ fontSize: 11, color: "#FFB547", margin: "0 0 8px" }}>{aiFeedbackError}</p>}
            {!aiFeedback && !aiFeedbackLoading && <button className="t3d-btn" style={{ width: "100%", marginBottom: 16 }} onClick={() => getAIDebrief(taskResults, score)}>{aiFeedbackError ? "TRY AGAIN" : "GET AI FEEDBACK"}</button>}
            {aiFeedbackLoading && <div style={{ fontSize: 11, color: "#E0EAF0", marginBottom: 16 }}>AI analysing your day...</div>}
            {aiFeedback && <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 14, marginBottom: 20, textAlign: "left" }}><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: NEON, letterSpacing: 2, marginBottom: 6 }}>AI COACH</div><div style={{ fontSize: 12, color: "#8AABB8", lineHeight: 1.65 }}>{aiFeedback}</div></div>}
            <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={async () => { await saveDebrief(taskResults, score); setDebriefView(false); }}>SAVE & FINISH</button>
          </div>
        </div>
      );
    }

    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div className="t3d-progress-dots">
            {pendingTasks.map((_,i) => <div key={i} className={`t3d-dot-step ${i===debriefStep?"active":i<debriefStep?"done":""}`} />)}
          </div>
          <div style={{ textAlign: "center", marginBottom: 8, fontSize: 10, color: "#E0EAF0", letterSpacing: 2 }}>TASK {debriefStep+1} OF {pendingTasks.length}</div>
          <div style={{ textAlign: "center", padding: "20px 0 28px" }}>
            <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 8 }}>{currentTask?.start_time}{currentTask?.end_time ? ` — ${currentTask.end_time}` : ""}</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, color: "#E0EAF0", letterSpacing: 2, marginBottom: 28 }}>{currentTask?.title}</div>
            <div style={{ fontSize: 12, color: "#E0EAF0", marginBottom: 20 }}>How did this go?</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              {[["✓","done",NEON,"rgba(0,255,178,.1)"],["⏰","half","#FF8C00","rgba(255,140,0,.1)"],["✗","none",NEON3,"rgba(255,45,120,.1)"]].map(([icon,val,color,bg]) => (
                <button key={val} style={{ flex: 1, maxWidth: 90, padding: "16px 8px", background: bg, border: `2px solid ${color}`, borderRadius: 8, cursor: "pointer", fontFamily: "'Orbitron',monospace", fontSize: 20, color }}
                  onClick={() => { setTaskResults(r=>({...r,[currentTask.id]:val})); updateTaskStatus(currentTask.id,val); setDebriefStep(s=>s+1); }}>{icon}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 10, fontSize: 9, color: "#2A3A48", letterSpacing: 1 }}>
              <span>DONE</span><span>PARTIAL</span><span>MISSED</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── CALENDAR HOME ─────────────────────────────────────────────────────────
  return (
    <div className="t3d-fade">
      {/* Day navigation */}
      <div className="t3d-card" style={{ marginBottom: 12, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="t3d-btn t3d-btn-sm" onClick={() => navigateDay(-1)}>◀</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: isToday ? NEON : "#E0EAF0", letterSpacing: 2 }}>
              {isToday ? "TODAY" : new Date(selectedDate+"T12:00:00").toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()}
            </div>
            <div style={{ fontSize: 10, color: "#E0EAF0", marginTop: 2 }}>{selectedDateFormatted}</div>
          </div>
          <button className="t3d-btn t3d-btn-sm" onClick={() => navigateDay(1)}>▶</button>
        </div>
        {!isToday && (
          <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginTop: 10, fontSize: 8 }} onClick={() => setSelectedDate(today)}>BACK TO TODAY</button>
        )}
      </div>

      {/* Stats + debrief */}
      {tasks.length > 0 && (
        <div className="t3d-card" style={{ marginBottom: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: NEON }}>{doneCount}</div>
                <div style={{ fontSize: 8, color: "#E0EAF0", letterSpacing: 1 }}>DONE</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: "#FF8C00" }}>{halfCount}</div>
                <div style={{ fontSize: 8, color: "#E0EAF0", letterSpacing: 1 }}>PARTIAL</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, color: "#E0EAF0" }}>{tasks.length - doneCount - halfCount}</div>
                <div style={{ fontSize: 8, color: "#E0EAF0", letterSpacing: 1 }}>REMAINING</div>
              </div>
            </div>
            {isToday && (
              todayDebriefed ? (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20 }}>🌙</div>
                  <div style={{ fontSize: 9, color: NEON, fontFamily: "'Orbitron',monospace" }}>{debrief?.overall_score}/10</div>
                </div>
              ) : (
                <button className="t3d-btn t3d-btn-sm" style={{ borderColor: NEON2, color: NEON2, background: "rgba(0,200,255,.08)" }}
                  onClick={() => { setDebriefStep(0); setTaskResults({}); setAiFeedback(""); setDebriefView(true); }}>
                  🌙 DEBRIEF
                </button>
              )
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        {/* Quick-add library button */}
        <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, background: showLibrary?"rgba(0,255,178,.12)":"transparent" }}
          onClick={() => setShowLibrary(v => !v)}>
          📚 TASK LIBRARY
        </button>
        <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }}
          onClick={() => { setAddModal("09:00"); setNewTask({ title: "", startTime: "09:00", endTime: "", addDaily: false }); }}>
          + ADD TASK
        </button>
      </div>

      {/* Task Library panel */}
      {showLibrary && (
        <div className="t3d-card" style={{ marginBottom: 12 }}>
          <div className="t3d-ctitle">TASK LIBRARY</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input className="t3d-input" placeholder="Add to library..." value={newLibTask} onChange={e => setNewLibTask(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveToLibrary(newLibTask)} />
            <button className="t3d-btn t3d-btn-sm" onClick={() => saveToLibrary(newLibTask)} disabled={!newLibTask.trim()}>SAVE</button>
          </div>
          {library.length === 0 ? (
            <div style={{ fontSize: 11, color: "#2A3A48", textAlign: "center", padding: "8px 0" }}>No saved tasks yet. Add tasks you do regularly!</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {library.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 20, padding: "5px 10px" }}>
                  <button style={{ background: "none", border: "none", color: NEON, cursor: "pointer", fontSize: 11, padding: 0 }}
                    onClick={() => { setAddModal("09:00"); setNewTask({ title: t, startTime: "09:00", endTime: "", addDaily: false }); setShowLibrary(false); }}>
                    {t}
                  </button>
                  <button type="button" aria-label={`Remove ${t} from your list`} style={{ background: "none", border: "none", color: "#2A3A48", cursor: "pointer", fontSize: 12, padding: "0 0 0 4px" }}
                    onClick={() => removeFromLibrary(t)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hour by hour calendar */}
      <div className="t3d-card">
        <div className="t3d-ctitle" style={{ marginBottom: 12 }}>SCHEDULE</div>
        {HOURS.map(hour => {
          const { auto, user: userBlocks } = getBlocksForHour(hour);
          const timeStr = `${String(hour).padStart(2,"0")}:00`;
          const isCurrentHour = isToday && new Date().getHours() === hour;

          return (
            <div key={hour}
              style={{ display: "flex", gap: 10, minHeight: 48, borderBottom: `1px solid ${isCurrentHour ? NEON+"30" : BORDER}`, paddingTop: 6, paddingBottom: 6, background: isCurrentHour ? "rgba(0,255,178,.02)" : "transparent" }}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); if (dragTask) { moveTask(dragTask, timeStr); setDragTask(null); } }}>

              {/* Time */}
              <div style={{ width: 38, flexShrink: 0, paddingTop: 2 }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: isCurrentHour ? NEON : "#E0EAF0", letterSpacing: 0 }}>
                  {String(hour).padStart(2,"0")}:00
                </div>
              </div>

              {/* Current hour line */}
              <div style={{ width: 2, flexShrink: 0, background: isCurrentHour ? NEON : "transparent", borderRadius: 1, boxShadow: isCurrentHour ? `0 0 8px ${NEON}` : "none" }} />

              <div style={{ flex: 1 }}>
                {/* Auto-populated blocks */}
                {auto.map((block, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 5, marginBottom: 4,
                    background: block.type==="morning"?"rgba(255,140,0,.08)":block.type==="fitness"?"rgba(0,255,178,.08)":"rgba(0,200,255,.08)",
                    border: `1px solid ${block.type==="morning"?"rgba(255,140,0,.25)":block.type==="fitness"?"rgba(0,255,178,.25)":"rgba(0,200,255,.25)"}` }}>
                    <span style={{ fontSize: 13 }}>{block.icon}</span>
                    <div style={{ flex: 1, fontSize: 11, color: block.type==="morning"?"#FF8C00":block.type==="fitness"?NEON:NEON2 }}>{block.title}</div>
                    <div style={{ fontSize: 8, color: "#2A3A48", letterSpacing: 1, background: BORDER, padding: "2px 6px", borderRadius: 10 }}>{block.type.toUpperCase()}</div>
                  </div>
                ))}

                {/* User tasks */}
                {userBlocks.map((task, i) => (
                  <div key={i}
                    draggable
                    onDragStart={() => setDragTask(task.id)}
                    onDragEnd={() => setDragTask(null)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 5, marginBottom: 4,
                      background: SURFACE2, border: `1px solid ${task.status!=="pending"?statusColor(task.status)+"40":BORDER}`,
                      cursor: "grab", opacity: dragTask===task.id?0.5:1 }}>
                    {/* Status toggle */}
                    <div style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${statusColor(task.status)}`, background: task.status!=="pending"?`${statusColor(task.status)}20`:"transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: statusColor(task.status), flexShrink: 0, cursor: "pointer" }}
                      onClick={() => { const next=task.status==="pending"?"done":task.status==="done"?"half":task.status==="half"?"none":"pending"; updateTaskStatus(task.id,next); }}>
                      {statusIcon(task.status)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: task.status==="none"?"#E0EAF0":"#E0EAF0", textDecoration: task.status==="none"?"line-through":"none" }}>{task.title}</div>
                      {task.end_time && <div style={{ fontSize: 9, color: "#E0EAF0" }}>{task.start_time} — {task.end_time}</div>}
                    </div>
                    <div style={{ fontSize: 8, color: "#2A3A48", marginRight: 4 }}>≡</div>
                    <button style={{ background: "none", border: "none", color: "#E0EAF0", cursor: "pointer", fontSize: 11, padding: "0 4px" }}
                      onClick={() => setEditingTask({ ...task })}>✏️</button>
                    <button type="button" aria-label={`Delete ${task.title}`} style={{ background: "none", border: "none", color: "#E0EAF0", cursor: "pointer", fontSize: 14, minWidth: 44, minHeight: 44, padding: 0, lineHeight: 1 }}
                      onClick={() => deleteTask(task.id)}>×</button>
                  </div>
                ))}

                {/* Add button */}
                <button style={{ background: "none", border: "none", color: "#2A3A48", cursor: "pointer", fontSize: 11, padding: "2px 0", letterSpacing: 0.5 }}
                  onClick={() => { setAddModal(timeStr); setNewTask({ title: "", startTime: timeStr, endTime: "", addDaily: false }); }}>
                  + add
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit task modal */}
      {editingTask && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 360 }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 16 }}>EDIT TASK</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>TASK NAME</div>
              <input className="t3d-input" value={editingTask.title} onChange={e => setEditingTask(t => ({ ...t, title: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>START TIME</div>
                <input className="t3d-input" type="time" value={editingTask.start_time || ""} onChange={e => setEditingTask(t => ({ ...t, start_time: e.target.value }))} style={{ colorScheme: "dark" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>END TIME</div>
                <input className="t3d-input" type="time" value={editingTask.end_time || ""} onChange={e => setEditingTask(t => ({ ...t, end_time: e.target.value }))} style={{ colorScheme: "dark" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => setEditingTask(null)}>CANCEL</button>
              <button className="t3d-btn" style={{ flex: 1 }} onClick={() => saveEditTask(editingTask)}>SAVE ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* Add task modal */}
      {addModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 360 }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 16 }}>ADD TASK</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>TASK NAME</div>
              <input className="t3d-input" placeholder="e.g. Team meeting, gym, study..." value={newTask.title}
                onChange={e => setNewTask(n=>({...n,title:e.target.value}))}
                onKeyDown={e => e.key==="Enter" && addTask(newTask)} autoFocus />
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>START TIME</div>
                <input className="t3d-input" type="time" value={newTask.startTime} onChange={e => setNewTask(n=>({...n,startTime:e.target.value}))} style={{ colorScheme: "dark" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#E0EAF0", marginBottom: 6 }}>END TIME</div>
                <input className="t3d-input" type="time" value={newTask.endTime} onChange={e => setNewTask(n=>({...n,endTime:e.target.value}))} style={{ colorScheme: "dark" }} />
              </div>
            </div>
            {/* Add daily toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "10px 12px", background: newTask.addDaily?"rgba(0,255,178,.06)":"transparent", border: `1px solid ${newTask.addDaily?NEON:BORDER}`, borderRadius: 6, cursor: "pointer" }}
              onClick={() => setNewTask(n=>({...n,addDaily:!n.addDaily}))}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `1px solid ${newTask.addDaily?NEON:BORDER}`, background: newTask.addDaily?"rgba(0,255,178,.2)":"transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: NEON, flexShrink: 0 }}>{newTask.addDaily?"✓":""}</div>
              <div>
                <div style={{ fontSize: 11, color: newTask.addDaily?NEON:"#4A6070" }}>Add daily for next 7 days</div>
                <div style={{ fontSize: 9, color: "#2A3A48" }}>Adds this task every day this week</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => { setAddModal(null); setNewTask({ title:"",startTime:"",endTime:"",addDaily:false }); }}>CANCEL</button>
              <button className="t3d-btn" style={{ flex: 1 }} disabled={!newTask.title.trim()} onClick={() => addTask(newTask)}>
                {newTask.addDaily ? "ADD FOR 7 DAYS ✓" : "ADD ✓"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function HabitsPage({ habits, setHabits }) {
  const [adding, setAdding] = useState(false);
  const [newHabit, setNewHabit] = useState({ name: "" });
  const [renaming, setRenaming] = useState(null); // { id, name } while a habit is being renamed
  const cats = [...new Set(habits.map(h => h.category))];
  const remainingSuggestions = POPULAR_DAILY_HABITS.filter(suggestion => !habits.some(habit => habit.name.toLowerCase() === suggestion.name.toLowerCase()));
  const addHabit = (habit = newHabit) => {
    const name = habit.name?.trim();
    if (!name || habits.some(existing => existing.name.toLowerCase() === name.toLowerCase())) return;
    setHabits(current => [...current, { id: String(Date.now()), name, category: habit.category || "daily", done: false, streakBeforeToday: 0 }]);
    setNewHabit({ name: "" });
    setAdding(false);
  };
  // Renaming keeps the habit's streak and today's tick.
  const renameTaken = renaming && habits.some(habit => habit.id !== renaming.id && habit.name.toLowerCase() === renaming.name.trim().toLowerCase());
  const renameHabit = () => {
    const name = renaming?.name.trim();
    if (!name || renameTaken) return;
    setHabits(current => current.map(habit => (habit.id === renaming.id ? { ...habit, name } : habit)));
    setRenaming(null);
  };
  const bestStreak = habits.length ? Math.max(...habits.map(habitStreak)) : 0;
  return (
    <div className="t3d-fade">
      {habits.length === 0 && (
        <div className="t3d-card" style={{ marginBottom: 16, padding: 28, textAlign: "center" }}>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 15, color: NEON, letterSpacing: 2, marginBottom: 8 }}>ADD YOUR HABITS NOW</div>
          <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginBottom: 18 }}>Start with the few daily habits that genuinely matter to you. Nothing is selected automatically.</div>
          <button className="t3d-btn" style={{ padding: "12px 22px", marginBottom: 18 }} onClick={() => setAdding(true)}>+ ADD A HABIT</button>
          <div style={{ fontSize: 9, color: "#4A6070", letterSpacing: 1, marginBottom: 8 }}>POPULAR DAILY HABITS</div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 7, opacity: .58 }}>
            {POPULAR_DAILY_HABITS.map(habit => <button key={habit.name} className="t3d-btn t3d-btn-sm" style={{ whiteSpace: "normal" }} onClick={() => addHabit(habit)}>+ {habit.name}</button>)}
          </div>
        </div>
      )}
      <div className="t3d-grid3">
        <div className="t3d-card">
          <h2 className="t3d-ctitle">COMPLETION RATE</h2>
          <div className="t3d-sval" style={{ color: NEON }}>{habits.length ? Math.round((habits.filter(h=>h.done).length/habits.length)*100) : 0}%</div>
          <div className="t3d-slabel">TODAY</div>
        </div>
        <div className="t3d-card">
          <h2 className="t3d-ctitle">BEST STREAK</h2>
          <div className="t3d-sval" style={{ color: "#FF8C00" }}>{bestStreak}</div>
          <div className="t3d-slabel">{bestStreak === 1 ? "DAY" : "DAYS"}</div>
        </div>
        <div className="t3d-card">
          <h2 className="t3d-ctitle">TOTAL HABITS</h2>
          <div className="t3d-sval" style={{ color: NEON2 }}>{habits.length}</div>
          <div className="t3d-slabel">ACTIVE HABITS</div>
        </div>
      </div>
      {habits.length > 0 && remainingSuggestions.length > 0 && (
        <div className="t3d-card" style={{ marginBottom: 14 }}>
          <h2 className="t3d-ctitle">POPULAR DAILY HABITS</h2>
          <div style={{ fontSize: 10, color: "#6F8792", marginBottom: 10 }}>Optional ideas — keep your list focused.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, opacity: .65 }}>
            {remainingSuggestions.map(habit => <button key={habit.name} className="t3d-btn t3d-btn-sm" style={{ whiteSpace: "normal" }} onClick={() => addHabit(habit)}>+ {habit.name}</button>)}
          </div>
        </div>
      )}
      {cats.map(cat => (
        <div className="t3d-card" key={cat} style={{ marginBottom: 14 }}>
          <h2 className="t3d-ctitle">{cat.toUpperCase()}</h2>
          {habits.filter(h => h.category === cat).map(h => (
            <div key={h.id} className="t3d-hrow">
              <button type="button" aria-label={`${h.done ? "Unselect" : "Complete"} ${h.name}`} aria-pressed={Boolean(h.done)} onClick={() => setHabits(hh => hh.map(x => x.id===h.id ? {...x,done:!x.done} : x))} style={{ width: 44, height: 44, flexShrink: 0, padding: 0, border: 0, background: "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <span className={`t3d-hcheck ${h.done?"done":""}`} style={{ width: 26, height: 26, color: NEON }}>{h.done ? "✓" : ""}</span>
              </button>
              <div className="t3d-hname" style={{ color: h.done?"#E0EAF0":"#8AABB8" }}>{h.name}</div>
              <div className="t3d-pbar" style={{ flex: 1, margin: "0 14px" }}>
                <div className="t3d-pfill" style={{ width: `${Math.min((habitStreak(h)/30)*100,100)}%`, background: habitStreak(h)>=7?"#FF8C00":NEON }} />
              </div>
              <div className={`t3d-hstreak ${habitStreak(h)>=7?"fire":""}`}>{habitStreak(h)>=7?"🔥":"◆"} {habitStreak(h)}d</div>
              <button type="button" aria-label={`Rename ${h.name}`} onClick={() => setRenaming({ id: h.id, name: h.name })} style={{ border: 0, background: "transparent", color: "#8AABB8", cursor: "pointer", fontSize: 10, minWidth: 44, minHeight: 44, padding: 0, textDecoration: "underline" }}>edit</button>
              <button type="button" aria-label={`Remove ${h.name}`} onClick={() => setHabits(current => current.filter(item => item.id !== h.id))} style={{ border: 0, background: "transparent", color: "#6F8792", cursor: "pointer", fontSize: 16, minWidth: 44, minHeight: 44, padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      ))}
      {habits.length > 0 && <button className="t3d-btn" onClick={() => setAdding(true)}>+ ADD NEW HABIT</button>}
      {renaming && (
        <div style={{ position: "fixed", inset: 0, height: "100dvh", background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div className="t3d-card" role="dialog" aria-modal="true" aria-labelledby="rename-habit-title" style={{ width: "100%", maxWidth: 360 }}>
            <h2 id="rename-habit-title" className="t3d-ctitle" style={{ color: NEON }}>RENAME HABIT</h2>
            <input className="t3d-input" autoFocus aria-label="Habit name" value={renaming.name} onChange={event => { const name = event.target.value; setRenaming(value => ({ ...value, name })); }} onKeyDown={event => event.key === "Enter" && renameHabit()} />
            {renameTaken && <div role="alert" style={{ fontSize: 10, color: "#FFB547", marginTop: 6 }}>You already have a habit with that name.</div>}
            <div style={{ fontSize: 10, color: "#6F8792", marginTop: 6 }}>Its streak and today&apos;s tick stay as they are.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, borderColor: BORDER, color: "#8AABB8" }} onClick={() => setRenaming(null)}>CANCEL</button>
              <button className="t3d-btn" style={{ flex: 1 }} disabled={!renaming.name.trim() || renameTaken} onClick={renameHabit}>SAVE NAME</button>
            </div>
          </div>
        </div>
      )}
      {adding && (
        <div style={{ position: "fixed", inset: 0, height: "100dvh", background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div className="t3d-card" style={{ width: "100%", maxWidth: 360 }}>
            <h2 className="t3d-ctitle" style={{ color: NEON }}>ADD A DAILY HABIT</h2>
            <input className="t3d-input" autoFocus placeholder="What do you want to do each day?" value={newHabit.name} onChange={event => setNewHabit(value => ({ ...value, name: event.target.value }))} onKeyDown={event => event.key === "Enter" && addHabit()} />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, borderColor: BORDER, color: "#8AABB8" }} onClick={() => setAdding(false)}>CANCEL</button>
              <button className="t3d-btn" style={{ flex: 1 }} disabled={!newHabit.name.trim()} onClick={() => addHabit()}>ADD HABIT</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Achievements (badges) ───────────────────────────────────────────────────
// Badges are worked out from the user's history (lib/achievements.js). Which
// ones this device has already announced is kept locally, only so a badge is
// announced once; the badges themselves always come from the data.
async function fetchAchievements(user) {
  const [workouts, checkins, completions, nutrition, plan, split] = await Promise.all([
    supabase.from("workout_logs").select("date,created_at,in_progress,total_volume,duration_mins,exercises").eq("user_id", user.id).eq("in_progress", false).order("date", { ascending: true }).limit(2000),
    supabase.from("morning_checkins").select("date,score,data").eq("user_id", user.id).order("date", { ascending: true }).limit(2000),
    supabase.from("habit_completions").select("habit_id,date").eq("user_id", user.id).limit(10000),
    supabase.from("nutrition_logs").select("date,total_calories,total_protein,is_training_day").eq("user_id", user.id).limit(2000),
    readNutritionPlan(user.id),
    readWorkoutSplit(user.id),
  ]);
  const failed = [workouts, checkins, completions, nutrition].find(result => result.error);
  if (failed) throw new Error(failed.error.message);
  return computeAchievements({
    workouts: workouts.data || [], checkins: checkins.data || [], habitCompletions: completions.data || [], nutritionLogs: nutrition.data || [],
    nutritionPlan: plan.data || null, sessions: split.data?.sessions || [], planStartKey: split.data?.programme_started_at ? String(split.data.programme_started_at).slice(0, 10) : null,
  });
}
const badgesSeenKey = userId => `track3d-badges-seen-${userId}`;
const readSeenBadges = userId => { try { const value = JSON.parse(localStorage.getItem(badgesSeenKey(userId)) || "null"); return Array.isArray(value) ? value : null; } catch { return null; } };
const markBadgesSeen = (userId, ids) => {
  try { localStorage.setItem(badgesSeenKey(userId), JSON.stringify([...new Set([...(readSeenBadges(userId) || []), ...ids])])); } catch { /* storage unavailable */ }
};
const badgeDate = dateKey => new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

function BadgeTile({ badge }) {
  const { current, target, unit } = badge.progress;
  return (
    <div data-testid={`badge-${badge.id}`} data-earned={badge.earned ? "true" : "false"} title={badge.description}
      style={{ padding: "12px 8px", borderRadius: 8, textAlign: "center", border: `1px solid ${badge.earned ? "rgba(255,210,63,.55)" : BORDER}`, background: badge.earned ? "linear-gradient(160deg, rgba(255,210,63,.12), rgba(0,255,178,.04))" : SURFACE2 }}>
      <div aria-hidden="true" style={{ fontSize: 26, lineHeight: 1, filter: badge.earned ? "none" : "grayscale(1)", opacity: badge.earned ? 1 : 0.35 }}>{badge.icon}</div>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, letterSpacing: 1, color: badge.earned ? "#FFD23F" : "#8AABB8", marginTop: 8, lineHeight: 1.4 }}>{badge.title}</div>
      <div style={{ fontSize: 9, color: "#8AABB8", marginTop: 4, lineHeight: 1.4 }}>{badge.description}</div>
      {badge.earned ? (
        <div style={{ fontSize: 9, color: NEON, marginTop: 6 }}>Earned {badgeDate(badge.earnedOn)}</div>
      ) : (
        <div style={{ marginTop: 6 }}>
          <div role="progressbar" aria-label={`${badge.title} progress`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={current} style={{ height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (current / target) * 100)}%`, background: NEON2 }} />
          </div>
          <div style={{ fontSize: 8, color: "#6F8792", marginTop: 4 }}>{current.toLocaleString("en-GB")}{unit ? ` ${unit}` : ""} / {target.toLocaleString("en-GB")}{unit ? ` ${unit}` : ""}</div>
        </div>
      )}
    </div>
  );
}

// Profile → Achievements: every badge, earned first within each group.
function AchievementsSection({ user }) {
  const [badges, setBadges] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    fetchAchievements(user).then(list => { setBadges(list); markBadgesSeen(user.id, list.filter(badge => badge.earned).map(badge => badge.id)); })
      .catch(() => setError("Your achievements couldn't be loaded right now."));
  }, [user]);
  const earned = badges?.filter(badge => badge.earned).length || 0;
  return (
    <section data-testid="achievements" aria-labelledby="achievements-title" style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h2 id="achievements-title" className="t3d-ctitle" style={{ margin: 0 }}>ACHIEVEMENTS</h2>
        {badges && <span style={{ fontSize: 10, color: "#FFD23F" }}>{earned} of {badges.length} earned</span>}
      </div>
      {error ? <div role="alert" style={{ fontSize: 11, color: "#FFB547" }}>{error}</div>
        : !badges ? <div style={{ fontSize: 11, color: "#8AABB8" }}>Loading your badges...</div>
          : ACHIEVEMENT_CATEGORIES.map(category => {
            const group = badges.filter(badge => badge.category === category.id).sort((a, b) => Number(b.earned) - Number(a.earned));
            return (
              <div key={category.id} style={{ marginBottom: 14 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 9, fontWeight: 600, letterSpacing: 2, color: "#6F8792" }}>{category.label.toUpperCase()}</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {group.map(badge => <BadgeTile key={badge.id} badge={badge} />)}
                </div>
              </div>
            );
          })}
    </section>
  );
}

// The badges just earned, as a celebration line (workout complete, dashboard).
function NewBadgesNotice({ badges, onSeeAll, onDismiss }) {
  if (!badges.length) return null;
  return (
    <div data-testid="new-badges" role="status" style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 8, border: "1px solid rgba(255,210,63,.6)", background: "linear-gradient(160deg, rgba(255,210,63,.14), rgba(255,140,0,.04))", textAlign: "left" }}>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#FFD23F", letterSpacing: 2, marginBottom: 8 }}>{badges.length === 1 ? "NEW BADGE UNLOCKED" : `${badges.length} NEW BADGES UNLOCKED`}</div>
      {badges.map(badge => (
        <div key={badge.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
          <span aria-hidden="true" style={{ fontSize: 22 }}>{badge.icon}</span>
          <span style={{ fontSize: 12, color: "#E0EAF0" }}><strong style={{ color: "#FFD23F", fontWeight: 600 }}>{badge.title}</strong> · {badge.description}</span>
        </div>
      ))}
      {(onSeeAll || onDismiss) && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {onSeeAll && <button type="button" className="t3d-btn t3d-btn-sm" style={{ borderColor: "#FFD23F", color: "#FFD23F" }} onClick={onSeeAll}>SEE ALL BADGES</button>}
          {onDismiss && <button type="button" className="t3d-btn t3d-btn-sm" style={{ borderColor: BORDER, color: "#8AABB8" }} onClick={onDismiss}>DISMISS</button>}
        </div>
      )}
    </div>
  );
}

// ─── Account (Profile → Account) ─────────────────────────────────────────────
// Health data consent (with withdrawal), Download my data (a ZIP with one
// JSON file per table and the progress photos, once a day) and Delete my
// account (password, then type DELETE). Photos are removed through storage
// first, then delete_my_account() removes every row and the sign-in account.
const PHOTO_BUCKET = "checkin-photos";
const needsDatabaseUpdate = error => /function|schema cache|PGRST202|does not exist/i.test(`${error?.message || ""} ${error?.code || ""}`);
const formatConsentDate = (iso, timeZone) => new Date(iso).toLocaleDateString("en-GB", { ...(timeZone ? { timeZone } : {}), day: "numeric", month: "long", year: "numeric" });

function AccountSection({ user, consent = null, timeZone, onWithdrawConsent = null, onDeleted }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  // An export fetched but not saved as a ZIP can be tried again without
  // using up the day's download.
  const unsavedExportRef = useRef(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");

  const downloadData = async () => {
    if (downloading || !user) return;
    setDownloading(true);
    setDownloadStatus("Preparing your download...");
    try {
      let data = unsavedExportRef.current;
      if (!data) {
        const result = await supabase.rpc("export_my_data");
        if (result.error) {
          console.error("Export error:", result.error.message);
          setDownloadStatus(needsDatabaseUpdate(result.error) ? "Downloading your data needs a database update first." : `Couldn't prepare your download (${result.error.message}). Please try again.`);
          return;
        }
        if (result.data?.error === "export_limit") { setDownloadStatus(exportLimitText(result.data.available_at, timeZone)); return; }
        if (result.data?.error || !result.data?.tables) { setDownloadStatus("Please sign in again, then try again."); return; }
        data = result.data;
        unsavedExportRef.current = data;
      }
      const bucket = supabase.storage.from(PHOTO_BUCKET);
      const photos = [];
      const missingPhotos = [];
      let paths = [];
      try { paths = await listUserFiles(bucket, user.id); } catch (error) { missingPhotos.push({ path: `${user.id}/`, error: `the list of photos couldn't be read (${error.message})` }); }
      for (const [index, path] of paths.entries()) {
        setDownloadStatus(`Adding your photos (${index + 1} of ${paths.length})...`);
        const { data: blob, error } = await bucket.download(path);
        if (error || !blob) missingPhotos.push({ path, error: error?.message || "not found" });
        else photos.push({ path, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      const fileName = exportFileName();
      const zip = createZip(exportFiles({ data, photos, missingPhotos, userId: user.id }));
      const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      unsavedExportRef.current = null;
      const tableCount = Object.keys(data.tables).length;
      setDownloadStatus(`Downloaded ${fileName}: ${tableCount} table${tableCount === 1 ? "" : "s"} and ${photos.length} photo${photos.length === 1 ? "" : "s"}.${missingPhotos.length ? ` ${missingPhotos.length} photo${missingPhotos.length === 1 ? "" : "s"} couldn't be added (listed in the download).` : ""}`);
    } catch (error) {
      console.error("Export error:", error);
      setDownloadStatus(`Couldn't prepare your download (${error?.message || "connection problem"}). Please try again.`);
    } finally {
      setDownloading(false);
    }
  };

  const deleteAccount = async () => {
    if (deleting || !user || !password || confirmText !== "DELETE") return;
    setDeleting(true);
    const fail = text => { setDeleteStatus(text); setDeleting(false); };
    try {
      // The password is checked before anything is deleted.
      setDeleteStatus("Checking your password...");
      const check = await supabase.rpc("delete_my_account", { p_password: password, p_check_only: true });
      if (check.error || check.data !== "ok") {
        if (check.error) console.error("Delete account error:", check.error.message);
        return fail(deleteAccountProblem(check.data, check.error) || "Couldn't check your password. Nothing has been deleted.");
      }
      setDeleteStatus("Deleting your progress photos...");
      const bucket = supabase.storage.from(PHOTO_BUCKET);
      try {
        await removeFiles(bucket, await listUserFiles(bucket, user.id));
      } catch (error) {
        return fail(`Couldn't delete all your progress photos (${error.message}). Your account and the rest of your data haven't been deleted. Please try again.`);
      }
      setDeleteStatus("Deleting your account and data...");
      const result = await supabase.rpc("delete_my_account", { p_password: password, p_check_only: false });
      if (result.error || result.data !== "deleted") {
        if (result.error) console.error("Delete account error:", result.error.message);
        return fail(deleteAccountProblem(result.data, result.error) || "Couldn't delete your account. Please try again.");
      }
      setDeleteStatus("Deleted. Signing you out...");
      await onDeleted();
    } catch (error) {
      fail(`Couldn't delete your account (${error?.message || "connection problem"}). Please try again.`);
    }
  };

  const withdraw = async () => {
    if (withdrawing || !onWithdrawConsent) return;
    setWithdrawing(true);
    setWithdrawError("");
    const error = await onWithdrawConsent();
    setWithdrawing(false);
    if (error) setWithdrawError(error);
    else setWithdrawOpen(false);
  };

  const sectionTitle = { fontSize: 9, color: "#E0EAF0", letterSpacing: 1, marginBottom: 6 };
  const note = { fontSize: 10, color: "#8AABB8", lineHeight: 1.55, marginBottom: 8 };
  return (
    <div data-testid="account-section" style={{ borderTop: `1px solid ${BORDER}`, marginTop: 14, paddingTop: 14 }}>
      <div className="t3d-ctitle" style={{ marginBottom: 4 }}>ACCOUNT</div>
      {user?.email && <div style={note}>Signed in as {user.email}</div>}

      {consent?.given && onWithdrawConsent && (
        <div data-testid="account-consent" style={{ marginBottom: 14 }}>
          <div style={sectionTitle}>HEALTH DATA CONSENT</div>
          <div style={note}>You agreed on {formatConsentDate(consent.at, timeZone)} to TRACK3D storing your health information (weight, body photos, food, training) to coach you. Privacy notice version {consent.version}.</div>
          {!withdrawOpen ? (
            <button type="button" className="t3d-btn t3d-btn-sm" onClick={() => setWithdrawOpen(true)}>WITHDRAW CONSENT</button>
          ) : (
            <div role="group" aria-label="Withdraw consent" style={{ padding: 10, border: "1px solid rgba(255,181,71,.4)", borderRadius: 6 }}>
              <div style={{ ...note, color: "#FFD08A" }}>TRACK3D will stop using your health information, and you&apos;ll need to agree again before you can use the app. To erase what&apos;s already stored, delete your account below.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="t3d-btn t3d-btn-sm" style={{ borderColor: "#FFB547", color: "#FFB547" }} disabled={withdrawing} onClick={withdraw}>{withdrawing ? "WITHDRAWING..." : "WITHDRAW MY CONSENT"}</button>
                <button type="button" className="t3d-btn t3d-btn-sm" disabled={withdrawing} onClick={() => { setWithdrawOpen(false); setWithdrawError(""); }}>CANCEL</button>
              </div>
              {withdrawError && <div role="alert" style={{ fontSize: 10, color: NEON3, marginTop: 8 }}>{withdrawError}</div>}
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={sectionTitle}>DOWNLOAD MY DATA</div>
        <div style={note}>A ZIP file with everything stored for your account: one JSON file per table (morning check-ins, workouts, nutrition, habits, your profile and the rest) and your progress photos. You can download it once a day.</div>
        <button type="button" className="t3d-btn t3d-btn-sm" data-testid="download-my-data" disabled={downloading} onClick={downloadData}>{downloading ? "PREPARING..." : "DOWNLOAD MY DATA"}</button>
        {downloadStatus && <div role="status" data-testid="download-status" style={{ fontSize: 10, color: "#C5D6DC", lineHeight: 1.5, marginTop: 8 }}>{downloadStatus}</div>}
      </div>

      <div>
        <div style={sectionTitle}>DELETE MY ACCOUNT</div>
        <div style={note}>Permanently deletes your account and everything in it: check-ins, workouts, nutrition, habits, coach history, your profile and your progress photos. This can&apos;t be undone. Copies in our hosting provider&apos;s backups are deleted automatically within 30 days.</div>
        {!deleteOpen ? (
          <button type="button" className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => { setDeleteOpen(true); setDeleteStatus(""); }}>DELETE MY ACCOUNT</button>
        ) : (
          <form data-testid="delete-account-form" onSubmit={event => { event.preventDefault(); deleteAccount(); }} style={{ padding: 10, border: `1px solid ${NEON3}`, borderRadius: 6 }}>
            <label style={{ display: "block", fontSize: 9, color: "#E0EAF0", letterSpacing: 1, marginBottom: 8 }}>YOUR PASSWORD
              <input className="t3d-input" type="password" autoComplete="current-password" aria-label="Your password" value={password} onChange={event => setPassword(event.target.value)} style={{ marginTop: 5 }} />
            </label>
            <label style={{ display: "block", fontSize: 9, color: "#E0EAF0", letterSpacing: 1, marginBottom: 8 }}>TYPE DELETE TO CONFIRM
              <input className="t3d-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label="Type DELETE to confirm" placeholder="DELETE" value={confirmText} onChange={event => setConfirmText(event.target.value)} style={{ marginTop: 5 }} />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" className="t3d-btn t3d-btn-sm t3d-btn-red" disabled={deleting || !password || confirmText !== "DELETE"}>{deleting ? "DELETING..." : "DELETE MY ACCOUNT FOREVER"}</button>
              <button type="button" className="t3d-btn t3d-btn-sm" disabled={deleting} onClick={() => { setDeleteOpen(false); setPassword(""); setConfirmText(""); setDeleteStatus(""); }}>CANCEL</button>
            </div>
            {deleteStatus && <div role="status" data-testid="delete-status" style={{ fontSize: 10, color: deleting ? "#C5D6DC" : NEON3, lineHeight: 1.5, marginTop: 8 }}>{deleteStatus}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

// Shown instead of the app until the user has agreed to TRACK3D storing
// their health information: existing users once, at their next visit, and
// anyone who withdrew consent or when the wording changes.
function HealthConsentGate({ user, consent, timeZone, onAgree, onSignOut, onDeleted }) {
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const agree = async () => {
    if (!ticked || saving) return;
    setSaving(true);
    setError("");
    const problem = await onAgree();
    if (problem) { setError(problem); setSaving(false); }
  };
  const intro = consent?.reason === "withdrawn"
    ? `You withdrew your consent${consent.withdrawnAt ? ` on ${formatConsentDate(consent.withdrawnAt, timeZone)}` : ""}, so TRACK3D isn't using your health information. To use the app again, agree below.`
    : consent?.reason === "new_version"
      ? "We've updated how we look after your health information. Please read the Privacy Notice and agree again to keep using TRACK3D."
      : "Before you carry on, we need your permission for something.";
  return (
    <>
      <style>{css}</style>
      <div className="t3d" style={{ display: "block" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px" }}>
          <div className="t3d-card" role="dialog" aria-modal="true" aria-labelledby="consent-title" data-testid="consent-gate">
            <div id="consent-title" className="t3d-ctitle" style={{ marginBottom: 8 }}>YOUR HEALTH INFORMATION</div>
            <p style={{ fontSize: 12, color: "#E0EAF0", lineHeight: 1.6, margin: "0 0 10px" }}>{intro}</p>
            <p style={{ fontSize: 12, color: "#C5D6DC", lineHeight: 1.6, margin: "0 0 10px" }}>TRACK3D stores health information about you, including your weight, body photos, food and training, so it can coach you. UK data protection law treats this as special category data, so we only store it with your explicit consent. You can withdraw your consent at any time in Profile → Account. The <a href="/privacy#health-data" target="_blank" rel="noreferrer" style={{ color: NEON }}>Privacy Notice</a> explains how it&apos;s used and protected.</p>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#E0EAF0", lineHeight: 1.5, padding: 12, border: `1px solid ${BORDER}`, borderRadius: 6, margin: "14px 0", cursor: "pointer" }}>
              <input type="checkbox" data-testid="health-consent-checkbox" checked={ticked} onChange={event => setTicked(event.target.checked)} style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }} />
              <span>{HEALTH_CONSENT_TEXT}</span>
            </label>
            {error && <div role="alert" style={{ fontSize: 11, color: NEON3, marginBottom: 10 }}>{error}</div>}
            <button type="button" className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={!ticked || saving} onClick={agree}>{saving ? "SAVING..." : "AGREE AND CONTINUE"}</button>
            <div style={{ fontSize: 11, color: "#8AABB8", lineHeight: 1.6, marginTop: 16 }}>Don&apos;t want to agree? You can&apos;t use TRACK3D without it, but you can sign out, download your data or delete your account.</div>
            <button type="button" className="t3d-btn t3d-btn-sm" style={{ marginTop: 10 }} onClick={onSignOut}>SIGN OUT</button>
            <AccountSection user={user} consent={consent} timeZone={timeZone} onDeleted={onDeleted} />
          </div>
        </main>
      </div>
    </>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [activeSessions, setActiveSessions] = useState({});
  const [draftError, setDraftError] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [habits, setHabits] = useState(INITIAL_HABITS);
  const [habitsReady, setHabitsReady] = useState(false);
  const prevHabitsRef = useRef(null); // last-persisted snapshot, for diffing what changed
  const pendingHabitDeletesRef = useRef(new Set()); // removed habits whose delete has not succeeded yet
  const [habitSaveError, setHabitSaveError] = useState("");
  const [fitnessSessions, setFitnessSessions] = useState([]);
  // Height, date of birth, sex and training experience: the dashboard to-do
  // and the header PROFILE button both edit it.
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // Health data consent (healthConsentStatus): null until the profile has
  // loaded. Without it the consent screen is shown instead of the app.
  const [consent, setConsent] = useState(null);
  const consentGiven = Boolean(consent?.given);
  // Set once the account is deleted, so signing out leaves the redirect to
  // accountDeleted(), which says the account was deleted.
  const accountDeletedRef = useRef(false);
  // A short confirmation under the header ("Profile saved ✓").
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const profileSaved = saved => { setProfile(saved); setNotice("Profile saved ✓"); };
  // What each active session is up to, for the banner ("Upper A · Set 2 of 4 · Bench Press").
  const [activeSummaries, setActiveSummaries] = useState({});
  const homeTimeZone = resolveHomeTimeZone(user);
  const todayLabel = new Date().toLocaleDateString("en-US", { timeZone: homeTimeZone, weekday: "long", month: "long", day: "numeric" });
  const todayKey = getZonedDateInfo(new Date(), homeTimeZone).dateKey;

  // Load habit definitions + today's ticks from Supabase. localStorage is
  // kept only as an offline fallback if that read fails.
  useEffect(() => {
    // Nothing is loaded until the user has agreed to health data storage.
    if (!user || !consentGiven) return;
    let cancelled = false;
    setHabitsReady(false);
    (async () => {
      let loaded = [];
      try {
        // Completion history (up to a year) gives each habit's real streak.
        // Both reads start together and share the weekly report's identical reads.
        const [{ data: defs, error: defsError }, { data: completions, error: compError }] = await Promise.all([
          readHabits(user.id),
          readHabitCompletions(user.id, shiftDateKey(todayKey, -366), todayKey),
        ]);
        if (defsError) throw defsError;
        if (compError) throw compError;
        const datesByHabit = new Map();
        (completions || []).forEach(c => datesByHabit.set(String(c.habit_id), [...(datesByHabit.get(String(c.habit_id)) || []), c.date]));
        loaded = (defs || []).map(h => {
          const dates = datesByHabit.get(String(h.id)) || [];
          return { id: h.id, name: h.name, category: h.category || "daily", streakBeforeToday: streakBeforeToday(dates, todayKey), done: dates.includes(todayKey) };
        });
      } catch (e) {
        console.log("Habit load error:", e);
        if (!cancelled) setHabitSaveError(`Your habits could not be loaded from your account (${e?.message || "connection problem"}). Changes may not be saved.`);
        try {
          const savedDefinitions = JSON.parse(localStorage.getItem(`track3d_habits_${user.id}`) || "[]");
          const savedToday = JSON.parse(localStorage.getItem(`track3d_habit_status_${user.id}_${todayKey}`) || "{}");
          loaded = savedDefinitions.map(habit => ({ ...habit, id: String(habit.id), done: Boolean(savedToday[habit.id]) }));
        } catch { loaded = []; }
      }
      if (cancelled) return;
      prevHabitsRef.current = loaded; // nothing to persist yet - this IS what's saved
      setHabits(loaded);
      setHabitsReady(true);
    })();
    return () => { cancelled = true; };
  }, [user?.id, todayKey, consentGiven]);

  const deleteHabitRow = id => supabase.from("habits").delete().eq("user_id", user.id).eq("id", id)
    .then(result => { if (!result.error) pendingHabitDeletesRef.current.delete(id); return result; });

  // Mini-save: persist only what actually changed since the last render -
  // a new/renamed habit, a removed one, or today's tick/untick - the moment
  // it happens, rather than waiting for any kind of final submission.
  useEffect(() => {
    if (!user || !habitsReady) return;
    localStorage.setItem(`track3d_habits_${user.id}`, JSON.stringify(habits.map(({ done, ...habit }) => habit)));
    localStorage.setItem(`track3d_habit_status_${user.id}_${todayKey}`, JSON.stringify(Object.fromEntries(habits.map(habit => [habit.id, Boolean(habit.done)]))));

    const previous = prevHabitsRef.current || [];
    const currentIds = new Set(habits.map(h => h.id));
    const writes = [];

    previous.filter(h => !currentIds.has(h.id)).forEach(h => pendingHabitDeletesRef.current.add(String(h.id)));
    // A habit that was added back is no longer waiting to be deleted.
    habits.forEach(h => pendingHabitDeletesRef.current.delete(String(h.id)));
    previous.filter(h => !currentIds.has(h.id)).forEach(h => writes.push(deleteHabitRow(String(h.id))));

    habits.forEach(h => {
      const prevMatch = previous.find(p => p.id === h.id);
      if (!prevMatch || prevMatch.name !== h.name || prevMatch.category !== h.category) {
        writes.push(supabase.from("habits").upsert({
          id: String(h.id), user_id: user.id, name: h.name, category: h.category || "daily",
          streak: habitStreak(h), updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,id" }));
      }
      if (!prevMatch || Boolean(prevMatch.done) !== Boolean(h.done)) {
        writes.push(h.done
          ? supabase.from("habit_completions").upsert({
            user_id: user.id, habit_id: String(h.id), date: todayKey, done: true, updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,habit_id,date" })
          : supabase.from("habit_completions").delete()
            .eq("user_id", user.id).eq("habit_id", String(h.id)).eq("date", todayKey));
      }
    });

    prevHabitsRef.current = habits;
    // Show any failure instead of only logging it, so unsaved habits are never silent.
    Promise.all(writes).then(results => {
      const failed = results.find(result => result.error);
      if (failed) {
        console.log("Habit save error:", failed.error);
        setHabitSaveError(`Your habits could not be saved: ${failed.error.message}`);
      }
    }).catch(error => setHabitSaveError(`Your habits could not be saved: ${error?.message || "connection problem"}`));
  }, [habits, habitsReady, todayKey, user?.id]);

  // Re-send every habit, today's ticks and any delete that failed.
  const retryHabitSave = async () => {
    if (!user) return;
    setHabitSaveError("");
    const results = await Promise.all([
      ...[...pendingHabitDeletesRef.current].map(deleteHabitRow),
      ...habits.map(h => supabase.from("habits").upsert({
        id: String(h.id), user_id: user.id, name: h.name, category: h.category || "daily",
        streak: habitStreak(h), updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,id" })),
      ...habits.map(h => h.done
        ? supabase.from("habit_completions").upsert({ user_id: user.id, habit_id: String(h.id), date: todayKey, done: true, updated_at: new Date().toISOString() }, { onConflict: "user_id,habit_id,date" })
        : supabase.from("habit_completions").delete().eq("user_id", user.id).eq("habit_id", String(h.id)).eq("date", todayKey)),
    ]).catch(error => [{ error }]);
    const failed = results.find(result => result.error);
    if (failed) setHabitSaveError(`Your habits could not be saved: ${failed.error?.message || "connection problem"}`);
  };

  useEffect(() => {
    if (!user || !consentGiven) return;
    readWorkoutSplit(user.id)
      .then(({ data }) => { if (data?.sessions) setFitnessSessions(data.sessions); });
  }, [user, consentGiven]);

  useEffect(() => {
    let cancelled = false;
    let recovering = false;
    let expiryTimer;
    let retryTimer;
    let expiring = false;
    let leaving = false;
    // To the sign-in page once, however the sign-out arrives: a second move
    // would cut the first one short.
    const toLogin = () => {
      if (leaving) return;
      leaving = true;
      window.location.replace("/login");
    };
    const expire = async () => {
      if (expiring) return;
      expiring = true;
      clearLoginWindow();
      await supabase.auth.signOut({ scope: "local" });
      if (!cancelled) toLogin();
    };
    // Browsers run a timer of more than about 24 days at once, so a long
    // sign-in window is checked again at least once a day.
    const scheduleExpiry = expiresAt => {
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => (Date.now() >= expiresAt ? void expire() : scheduleExpiry(expiresAt)), Math.min(expiresAt - Date.now(), 24 * 60 * 60 * 1000));
    };
    const accept = session => {
      if (cancelled) return;
      if (!session) { toLogin(); return; }
      const expiresAt = loginWindowExpiry(session.user.id) ?? beginLoginWindow(session.user.id);
      if (expiresAt <= Date.now()) { void expire(); return; }
      scheduleExpiry(expiresAt);
      setUser(previous => previous?.id === session.user.id ? previous : session.user);
      setAuthError("");
      setAuthLoading(false);
    };
    const recover = async () => {
      if (cancelled || recovering || document.visibilityState === "hidden") return;
      recovering = true;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) throw error;
        accept(data.session);
      } catch {
        if (!cancelled) {
          setAuthError("Reconnecting to your account. Your active session is kept on this browser.");
          clearTimeout(retryTimer);
          retryTimer = setTimeout(recover, 5000);
        }
      } finally { recovering = false; }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      // Defer work out of Supabase's auth callback/lock.
      if (event === "SIGNED_OUT") {
        clearLoginWindow();
        // After Delete my account, accountDeleted() goes to the sign-in page itself.
        if (!accountDeletedRef.current) toLogin();
      } else if (session) {
        setTimeout(() => accept(session), 0);
      }
    });
    void recover();
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      cancelled = true;
      clearTimeout(expiryTimer);
      clearTimeout(retryTimer);
      subscription.unsubscribe();
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, []);

  useEffect(() => {
    const active = event => {
      if (event.detail.userId === user?.id) {
        setActiveSessions(previous => ({ ...previous, [event.detail.kind]: event.detail.active }));
        setActiveSummaries(previous => ({ ...previous, [event.detail.kind]: event.detail.summary || "" }));
      }
    };
    const failed = event => { if (event.detail.userId === user?.id) setDraftError(true); };
    // A finished morning task ticks the habit that is the same thing.
    const taskDone = event => {
      setHabits(current => {
        const ids = linkedHabitIds(event.detail?.name, current);
        return ids.length ? current.map(habit => (ids.includes(habit.id) ? { ...habit, done: true } : habit)) : current;
      });
    };
    window.addEventListener("track3d-active-session", active);
    window.addEventListener("track3d-draft-error", failed);
    window.addEventListener("track3d-task-done", taskDone);
    return () => {
      window.removeEventListener("track3d-active-session", active);
      window.removeEventListener("track3d-draft-error", failed);
      window.removeEventListener("track3d-task-done", taskDone);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id) { setProfile(null); setConsent(null); return; }
    let cancelled = false;
    Promise.all([
      readUserProfile(user.id),
      readCoachProfile(user.id),
    ]).then(([row, coach]) => {
      if (cancelled) return;
      setProfile({ ...normaliseProfile(row.data, coach.data?.experience_level), personality: coach.data?.personality || "balanced" });
      const status = healthConsentStatus({ profileRow: row.data, metadata: user.user_metadata });
      setConsent(status);
      // Consent ticked at sign-up (or given while the profile couldn't be
      // written) is copied to the profile, keeping when it was given.
      if (status.given && !status.onProfile && !row.error) {
        supabase.from("user_profiles").upsert({ user_id: user.id, health_consent_at: status.at, health_consent_version: status.version, health_consent_withdrawn_at: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
          .then(({ error }) => { if (error) console.log("Consent copy error:", error.message); });
      }
    }).catch(error => {
      // Without the profile, consent given at sign-up still counts.
      console.log("Profile load error:", error?.message || error);
      if (!cancelled) setConsent(healthConsentStatus({ metadata: user.user_metadata }));
    });
    return () => { cancelled = true; };
    // The user object only changes when a different user signs in.
  }, [user]);

  // Consent given (true) or withdrawn (false): recorded on the profile by
  // the database, and on the sign-in account. Returns an error message, or
  // "" when it was recorded.
  const recordConsent = async given => {
    const { data: stamp, error } = await supabase.rpc("set_health_consent", { p_version: HEALTH_CONSENT_VERSION, p_given: given });
    if (error) console.log("Consent save error:", error.message);
    const at = (!error && stamp) || new Date().toISOString();
    const { error: accountError } = await supabase.auth.updateUser({ data: given
      ? { health_consent_at: at, health_consent_version: HEALTH_CONSENT_VERSION, health_consent_withdrawn_at: null }
      : { health_consent_withdrawn_at: at } });
    if (accountError) console.log("Consent account save error:", accountError.message);
    if (error && accountError) return `Couldn't save your choice (${accountError.message || error.message}). Please try again.`;
    setConsent(given
      ? { given: true, reason: "given", at, version: HEALTH_CONSENT_VERSION, withdrawnAt: null, onProfile: !error }
      : { given: false, reason: "withdrawn", at: consent?.at || null, version: consent?.version || null, withdrawnAt: at, onProfile: false });
    if (!given) setProfileOpen(false);
    return "";
  };

  // Coach chats can hold health details, so they don't stay on the device after signing out.
  const signOut = async () => {
    clearLoginWindow();
    try { Object.keys(localStorage).filter(key => key.startsWith("track3d-coach-")).forEach(key => localStorage.removeItem(key)); } catch { /* storage unavailable */ }
    await supabase.auth.signOut({ scope: "local" });
    window.location.replace("/login");
  };

  // After Delete my account: nothing of the account is left in this browser.
  const accountDeleted = async () => {
    accountDeletedRef.current = true;
    clearLoginWindow();
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* the stored session is removed below */ }
    clearLocalAppData();
    window.location.replace("/login?deleted=1");
  };

  if (authLoading || !user || !consent) return (
    <div style={{ minHeight: "100vh", background: "#080C10", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Orbitron',monospace", color: "#00FFB2", letterSpacing: 4, fontSize: 12 }}>
      {authError || "LOADING..."}
    </div>
  );
  if (!consent.given) return <HealthConsentGate user={user} consent={consent} timeZone={homeTimeZone} onAgree={() => recordConsent(true)} onSignOut={signOut} onDeleted={accountDeleted} />;

  const nav = [
    { id: "dashboard", icon: "◈", label: "DASHBOARD" },
    { id: "morning", icon: "🌅", label: "MORNING" },
    { id: "fitness", icon: "⚡", label: "FITNESS" },
    { id: "nutrition", icon: "◎", label: "NUTRITION" },
    { id: "habits", icon: "◇", label: "HABITS" },
  ];

  const titles = { dashboard: "DASHBOARD", morning: "MORNING", fitness: "FITNESS", nutrition: "NUTRITION", habits: "HABITS" };
  // Active sessions by tab (today's morning draft is "morning-<date>").
  const activeBanners = Object.entries(activeSessions).filter(([, active]) => active).reduce((list, [kind]) => {
    const bannerTab = kind.startsWith("morning") ? "morning" : kind;
    return list.some(banner => banner.tab === bannerTab) ? list : [...list, { tab: bannerTab, summary: activeSummaries[kind] || "" }];
  }, []);

  return (
    <>
      <style>{css}</style>
      <div className="t3d">
        <nav className="t3d-sidebar">
          <div className="t3d-logo">TRACK3D<small>Awareness. Strategy. Action. Results.</small></div>
          {nav.map(n => (
            <button type="button" key={n.id} className={`t3d-nav ${tab===n.id?"on":""}`} aria-current={tab === n.id ? "page" : undefined} onClick={() => setTab(n.id)}>
              <span className="t3d-nav-icon" aria-hidden="true">{n.icon}</span>{n.label}
            </button>
          ))}
          <div className="t3d-sfooter">
            <span style={{ color: "#1A2530" }}>v1.0 · TRACK3D</span><br />
            <a href="/privacy" style={{ color: "#6F8792", textDecoration: "underline" }}>PRIVACY</a>
            <span style={{ color: "#334650" }}> · </span>
            <a href="/terms" style={{ color: "#6F8792", textDecoration: "underline" }}>TERMS</a>
          </div>
        </nav>

        <main className="t3d-main">
          <div className="t3d-header">
            <div>
              <h1 className="t3d-title">{titles[tab]}</h1>
              <div className="t3d-date">{todayLabel.toUpperCase()}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 9, color: "#8AABB8", borderColor: BORDER, background: "transparent" }} onClick={() => setProfileOpen(true)}>
                PROFILE
              </button>
              <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 9, color: "#8AABB8", borderColor: BORDER, background: "transparent" }} onClick={signOut}>
                SIGN OUT
              </button>
            </div>
          </div>

          {authError && <p role="status" style={{ color: "#FFB547", fontSize: 12 }}>{authError}</p>}
          {draftError && <p role="alert" style={{ color: "#FFB547", fontSize: 12 }}>This browser could not save your progress. Keep this page open until you finish.</p>}
          {habitSaveError && (tab === "dashboard" || tab === "habits") && (
            <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14, padding: 12, border: `1px solid ${NEON3}`, borderRadius: 7, background: "rgba(255,45,120,.07)", color: "#FF8AAD", fontSize: 12 }}>
              <span style={{ flex: 1 }}>{habitSaveError}</span>
              <button type="button" className="t3d-btn t3d-btn-sm" style={{ minHeight: 44 }} onClick={retryHabitSave}>RETRY</button>
            </div>
          )}
          {notice && <div role="status" data-testid="app-notice" style={{ marginBottom: 14, padding: "10px 12px", border: `1px solid ${NEON}`, borderRadius: 7, background: "rgba(0,255,178,.08)", color: NEON, fontSize: 12 }}>{notice}</div>}
          {/* One place to continue an active workout or morning: what it is up to, one tap back. */}
          {activeBanners.filter(banner => banner.tab !== tab).map(banner => (
            <button key={banner.tab} data-testid={`active-banner-${banner.tab}`} className="t3d-btn" onClick={() => setTab(banner.tab)}
              style={{ display: "block", width: "100%", marginBottom: 14, textAlign: "left", whiteSpace: "normal", padding: 14, borderColor: NEON, background: "rgba(0,255,178,.06)" }}>
              <span style={{ display: "block", fontSize: 9, color: NEON, letterSpacing: 1.5 }}>{banner.tab === "morning" ? "MORNING ROUTINE IN PROGRESS" : "WORKOUT IN PROGRESS"}</span>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 5 }}>
                <span style={{ color: "#E0EAF0", fontSize: 12, fontFamily: "'Inter',sans-serif", letterSpacing: 0, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{banner.summary || (banner.tab === "morning" ? "Your morning routine" : "Your workout")}</span>
                <span style={{ color: NEON, whiteSpace: "nowrap" }}>CONTINUE →</span>
              </span>
            </button>
          ))}
          {tab === "dashboard" && <Dashboard habits={habits} setHabits={setHabits} user={user} onNavigate={setTab} profile={profile} onProfileSaved={profileSaved} workoutBannerShown={activeBanners.some(banner => banner.tab === "fitness")} onOpenProfile={() => setProfileOpen(true)} />}
          <div hidden={tab !== "morning"}><MorningSection key={user?.id} user={user} /></div>
          <div hidden={tab !== "fitness"}><Fitness key={user?.id} user={user} isActive={tab === "fitness"} /></div>
          {tab === "nutrition" && <Nutrition user={user} userSessions={fitnessSessions} profile={profile} onProfileChange={setProfile} />}
          {tab === "habits" && <HabitsPage habits={habits} setHabits={setHabits} />}
        </main>

        {profileOpen && (
          <div onClick={() => setProfileOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, padding: 16 }}>
            <div role="dialog" aria-modal="true" aria-label="Your profile" data-testid="profile-dialog" onClick={event => event.stopPropagation()} className="t3d-card" style={{ width: "100%", maxWidth: 440, maxHeight: "90dvh", overflowY: "auto", marginBottom: 0 }}>
              <div className="t3d-ctitle" style={{ marginBottom: 4 }}>PROFILE &amp; COACH SETTINGS</div>
              {profile ? (
                <ProfileForm user={user} profile={profile} today={todayKey} onCancel={() => setProfileOpen(false)} onSaved={saved => { profileSaved(saved); setProfileOpen(false); }} />
              ) : <div style={{ fontSize: 11, color: "#8AABB8", padding: "10px 0" }}>Loading your profile...</div>}
              <AchievementsSection user={user} />
              <AccountSection user={user} consent={consent} timeZone={homeTimeZone} onWithdrawConsent={() => recordConsent(false)} onDeleted={accountDeleted} />
            </div>
          </div>
        )}

        {/* Mobile bottom navigation */}
        <nav className="t3d-bottom-nav">
          {nav.map(n => (
            <button key={n.id} className={`t3d-bnav-item ${tab===n.id?"on":""}`} aria-current={tab === n.id ? "page" : undefined} onClick={() => setTab(n.id)}>
              <span className="t3d-bnav-icon" aria-hidden="true">{n.icon}</span>
              {n.label.split(" ")[0]}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
