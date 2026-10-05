-- Repair: bring a database that missed parts of supabase_setup.sql up to the
-- schema the app already uses. Only re-applies definitions that exist in
-- supabase_setup.sql and earlier migrations; adds nothing new. Safe to run
-- more than once. Run in Supabase Dashboard -> SQL Editor.

-- Nutrition (supabase_setup.sql "Fix: nutrition_plans ..." + 202610040002)
alter table public.nutrition_plans add column if not exists carbs_target integer;
alter table public.nutrition_plans add column if not exists fats_target integer;
alter table public.nutrition_plans add column if not exists goal text;
alter table public.nutrition_plans add column if not exists rest_day_meals jsonb;
alter table public.nutrition_plans add column if not exists updated_at timestamptz;
alter table public.nutrition_plans add column if not exists meal_library jsonb not null default '[]'::jsonb;
alter table public.nutrition_plans add column if not exists weekly_meal_plan jsonb not null default '{}'::jsonb;
alter table public.nutrition_logs add column if not exists is_training_day boolean not null default true;

-- Workouts (supabase_setup.sql sections 5 and 10 + 202610040001)
alter table public.workout_logs add column if not exists in_progress boolean not null default false;
alter table public.workout_logs add column if not exists ai_feedback text;
alter table public.workout_splits add column if not exists programme_started_at timestamptz not null default now();
alter table public.workout_splits add column if not exists week_reviewed_at timestamptz;

-- Morning (section 7)
alter table public.morning_routines add column if not exists day_groups jsonb;

-- Habits (section 6). "create table if not exists" skips a table that
-- already exists, so its columns are added one by one as well.
create table if not exists public.habits (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  primary key (user_id, id)
);
alter table public.habits add column if not exists category text not null default 'daily';
alter table public.habits add column if not exists streak integer not null default 0;
alter table public.habits add column if not exists created_at timestamptz not null default now();
alter table public.habits add column if not exists updated_at timestamptz not null default now();
create unique index if not exists habits_user_id_id_key on public.habits (user_id, id);

create table if not exists public.habit_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  date date not null,
  primary key (user_id, habit_id, date)
);
alter table public.habit_completions add column if not exists done boolean not null default true;
alter table public.habit_completions add column if not exists updated_at timestamptz not null default now();
create unique index if not exists habit_completions_user_habit_date_key on public.habit_completions (user_id, habit_id, date);

-- Daily goals (section 8) and coach memory (section 9)
create table if not exists public.daily_goals (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  text text not null,
  primary key (user_id, date, id)
);
alter table public.daily_goals add column if not exists done boolean not null default false;
alter table public.daily_goals add column if not exists created_at timestamptz not null default now();
alter table public.daily_goals add column if not exists updated_at timestamptz not null default now();

create table if not exists public.coach_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text not null default ''
);
alter table public.coach_memory add column if not exists updated_at timestamptz not null default now();

-- Row level security and policies from supabase_setup.sql, created only if missing.
alter table public.habits enable row level security;
alter table public.habit_completions enable row level security;
alter table public.daily_goals enable row level security;
alter table public.coach_memory enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habits') then
    create policy "habits: users manage their own rows" on public.habits
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habit_completions') then
    create policy "habit_completions: users manage their own rows" on public.habit_completions
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_goals') then
    create policy "daily_goals: users manage their own rows" on public.daily_goals
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_memory') then
    create policy "coach_memory: users manage their own row" on public.coach_memory
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- The "schema cache" in the error messages is PostgREST's: reload it so the
-- new columns are visible to the app straight away.
notify pgrst, 'reload schema';
