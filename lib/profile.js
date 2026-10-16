// The user's profile: height, date of birth and sex. Date of birth is kept
// (not age) so age stays right without updating it each birthday. Used to
// fill in the nutrition setup; filled in from the dashboard to-do.

export const PROFILE_SEX = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "prefer_not_to_say", label: "Prefer not to say" },
];

export const sexLabel = id => PROFILE_SEX.find(option => option.id === id)?.label || "";
export const sexId = label => PROFILE_SEX.find(option => option.label === label || option.id === label)?.id || null;

// Training experience lives in coach_profiles.experience_level and sets how
// much the coaches explain.
export const EXPERIENCE_CHOICES = [
  { id: "beginner", label: "Beginner", description: "Under a year of regular training" },
  { id: "intermediate", label: "Intermediate", description: "1–3 years of regular training" },
  { id: "advanced", label: "Advanced", description: "3+ years; technical terms are fine" },
];
const experienceId = value => (EXPERIENCE_CHOICES.some(choice => choice.id === value) ? value : null);

export const PREFER_NOT_TO_SAY_NOTE = "Prefer not to say: calorie targets use the average of the male and female results.";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Whole years between a YYYY-MM-DD date of birth and today's date key.
export function ageFromDateOfBirth(dateOfBirth, todayKey) {
  const born = DATE.exec(String(dateOfBirth || ""));
  const today = DATE.exec(String(todayKey || ""));
  if (!born || !today) return null;
  let age = Number(today[1]) - Number(born[1]);
  if (today[2] < born[2] || (today[2] === born[2] && today[3] < born[3])) age -= 1;
  return age >= 0 ? age : null;
}

export function formatDateOfBirth(dateOfBirth) {
  const born = DATE.exec(String(dateOfBirth || ""));
  if (!born) return "";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(born[2]) - 1];
  return `${Number(born[3])} ${month} ${born[1]}`;
}

// The weight steps the user's gym goes up in (kg), per kind of equipment
// (user_profiles.gym_steps). Only sensible numbers are kept.
export const GYM_STEP_CHOICES = {
  dumbbell: [1, 2, 2.5],
  barbell: [1.25, 2.5, 5],
  machine: [2.5, 5, 7],
  cable: [1.25, 2.5, 5],
  kettlebell: [2, 4],
};
export function normaliseGymSteps(value) {
  const steps = {};
  for (const key of Object.keys(GYM_STEP_CHOICES)) {
    const number = Number(value?.[key]);
    if (Number.isFinite(number) && number > 0 && number <= 20) steps[key] = Math.round(number * 100) / 100;
  }
  return steps;
}

// A user_profiles row (or nothing), plus the coach_profiles experience
// level, as { heightCm, dateOfBirth, sex, experienceLevel, gymSteps }.
export function normaliseProfile(row, experienceLevel = null) {
  return {
    heightCm: Number(row?.height_cm) > 0 ? Number(row.height_cm) : null,
    dateOfBirth: DATE.test(String(row?.date_of_birth || "")) ? String(row.date_of_birth) : null,
    sex: sexLabel(row?.sex) ? row.sex : null,
    experienceLevel: experienceId(experienceLevel),
    gymSteps: normaliseGymSteps(row?.gym_steps),
    stepGoal: Number(row?.step_goal) >= 1000 && Number(row?.step_goal) <= 30000 ? Math.round(Number(row.step_goal)) : null,
  };
}

export const isProfileComplete = profile => Boolean(profile?.heightCm && profile?.dateOfBirth && profile?.sex && profile?.experienceLevel);

// One height range for the profile and the nutrition setup.
export const HEIGHT_RANGE_CM = { min: 100, max: 250 };
export const HEIGHT_PROBLEM = `Enter your height in cm (${HEIGHT_RANGE_CM.min}–${HEIGHT_RANGE_CM.max}).`;
export const heightInRange = heightCm => Number(heightCm) >= HEIGHT_RANGE_CM.min && Number(heightCm) <= HEIGHT_RANGE_CM.max;

const filled = value => String(value ?? "").trim() !== "";

// The first problem with a profile form, or "" when it can be saved.
// With requireExperience, the training experience must be chosen too.
// With partial, empty fields are fine: only what is filled in is checked.
export function profileProblem({ heightCm, dateOfBirth, sex, experienceLevel } = {}, todayKey, { requireExperience = false, partial = false } = {}) {
  if (!(partial && !filled(heightCm)) && !heightInRange(heightCm)) return HEIGHT_PROBLEM;
  if (!(partial && !filled(dateOfBirth))) {
    const age = ageFromDateOfBirth(dateOfBirth, todayKey);
    if (age === null || String(dateOfBirth) > String(todayKey) || String(dateOfBirth) < "1900-01-01") return "Enter your date of birth.";
    if (age < 13) return "TRACK3D is for ages 13 and over.";
  }
  if (!(partial && !filled(sex)) && !sexId(sex)) return "Choose an option for sex.";
  if (requireExperience && !experienceId(experienceLevel)) return "Choose your training experience.";
  return "";
}

// What a profile form still needs for the profile to be complete, in words.
export function missingProfileFields({ heightCm, dateOfBirth, sex, experienceLevel } = {}) {
  return [
    !filled(heightCm) && "height",
    !filled(dateOfBirth) && "date of birth",
    !sexId(sex) && "sex",
    !experienceId(experienceLevel) && "training experience",
  ].filter(Boolean);
}

// The columns to save: only the values given, so a partial update never
// clears what is already stored.
export function profileUpdate({ heightCm, dateOfBirth, sex } = {}) {
  const row = {};
  if (Number(heightCm) > 0) row.height_cm = Math.round(Number(heightCm) * 10) / 10;
  if (DATE.test(String(dateOfBirth || ""))) row.date_of_birth = String(dateOfBirth);
  if (sexId(sex)) row.sex = sexId(sex);
  return row;
}

// Which of the given values differ from the stored profile.
export function profileChanges(profile = {}, values = {}) {
  const update = profileUpdate(values);
  const current = { height_cm: profile.heightCm, date_of_birth: profile.dateOfBirth, sex: profile.sex };
  return Object.fromEntries(Object.entries(update).filter(([key, value]) => current[key] !== value));
}

// Plain wording for a failed profile save.
export function profileSaveError(error) {
  const text = `${error?.message || ""} ${error?.code || ""}`;
  return /user_profiles|schema cache|does not exist|PGRST205|42P01/i.test(text)
    ? "Couldn't save your profile: the database needs the latest update (the user_profiles table)."
    : "Couldn't save your profile just now. Please try again.";
}

// Height in feet and inches (many UK users know it that way), stored in cm.
export function cmFromFeetInches(feet, inches) {
  const total = (Number(feet) || 0) * 12 + (Number(inches) || 0);
  return total > 0 ? Math.round(total * 2.54) : null;
}
export function feetInchesFromCm(cm) {
  const totalInches = Math.round((Number(cm) || 0) / 2.54);
  if (!(totalInches > 0)) return { feet: "", inches: "" };
  return { feet: String(Math.floor(totalInches / 12)), inches: String(totalInches % 12) };
}
