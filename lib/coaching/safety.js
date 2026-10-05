// Pain and red-flag handling shared by every coach.
//
// Negated phrases ("won't hurt", "no pain", "pain-free") and normal training
// soreness ("DOMS", "sore in a good way") are removed before checking, so
// "what can I do that won't hurt it?" is not treated as a new pain report.
const NEGATED_OR_SORENESS = /\b(?:won'?t|wont|doesn'?t|does not|didn'?t|did not|don'?t|do not|shouldn'?t|should not|isn'?t|is not|without|no|not|zero|never)\s+(?:any\s+|much\s+|really\s+|more\s+)?(?:pain|painful|hurt|hurts|hurting|injur(?:y|e|ed|ing))\b|\bpain[-\s]?free\b|\bdoms\b|\bsore in a good way\b|\bgood sore\b|\bjust (?:a bit )?sore\b|\bmuscle soreness\b|\bnormal soreness\b/gi;
const PAIN_TERMS = /\b(pain|painful|hurt|hurts|hurting|injur(?:y|ed)|sharp|shooting|stabbing|swollen|swelling|popped|pop sound|joint pain|tweaked|pulled)\b/i;
// Red flags: stop training and get medical help promptly.
const RED_FLAGS = /\b(chest pain|chest tightness|faint(?:ed|ing)?|passed out|blacked out|unconscious|numb(?:ness)?|tingl\w*|pins and needles|loss of function|can'?t move|cannot move|can'?t bear weight|cannot bear weight|can'?t put weight|severe|worsening|getting worse|trauma|fell|collision|heard a pop|short(?:ness)? of breath|can'?t breathe)\b/i;
const BODY_AREAS = ["shoulder", "knee", "lower back", "upper back", "back", "neck", "elbow", "wrist", "hip", "ankle", "hamstring", "groin", "chest", "calf", "quad", "foot", "hand", "bicep", "tricep", "glute"];

export function stripNegatedPain(text = "") {
  return String(text).replace(NEGATED_OR_SORENESS, " ");
}

export function classifySafetyText(text = "") {
  const checked = stripNegatedPain(text);
  const redFlag = RED_FLAGS.test(checked);
  if (!redFlag && !PAIN_TERMS.test(checked)) return { hasPain: false, severity: "none" };
  return { hasPain: true, severity: redFlag ? "concerning" : "pain" };
}

export function bodyAreaOf(text = "") {
  const lower = String(text).toLowerCase();
  return BODY_AREAS.find((area) => lower.includes(area)) || null;
}

export const SAFETY_MESSAGES = {
  pain: "Stop that exercise for today — don't push through pain. If it's sharp, getting worse, or still there in a few days, get it checked by a physio or doctor. I can't diagnose it, but I can help you adapt the rest of today's session: tell me what you'd like to train instead.",
  concerning: "Stop training for today. Chest pain, fainting, numbness or tingling, losing strength or movement, or not being able to put weight on it need medical help promptly — contact a doctor or NHS 111, and call 999 if it's severe or sudden. Please don't continue the session.",
};

export function safetyDirective(text = "") {
  const assessment = classifySafetyText(text);
  if (!assessment.hasPain) return null;
  return {
    kind: "safety_stop",
    interrupt: true,
    severity: assessment.severity,
    bodyArea: bodyAreaOf(text),
    message: SAFETY_MESSAGES[assessment.severity === "concerning" ? "concerning" : "pain"],
    prohibitedActions: ["progress_load", "encourage_push_through", "diagnose"],
  };
}

// Pain reports that still apply: not resolved and from the last 48 hours.
export function activePainReports(reports = [], now = Date.now()) {
  return (reports || []).filter((report) => report && report.status !== "resolved"
    && now - Date.parse(report.reported_at || 0) <= 48 * 60 * 60 * 1000);
}

// Put first in the system prompt while pain is active. It overrides tone,
// plan and progression instructions.
// What actually loads each area, so alternatives are not chosen by name
// alone (a plank loads the shoulders; a goblet squat is held at the chest).
const AREA_LOADING = [
  { areas: ["shoulder", "elbow", "wrist", "hand", "bicep", "tricep", "chest", "upper back", "neck"],
    loads: "any pressing or pulling, push-ups, planks and other positions on the hands or forearms, hanging, and anything held in the hands or at the chest (dumbbells, kettlebells, barbells — so goblet squats, dumbbell lunges, deadlifts, rows and carries)",
    usually: "machine leg press, leg extension, leg curl, seated calf raise, a glute bridge with no weight held, or an easy bike" },
  { areas: ["knee", "quad", "hamstring", "calf", "ankle", "foot"],
    loads: "squats, lunges, step-ups, leg press, leg extensions and curls, jumping, running, and standing exercises with heavy weights",
    usually: "seated or supported upper-body machines such as chest press, seated row or lat pulldown" },
  { areas: ["lower back", "back", "hip", "glute", "groin"],
    loads: "deadlifts, squats, bent-over rows, good mornings, hip thrusts, lunges, heavy carries, planks and sit-ups, and standing with heavy weights",
    usually: "supported, seated upper-body machines with a back rest, such as chest press or lat pulldown" },
];

function areaGuidance(reports) {
  const areas = [...new Set(reports.map((report) => report.body_area || bodyAreaOf(report.exercise_key || "") || bodyAreaOf(report.report || "")).filter(Boolean))];
  return areas.map((area) => {
    const group = AREA_LOADING.find((item) => item.areas.includes(area));
    return group ? `- The ${area} is loaded by ${group.loads}. Do not suggest any of these. Options that usually keep load off the ${area}: ${group.usually}.` : null;
  }).filter(Boolean).join("\n");
}

export function activePainDirective(reports = []) {
  if (!reports.length) return "";
  const described = reports.slice(0, 3).map((report) => {
    const where = [report.body_area, report.exercise_key && `during ${report.exercise_key}`].filter(Boolean).join(", ");
    return `- "${String(report.report || "").slice(0, 200)}"${where ? ` (${where})` : ""}`;
  }).join("\n");
  return `ACTIVE PAIN — THIS OVERRIDES EVERY OTHER INSTRUCTION, INCLUDING TONE AND THE PLAN.
The user reported pain recently and has not marked it resolved:
${described}
- Do not prescribe, progress, add load to, or encourage the movement that hurt, or anything that loads the same body area. Never say to finish it "as prescribed", drop the weight and carry on, or push through.
- Offer a pain-free alternative for a different body area, a temporary swap (temporary_exercise_swap) or fewer sets (temporary_reduce_sets), or suggest ending the session.
${areaGuidance(reports)}
- Never claim an exercise "avoids", "doesn't use" or "takes all load off" the sore area, or that it is safe. Say it should keep load off it, and to stop if it hurts.
- If it continues, is sharp, or is getting worse, say to get it assessed by a physio or doctor.
- Never diagnose or guess a cause (no "might be a strain", "nerve involvement", "impingement").
- If they say it no longer hurts, tell them they can mark the pain as resolved, and to ease back in with light, pain-free sets.`;
}

// Actions the coach may emit while pain is active: nothing that adds load
// or changes the saved plan.
export const SAFE_ACTIONS_DURING_PAIN = new Set(["temporary_exercise_swap", "temporary_reduce_sets", "temporary_reorder", "set_inline_cue", "record_pain_report"]);
