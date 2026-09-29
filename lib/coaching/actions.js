import { z } from "zod";

export const coachActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("temporary_exercise_swap"), workoutId: z.string().uuid(), exerciseId: z.string(), replacementExerciseId: z.string(), replacementExerciseName: z.string().optional(), reason: z.string(), scope: z.enum(["today", "this_week"]) }),
  z.object({ type: z.literal("temporary_reorder"), workoutId: z.string().uuid(), exerciseIds: z.array(z.string()).min(1), reason: z.string(), scope: z.literal("today") }),
  z.object({ type: z.literal("temporary_reduce_sets"), workoutId: z.string().uuid(), exerciseId: z.string(), setCount: z.number().int().positive(), reason: z.string(), scope: z.enum(["today", "this_week"]) }),
  z.object({ type: z.literal("propose_permanent_exercise_swap"), programmeExerciseId: z.string().uuid(), replacementExerciseId: z.string(), replacementExerciseName: z.string().optional(), reason: z.string(), scope: z.literal("permanent") }),
  z.object({ type: z.literal("propose_permanent_set_change"), programmeExerciseId: z.string().uuid(), setCount: z.number().int().positive(), reason: z.string(), scope: z.literal("permanent") }),
  z.object({ type: z.literal("set_inline_cue"), programmeExerciseId: z.string().uuid(), cue: z.string().max(120), reason: z.string(), scope: z.enum(["next_session", "temporary"]) }),
  z.object({ type: z.literal("record_memory_candidate"), category: z.enum(["goal", "priority", "exercise_preference", "equipment", "availability", "schedule", "communication"]), value: z.record(z.unknown()), evidence: z.string() }),
  z.object({ type: z.literal("record_pain_report"), exerciseId: z.string().optional(), bodyArea: z.string().optional(), report: z.string(), severity: z.enum(["unspecified", "mild", "moderate", "concerning"]) }),
]);

export function requiresApproval(action) {
  return action?.scope === "permanent" || action?.type?.startsWith("propose_permanent_");
}

export function prepareAction(rawAction) {
  const action = coachActionSchema.parse(rawAction);
  return { action, status: requiresApproval(action) ? "pending_approval" : "ready", mayApply: !requiresApproval(action) };
}
