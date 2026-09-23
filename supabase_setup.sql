-- Run this once in the Supabase Dashboard -> SQL Editor for this project.
-- Sets up storage + tables needed for: morning check-in photos and weekly reports.

-- 1. Storage bucket for morning check-in photos (private, accessed via signed URLs)
insert into storage.buckets (id, name, public)
values ('checkin-photos', 'checkin-photos', false)
on conflict (id) do nothing;

-- Users can only read/write inside a folder named after their own auth uid,
-- e.g. checkin-photos/<user_id>/<date>/front.jpg
create policy "checkin-photos: users manage their own folder (select)"
on storage.objects for select
to authenticated
using (
  bucket_id = 'checkin-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "checkin-photos: users manage their own folder (insert)"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'checkin-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "checkin-photos: users manage their own folder (update)"
on storage.objects for update
to authenticated
using (
  bucket_id = 'checkin-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 2. Per-user settings (currently just the weekly report day)
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  report_day smallint not null default 0, -- 0=Sunday .. 6=Saturday
  updated_at timestamptz not null default now()
);

-- 3. Generated weekly reports
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  week_start date not null,
  week_end date not null,
  patterns text,
  diet_suggestions text,
  created_at timestamptz not null default now(),
  unique (user_id, report_date)
);

-- Fix: nutrition_plans table was missing columns the app expects.
alter table nutrition_plans add column if not exists carbs_target integer;
alter table nutrition_plans add column if not exists fats_target integer;
alter table nutrition_plans add column if not exists goal text;
alter table nutrition_plans add column if not exists rest_day_meals jsonb;
alter table nutrition_plans add column if not exists updated_at timestamptz;

-- The live nutrition logger records whether today's plan is for a training day.
alter table nutrition_logs add column if not exists is_training_day boolean not null default true;

-- 4. End-of-workout check-ins (effort, body feeling, mental state, "more in the tank")
create table if not exists workout_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  effort smallint,
  body_feelings jsonb,
  pain_location text,
  mental_state text,
  more_in_tank text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- 5. Workout mini-save: a workout_logs row is created on the first confirmed
-- set and updated after every set from then on, flagged in_progress while
-- it's still live. A row left in_progress for 2+ hours with no update is
-- presumed abandoned and flipped to a normal finished log (see
-- finalizeStaleWorkouts in TRACK3D.jsx). Existing rows backfill to false.
alter table workout_logs add column if not exists in_progress boolean not null default false;

-- 6. Habits: previously localStorage-only, now durable. id is the client-
-- generated id (a stringified timestamp) rather than a server uuid, so the
-- app doesn't need a round trip before it can save a newly added habit.
create table if not exists habits (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'daily',
  streak integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table habits enable row level security;
create policy "habits: users manage their own rows" on habits
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- One row per habit per day it was ticked done; untick deletes the row.
create table if not exists habit_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  date date not null,
  done boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, habit_id, date)
);
alter table habit_completions enable row level security;
create policy "habit_completions: users manage their own rows" on habit_completions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 7. Named alternating-day rotation, replacing the hardcoded A/B days.
-- [{"id":"A","name":"Training Day"}, {"id":"B","name":"Rest Day"}, ...]
alter table morning_routines add column if not exists day_groups jsonb;

-- 8. Dashboard "Top Goals for Today" - up to 3 tickable goals per day.
create table if not exists daily_goals (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date, id)
);
alter table daily_goals enable row level security;
create policy "daily_goals: users manage their own rows" on daily_goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 9. AI Coach's own running memory - a short summary it maintains and updates
-- itself after every reply, so it has continuity across separate
-- conversations (even on a different device), not just within one chat.
create table if not exists coach_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text not null default '',
  updated_at timestamptz not null default now()
);
alter table coach_memory enable row level security;
create policy "coach_memory: users manage their own row" on coach_memory
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 10. 1-week programme review: when the current split was (re)started, and
-- when it was last reviewed, so the dashboard can prompt a check-in exactly
-- once per week rather than every day after the first week.
alter table workout_splits add column if not exists programme_started_at timestamptz not null default now();
alter table workout_splits add column if not exists week_reviewed_at timestamptz;
