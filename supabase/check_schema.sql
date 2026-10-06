-- Read-only check: lists columns the app writes that are missing from the
-- live database, compared with supabase_setup.sql and supabase/migrations,
-- plus tables without row level security or a policy.
-- Run in Supabase Dashboard -> SQL Editor. An empty "missing" result means
-- the schema matches.
with expected(table_name, column_name) as (values
  ('nutrition_plans', 'carbs_target'), ('nutrition_plans', 'fats_target'), ('nutrition_plans', 'goal'),
  ('nutrition_plans', 'rest_day_meals'), ('nutrition_plans', 'updated_at'),
  ('nutrition_plans', 'meal_library'), ('nutrition_plans', 'weekly_meal_plan'),
  ('nutrition_logs', 'is_training_day'),
  ('workout_logs', 'in_progress'), ('workout_logs', 'ai_feedback'),
  ('workout_splits', 'programme_started_at'), ('workout_splits', 'week_reviewed_at'),
  ('morning_routines', 'day_groups'),
  ('habits', 'id'), ('habits', 'user_id'), ('habits', 'name'), ('habits', 'category'),
  ('habits', 'streak'), ('habits', 'created_at'), ('habits', 'updated_at'),
  ('habit_completions', 'user_id'), ('habit_completions', 'habit_id'), ('habit_completions', 'date'),
  ('habit_completions', 'done'), ('habit_completions', 'updated_at'),
  ('daily_goals', 'id'), ('daily_goals', 'user_id'), ('daily_goals', 'date'), ('daily_goals', 'text'),
  ('daily_goals', 'done'), ('daily_goals', 'created_at'), ('daily_goals', 'updated_at'),
  ('coach_memory', 'user_id'), ('coach_memory', 'summary'), ('coach_memory', 'updated_at'),
  ('weekly_reports', 'id'), ('weekly_reports', 'user_id'), ('weekly_reports', 'report_date'),
  ('weekly_reports', 'week_start'), ('weekly_reports', 'week_end'), ('weekly_reports', 'patterns'),
  ('weekly_reports', 'diet_suggestions'), ('weekly_reports', 'created_at'),
  ('nutrition_plans', 'setup'),
  ('user_profiles', 'user_id'), ('user_profiles', 'height_cm'), ('user_profiles', 'date_of_birth'),
  ('user_profiles', 'sex'), ('user_profiles', 'updated_at'),
  ('user_profiles', 'health_consent_at'), ('user_profiles', 'health_consent_version'),
  ('user_profiles', 'health_consent_withdrawn_at')
)
select 'missing column' as problem, e.table_name, e.column_name
from expected e
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = e.table_name and c.column_name = e.column_name
where c.column_name is null
union all
-- Upserts need a unique constraint on exactly these columns.
select 'missing unique constraint', t.table_name, t.cols
from (values
  ('habits', 'id,user_id'), ('habit_completions', 'date,habit_id,user_id'), ('daily_goals', 'date,id,user_id'),
  ('workout_splits', 'user_id'), ('morning_routines', 'user_id'), ('morning_checkins', 'date,user_id'),
  ('weekly_reports', 'report_date,user_id')
) as t(table_name, cols)
where not exists (
  select 1 from pg_index i
  join pg_class r on r.oid = i.indrelid
  join pg_namespace n on n.oid = r.relnamespace and n.nspname = 'public'
  where r.relname = t.table_name and i.indisunique
    and (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
         where a.attrelid = r.oid and a.attnum = any(i.indkey)) = t.cols
)
union all
-- Each user-owned table needs row level security on and at least one policy.
select case when r.oid is null then 'missing table'
            when not r.relrowsecurity then 'row level security off'
            else 'missing policy' end, t.table_name, null
from (values ('habits'), ('habit_completions'), ('daily_goals'), ('coach_memory'), ('weekly_reports'), ('user_profiles'), ('data_exports')) as t(table_name)
left join pg_class r on r.relname = t.table_name and r.relnamespace = 'public'::regnamespace and r.relkind = 'r'
where r.oid is null or not r.relrowsecurity
   or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.table_name)
union all
-- Profile -> Account: health data consent, Download my data and Delete my account.
select 'missing function', f.name, null
from (values ('export_my_data'), ('delete_my_account'), ('set_health_consent'), ('record_signup_health_consent')) as f(name)
where not exists (select 1 from pg_proc p where p.proname = f.name and p.pronamespace = 'public'::regnamespace)
union all
-- Health data consent ticked at sign-up is recorded on the profile.
select 'missing trigger', 'auth.users', 'record_signup_health_consent'
where not exists (select 1 from pg_trigger t where t.tgname = 'record_signup_health_consent' and t.tgrelid = 'auth.users'::regclass)
union all
-- Every other table holding users' rows (including ones made by hand in the
-- dashboard) must only let each user reach their own. chat_requests and
-- account_password_checks are only used by database functions, so they have
-- row level security on and no policies.
select case when not c.relrowsecurity then 'row level security off' else 'missing policy' end, c.relname::text, 'user_id table'
from pg_class c
join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  and c.relname not in ('habits', 'habit_completions', 'daily_goals', 'coach_memory', 'weekly_reports', 'user_profiles', 'data_exports', 'chat_requests', 'account_password_checks')
  and (not c.relrowsecurity or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname))
union all
-- Users must be able to delete their own progress photos.
select 'missing storage policy', 'storage.objects', 'checkin-photos delete'
where not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
                  and p.cmd = 'DELETE' and p.qual like '%checkin-photos%')
order by 1, 2, 3;
