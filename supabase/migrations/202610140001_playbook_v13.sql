-- Playbook V1.3: the gym's weight steps and a step goal on the profile,
-- beginner straight sets -> staggered sets on the training plan, and daily
-- steps. Safe to run more than once. Run in Supabase Dashboard -> SQL Editor.

-- The weight steps the user's gym goes up in, per kind of equipment, in kg:
-- {"dumbbell": 2, "barbell": 2.5, "machine": 5, "cable": 2.5, "kettlebell": 4}.
alter table public.user_profiles add column if not exists gym_steps jsonb;
-- The daily step goal (Rule 55); the app uses 8,000 when it is empty.
alter table public.user_profiles add column if not exists step_goal integer
  check (step_goal is null or step_goal between 1000 and 30000);

-- Beginners train on straight sets until they switch (Rule 70a):
-- 'staggered' once switched; the "keep it simple" choice asks again after
-- set_structure_snooze_until.
alter table public.workout_splits add column if not exists set_structure text
  check (set_structure is null or set_structure in ('straight', 'staggered'));
alter table public.workout_splits add column if not exists set_structure_snooze_until date;

-- Daily steps (Rules 55-56): one row per user per day, entered by hand.
create table if not exists public.daily_steps (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  steps integer not null check (steps between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.daily_steps enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_steps') then
    create policy "daily_steps: users manage their own rows" on public.daily_steps
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
revoke all on public.daily_steps from anon;

notify pgrst, 'reload schema';
