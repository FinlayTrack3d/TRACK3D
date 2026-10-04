-- Persist the AI Coach review beside each completed legacy workout.
alter table if exists public.workout_logs
  add column if not exists ai_feedback text;
