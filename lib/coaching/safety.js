const PAIN_TERMS = /\b(pain|painful|hurt|hurts|injur(?:y|ed)|sharp|shooting|swollen|swelling|numb|numbness|tingl|popped|pop sound|joint pain)\b/i;
const URGENT_TERMS = /\b(severe|worsening|can't bear weight|cannot bear weight|trauma|fell|fall|collision|chest pain|fainted|unconscious|loss of function)\b/i;

export function classifySafetyText(text = "") {
  if (!PAIN_TERMS.test(text)) return { hasPain: false, severity: "none" };
  return { hasPain: true, severity: URGENT_TERMS.test(text) ? "concerning" : "pain" };
}

export function safetyDirective(text = "") {
  const assessment = classifySafetyText(text);
  if (!assessment.hasPain) return null;
  return {
    kind: "safety_stop",
    interrupt: true,
    severity: assessment.severity,
    message: assessment.severity === "concerning"
      ? "Stop the provoking movement. Because the symptoms sound concerning, seek appropriate medical or physiotherapy assessment."
      : "Stop the provoking movement for today. I can help adapt the session without diagnosing the cause.",
    prohibitedActions: ["progress_load", "encourage_push_through", "diagnose"],
  };
}
