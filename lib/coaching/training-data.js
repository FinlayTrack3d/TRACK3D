import { supabase } from "../supabase.js";

export function exerciseKey(name = "") {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function formatPrescription(exercise) {
  const sets = Number(exercise?.sets || 0);
  const reps = Array.isArray(exercise?.reps)
    ? (new Set(exercise.reps.filter(Boolean)).size === 1 ? exercise.reps.find(Boolean) : exercise.reps.filter(Boolean).join(" / "))
    : exercise?.reps;
  return `${sets} × ${reps || "-"}`;
}

export async function saveStructuredWorkout({ userId, activeSession, completedSets, startedAt, legacyWorkoutLogId = null }) {
  const completedAt = new Date();
  const sessionPayload = {
    user_id: userId,
    legacy_workout_log_id: legacyWorkoutLogId,
    session_key: exerciseKey(activeSession?.name || "workout"),
    session_name: activeSession?.name || "Workout",
    started_at: new Date(startedAt).toISOString(),
    completed_at: completedAt.toISOString(),
    duration_seconds: Math.max(0, Math.round((completedAt.getTime() - startedAt) / 1000)),
    status: "completed",
    temporary_context: activeSession?.temporaryContext || {},
    achievement: activeSession?.achievement || null,
  };
  const query = activeSession?.trainingSessionId
    ? supabase.from("training_sessions").update(sessionPayload).eq("id", activeSession.trainingSessionId).eq("user_id", userId)
    : supabase.from("training_sessions").insert(sessionPayload);
  const { data: session, error: sessionError } = await query.select("id").single();
  if (sessionError) throw sessionError;

  const rows = activeSession.exercises.flatMap((exercise, exerciseIndex) => {
    const key = exerciseKey(exercise.name);
    return (completedSets[exerciseIndex] || []).map((set, index) => {
      const setRange = Array.isArray(exercise.reps) ? exercise.reps[index] : exercise.reps;
      const range = String(setRange || "").match(/\d+/g)?.map(Number) || [];
      return {
        user_id: userId,
        session_id: session.id,
        exercise_key: key,
        exercise_name: exercise.name,
        set_index: index + 1,
        set_kind: set.extra ? "extra" : "working",
        weight: Number(set.weight),
        reps: Number(set.reps),
        rep_min: range[0] || null,
        rep_max: range.at(-1) || null,
        form_feedback: set.formFeedback || null,
        progression_decision: set.progressionDecision || null,
      };
    });
  });
  if (rows.length) {
    const { error } = await supabase.from("training_sets").insert(rows);
    if (error) throw error;
  }
  return session.id;
}
