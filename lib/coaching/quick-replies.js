const YES_NO_OPENERS = /^(do|does|did|is|are|was|were|can|could|would|will|should|shall|have|has|had|may|might|want|ready|happy|okay|ok)\b/i;

// True only when the coach's last question can be answered with yes or no,
// so quick-reply chips are not offered for open questions.
export function isYesNoQuestion(text = "") {
  const visible = String(text)
    .replace(/\[MEMORY\][\s\S]*?\[\/MEMORY\]/gi, "")
    .replace(/\[ACTION_JSON:[^\]]+\][\s\S]*?\[\/ACTION_JSON\]/gi, "")
    .replace(/\[ACTION:[^\]]+\]/gi, "")
    .trim();
  if (!visible.endsWith("?")) return false;
  const sentences = visible.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.replace(/^[\s\-*•]+/, "").trim()).filter(Boolean);
  const question = sentences.at(-1) || "";
  if (/\bor\b/i.test(question)) return false;
  return YES_NO_OPENERS.test(question);
}
