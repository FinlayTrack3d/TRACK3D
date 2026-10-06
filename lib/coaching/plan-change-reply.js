// The plan-change coach's reply, checked before it reaches the app: every
// proposed change must be one the app can apply and show in the Proposed
// change card. Used by app/api/plan-change, and by the workout coach's
// propose_plan_change action (lib/coaching/actions.js).
import { z } from "zod";

const prescriptionFields = {
  sets: z.coerce.number().int().min(1).max(10).optional(),
  reps: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(10)]).optional(),
  tempo: z.string().min(1).optional(),
  reason: z.string().optional(),
};

export const planChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remove_session"), sessionName: z.string().min(1), reason: z.string().optional() }),
  z.object({ kind: z.literal("update_session_days"), sessionName: z.string().min(1), days: z.array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])).min(1).max(7), reason: z.string().optional() }),
  z.object({ kind: z.literal("update_prescription"), sessionName: z.string().min(1), exerciseName: z.string().min(1), ...prescriptionFields }),
  z.object({ kind: z.literal("replace_exercise"), sessionName: z.string().min(1), exerciseName: z.string().min(1), replacementName: z.string().min(1), ...prescriptionFields }),
  z.object({ kind: z.literal("rename_exercise"), sessionName: z.string().min(1), exerciseName: z.string().min(1), replacementName: z.string().min(1), reason: z.string().optional() }),
  z.object({ kind: z.literal("remove_exercise"), sessionName: z.string().min(1), exerciseName: z.string().min(1), reason: z.string().optional() }),
  z.object({ kind: z.literal("add_exercise"), sessionName: z.string().min(1), replacementName: z.string().min(1), ...prescriptionFields }),
]);

const RECOMMENDATIONS = ["clarify", "targeted", "full_rebuild"];
const NOT_PREPARED = "I couldn't turn that into a change the app can save, so nothing is waiting for your approval. Try asking in a different way, or edit the session yourself on the Fitness page.";

// The proposed changes the app can apply, and how many were left out.
export function validPlanChanges(list, max = 16) {
  const proposed = Array.isArray(list) ? list.slice(0, max) : [];
  const changes = proposed.map((change) => planChangeSchema.safeParse(change)).filter((result) => result.success).map((result) => result.data);
  return { changes, dropped: proposed.length - changes.length };
}

// Added to a reply when some of its changes were left out of the card.
export function droppedChangesNote(dropped) {
  return dropped ? ` (${dropped === 1 ? "One part" : "Some parts"} of this couldn't be prepared as a change you can approve, so ${dropped === 1 ? "it isn't" : "they aren't"} included below.)` : "";
}

// The coach's reply, keeping every change the app can apply. If some
// changes couldn't be read, the reply says so rather than describing changes
// that will never reach the approval card.
export function readPlanChangeReply(raw) {
  const message = typeof raw?.message === "string" && raw.message.trim() ? raw.message.trim() : "";
  const recommendation = RECOMMENDATIONS.includes(raw?.recommendation) ? raw.recommendation : "clarify";
  const { changes, dropped } = validPlanChanges(raw?.changes);
  if (dropped && !changes.length) return { message: NOT_PREPARED, recommendation: recommendation === "targeted" ? "clarify" : recommendation, changes: [] };
  return { message: `${message || "I need one more detail before I can recommend a safe plan change."}${droppedChangesNote(dropped)}`, recommendation, changes };
}
