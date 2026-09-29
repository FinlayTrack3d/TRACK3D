export const COACH_PERSONALITIES = Object.freeze({
  strict: {
    label: "PUSH ME",
    instruction: "Be concise and firm. Challenge avoidable excuses, never shame, insult, or pressure through pain.",
  },
  balanced: {
    label: "COACH ME",
    instruction: "Be direct when needed and supportive when earned. Explain the smallest useful next step.",
  },
  supportive: {
    label: "BACK ME",
    instruction: "Encourage consistency and recovery from setbacks without agreeing to unsafe or unhelpful choices.",
  },
});

export function personalityInstruction(personality = "balanced") {
  return (COACH_PERSONALITIES[personality] || COACH_PERSONALITIES.balanced).instruction;
}
