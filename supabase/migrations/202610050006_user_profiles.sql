-- User profile: height, date of birth and sex, filled in from the dashboard
-- "Complete your profile" to-do or the nutrition setup. Date of birth is
-- stored (not age) so age stays correct. One row per user; row level
-- security lets each user read and write only their own row.
-- Safe to run more than once. Run in Supabase Dashboard -> SQL Editor.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  height_cm numeric(5,1) check (height_cm is null or height_cm between 100 and 250),
  date_of_birth date check (date_of_birth is null or date_of_birth >= date '1900-01-01'),
  sex text check (sex is null or sex in ('male', 'female', 'prefer_not_to_say')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles') then
    create policy "user_profiles: users manage their own row" on public.user_profiles
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

notify pgrst, 'reload schema';
