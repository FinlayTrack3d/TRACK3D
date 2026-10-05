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

// A user_profiles row (or nothing), plus the coach_profiles experience
// level, as { heightCm, dateOfBirth, sex, experienceLevel }.
export function normaliseProfile(row, experienceLevel = null) {
  return {
    heightCm: Number(row?.height_cm) > 0 ? Number(row.height_cm) : null,
    dateOfBirth: DATE.test(String(row?.date_of_birth || "")) ? String(row.date_of_birth) : null,
    sex: sexLabel(row?.sex) ? row.sex : null,
    experienceLevel: experienceId(experienceLevel),
  };
}

export const isProfileComplete = profile => Boolean(profile?.heightCm && profile?.dateOfBirth && profile?.sex && profile?.experienceLevel);

// The first problem with a profile form, or "" when it can be saved.
// With requireExperience, the training experience must be chosen too.
export function profileProblem({ heightCm, dateOfBirth, sex, experienceLevel } = {}, todayKey, { requireExperience = false } = {}) {
  const height = Number(heightCm);
  if (!(height >= 100 && height <= 250)) return "Enter your height in cm (100–250).";
  const age = ageFromDateOfBirth(dateOfBirth, todayKey);
  if (age === null || String(dateOfBirth) > String(todayKey) || String(dateOfBirth) < "1900-01-01") return "Enter your date of birth.";
  if (age < 13) return "TRACK3D is for ages 13 and over.";
  if (!sexId(sex)) return "Choose an option for sex.";
  if (requireExperience && !experienceId(experienceLevel)) return "Choose your training experience.";
  return "";
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
