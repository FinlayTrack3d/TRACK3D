import { z } from "zod";
import { planChangeSchema, validPlanChanges } from "./plan-change-reply.js";

export const coachActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("temporary_exercise_swap"), workoutId: z.string().uuid(), exerciseId: z.string(), replacementExerciseId: z.string(), replacementExerciseName: z.string().optional(), reason: z.string(), scope: z.enum(["today", "this_week"]) }),
  z.object({ type: z.literal("temporary_reorder"), workoutId: z.string().uuid(), exerciseIds: z.array(z.string()).min(1), reason: z.string(), scope: z.literal("today") }),
  z.object({ type: z.literal("temporary_reduce_sets"), workoutId: z.string().uuid(), exerciseId: z.string(), setCount: z.number().int().positive(), reason: z.string(), scope: z.enum(["today", "this_week"]) }),
  z.object({ type: z.literal("propose_permanent_exercise_swap"), programmeExerciseId: z.string().uuid(), replacementExerciseId: z.string(), replacementExerciseName: z.string().optional(), reason: z.string(), scope: z.literal("permanent") }),
  z.object({ type: z.literal("propose_permanent_set_change"), programmeExerciseId: z.string().uuid(), setCount: z.number().int().positive(), reason: z.string(), scope: z.literal("permanent") }),
  // A change to the saved plan by session and exercise name, the same
  // changes the Change Plan coach makes. It waits for APPROVE & SAVE.
  z.object({ type: z.literal("propose_plan_change"), changes: z.array(planChangeSchema).min(1).max(8), reason: z.string().optional(), scope: z.literal("permanent").default("permanent") }),
  z.object({ type: z.literal("set_inline_cue"), programmeExerciseId: z.string().uuid(), cue: z.string().max(120), reason: z.string(), scope: z.enum(["next_session", "temporary"]) }),
  z.object({ type: z.literal("record_memory_candidate"), category: z.enum(["goal", "priority", "exercise_preference", "equipment", "availability", "schedule", "communication"]), value: z.record(z.unknown()), evidence: z.string() }),
  z.object({ type: z.literal("record_pain_report"), exerciseId: z.string().optional(), bodyArea: z.string().optional(), report: z.string(), severity: z.enum(["unspecified", "mild", "moderate", "concerning"]) }),
]);

export function requiresApproval(action) {
  return action?.scope === "permanent" || action?.type?.startsWith("propose_permanent_");
}

// droppedChanges: how many of a plan change's changes the app couldn't
// apply and left out (the rest are kept).
export function prepareAction(rawAction) {
  const planChange = rawAction?.type === "propose_plan_change" ? validPlanChanges(rawAction.changes, 8) : null;
  const action = coachActionSchema.parse(planChange ? { ...rawAction, changes: planChange.changes } : rawAction);
  return { action, status: requiresApproval(action) ? "pending_approval" : "ready", mayApply: !requiresApproval(action), droppedChanges: planChange?.dropped || 0 };
}
