const DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const TEXT_FIELDS = ["experience", "session_length", "equipment", "split", "favourites", "priorities", "limitations"];

function text(value) {
  if (Array.isArray(value)) value = value.filter(Boolean).join(", ");
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && !/^(null|none stated|not stated|unknown|n\/a)$/i.test(trimmed) ? trimmed : null;
}

// Pull the first JSON object out of a model reply, even when it is wrapped
// in prose or a code fence.
export function extractJsonObject(reply = "") {
  const cleaned = String(reply).replace(/```json|```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

// Turn the model's extraction of a coach chat into AI-builder answers.
// Only clearly stated values are kept; anything else stays unanswered.
export function questionnaireAnswersFromExtraction(parsed, goalOptions = []) {
  const answers = {};
  if (!parsed || typeof parsed !== "object") return answers;
  const goals = (Array.isArray(parsed.goal) ? parsed.goal : [parsed.goal]).map(text).filter(Boolean);
  const matched = [];
  const other = [];
  for (const goal of goals) {
    const option = goalOptions.find(item => item.toLowerCase() === goal.toLowerCase());
    if (option) matched.push(option); else other.push(goal);
  }
  if (matched.length) answers.goal = [...new Set(matched)].slice(0, 2);
  const customGoal = [text(parsed.goal_custom), ...other].filter(Boolean).join(" and ");
  if (customGoal) answers.goal_custom = customGoal;
  const dayValue = String(parsed.days_per_week ?? "").toLowerCase();
  const dayCount = parseInt(dayValue, 10) || NUMBER_WORDS[dayValue.match(/[a-z]+/)?.[0]] || 0;
  if (dayCount >= 1 && dayCount <= 7) answers.days_per_week = `${dayCount} ${dayCount === 1 ? "day" : "days"}`;
  const preferred = (Array.isArray(parsed.preferred_days) ? parsed.preferred_days : String(parsed.preferred_days || "").split(/[\s,/]+/))
    .map(day => String(day).trim().slice(0, 3).toUpperCase())
    .filter(day => DAY_CODES.includes(day) || day === "FLE");
  if (preferred.includes("FLE")) answers.preferred_days = ["FLEXIBLE"];
  else if (preferred.length) answers.preferred_days = DAY_CODES.filter(day => preferred.includes(day));
  for (const id of TEXT_FIELDS) {
    const value = text(parsed[id]);
    if (value) answers[id] = value;
  }
  return answers;
}
