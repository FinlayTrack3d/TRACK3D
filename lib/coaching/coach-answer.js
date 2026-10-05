// Reads the workout coach's JSON reply. complete is true for a full JSON
// object with a message. Otherwise answer holds the readable part (the
// message of a cut-off reply, or plain text the model wrote instead of
// JSON), or null when there is nothing usable.
import { partialJsonStringField } from "./anthropic.js";

export function readCoachAnswer(text = "") {
  const raw = String(text || "");
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const answer = JSON.parse(cleaned.slice(start, end + 1));
      if (answer && typeof answer.message === "string" && answer.message.trim()) return { complete: true, answer };
    } catch { /* fall through to the partial reading */ }
  }
  const partial = partialJsonStringField(cleaned, "message");
  if (partial && partial.trim()) return { complete: false, answer: { message: partial.trim(), insights: [], actions: [], memoryCandidates: [] } };
  if (cleaned && start === -1) return { complete: false, answer: { message: cleaned, insights: [], actions: [], memoryCandidates: [] } };
  return { complete: false, answer: null };
}
