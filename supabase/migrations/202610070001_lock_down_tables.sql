-- Locks every table that holds a user's data to that user, and limits the
-- progress photo bucket to images. Safe to run more than once.
-- Run in the Supabase Dashboard -> SQL Editor.
--
-- Several tables were created in the dashboard and never defined in this
-- repo (morning_checkins, nutrition_logs, workout_logs and others), so their
-- row level security could not be checked from the code. For each table
-- below that exists, this:
--   1. switches row level security on;
--   2. removes any policy that doesn't limit rows to the signed-in user
--      (for example "using (true)"), which would let anyone read them;
--   3. adds one policy: a signed-in user can read and change only rows whose
--      user_id is their own;
--   4. removes all access for signed-out (anon) requests.
-- user_settings and workout_checkins are from the first setup script and are
-- no longer used by the app; they are locked the same way, not deleted.

do $$
declare
  t text;
  policy record;
  user_id_type text;
  owner_check text;
begin
  foreach t in array array[
    'morning_checkins', 'morning_routines', 'nutrition_logs', 'nutrition_plans',
    'workout_logs', 'workout_splits', 'calendar_tasks', 'end_of_day', 'daily_debrief',
    'user_settings', 'workout_checkins'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '%: not found, skipped', t;
      continue;
    end if;
    select data_type into user_id_type from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id';
    if user_id_type is null then
      raise warning '%: has no user_id column, NOT changed - check it by hand', t;
      continue;
    end if;
    owner_check := case when user_id_type = 'uuid'
      then 'user_id = (select auth.uid())'
      else 'user_id::text = (select auth.uid())::text' end;

    execute format('alter table public.%I enable row level security', t);

    -- Any policy that doesn't refer to the signed-in user is too broad.
    for policy in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and coalesce(qual, '') !~ 'auth\.uid\(\)'
        and coalesce(with_check, '') !~ 'auth\.uid\(\)'
    loop
      execute format('drop policy %I on public.%I', policy.policyname, t);
      raise notice '%: removed policy "%" (it did not limit rows to their owner)', t, policy.policyname;
    end loop;

    execute format('drop policy if exists %I on public.%I', t || ': owner only', t);
    execute format('create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
      t || ': owner only', t, owner_check, owner_check);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Progress photos: images only, at most 15 MB each.
update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'checkin-photos';

notify pgrst, 'reload schema';

-- Check: every table in public should show rls_on = true, and every policy
-- on the tables above should mention auth.uid().
select c.relname as table_name, c.relrowsecurity as rls_on,
       coalesce(string_agg(p.policyname || ': ' || coalesce(p.qual, p.with_check, ''), ' | '), 'NO POLICIES') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relrowsecurity, c.relname;
