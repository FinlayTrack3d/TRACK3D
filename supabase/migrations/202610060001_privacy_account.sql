-- Privacy controls (Profile -> Account):
--   1. Consent to store health information, recorded on the profile: at
--      sign-up (the tick box) and with set_health_consent() afterwards.
--   2. Users can delete their own progress photos.
--   3. Download my data: export_my_data(), at most one a day.
--   4. Delete my account: delete_my_account(password), which removes every
--      row the user has in every table and the sign-in account itself.
-- Both functions find the user's rows the same way: every table in the
-- public schema with a user_id column, so tables added later are covered.
-- Safe to run more than once. Run in Supabase Dashboard -> SQL Editor.

-- 1. Health data consent: when it was given, the policy version agreed to,
-- and when it was withdrawn (if it was).
alter table public.user_profiles add column if not exists health_consent_at timestamptz;
alter table public.user_profiles add column if not exists health_consent_version text;
alter table public.user_profiles add column if not exists health_consent_withdrawn_at timestamptz;

-- Consent given (p_given true) or withdrawn (false) by the signed-in user,
-- timed by the database clock. Returns that time. Row level security still
-- applies, so it only ever changes the user's own row.
create or replace function public.set_health_consent(p_version text, p_given boolean default true)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  stamp timestamptz := now();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_given then
    insert into public.user_profiles (user_id, health_consent_at, health_consent_version, health_consent_withdrawn_at, updated_at)
    values (uid, stamp, left(p_version, 40), null, stamp)
    on conflict (user_id) do update
      set health_consent_at = excluded.health_consent_at,
          health_consent_version = excluded.health_consent_version,
          health_consent_withdrawn_at = null,
          updated_at = excluded.updated_at;
  else
    insert into public.user_profiles (user_id, health_consent_withdrawn_at, updated_at)
    values (uid, stamp, stamp)
    on conflict (user_id) do update
      set health_consent_withdrawn_at = excluded.health_consent_withdrawn_at,
          updated_at = excluded.updated_at;
  end if;
  return stamp;
end;
$$;

-- Consent ticked at sign-up arrives with the new sign-in account (in its
-- metadata) and is recorded on the profile straight away. This never stops
-- a sign-up: if it fails, the app copies the consent on first sign-in.
create or replace function public.record_signup_health_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_user_meta_data->>'health_consent_version', '') <> '' then
    insert into public.user_profiles (user_id, health_consent_at, health_consent_version)
    values (new.id, now(), left(new.raw_user_meta_data->>'health_consent_version', 40))
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists record_signup_health_consent on auth.users;
create trigger record_signup_health_consent
  after insert on auth.users
  for each row execute function public.record_signup_health_consent();

-- 2. Users can delete photos in their own folder of checkin-photos
-- (checkin-photos/<user_id>/<date>/<angle>.jpg). Needed for deleting a photo
-- and for deleting the account.
drop policy if exists "checkin-photos: users manage their own folder (delete)" on storage.objects;
create policy "checkin-photos: users manage their own folder (delete)"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'checkin-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. When each data export was made (one a day). Users can read their own;
-- only export_my_data() adds rows.
create table if not exists public.data_exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists data_exports_user_time on public.data_exports (user_id, created_at desc);
alter table public.data_exports enable row level security;
drop policy if exists "data_exports: users read their own" on public.data_exports;
create policy "data_exports: users read their own" on public.data_exports
  for select to authenticated using (user_id = auth.uid());

-- Wrong passwords given to delete_my_account(), to slow down guessing.
-- Row level security on and no policies: only the function touches it.
create table if not exists public.account_password_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists account_password_checks_user_time on public.account_password_checks (user_id, created_at);
alter table public.account_password_checks enable row level security;

-- Every row of the signed-in user, as { tables: { <table>: [rows] }, account },
-- or { error: 'export_limit', available_at } within a day of the last export.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  last_export timestamptz;
  tables jsonb := '{}'::jsonb;
  table_name text;
  table_rows jsonb;
begin
  if uid is null then
    return jsonb_build_object('error', 'not_signed_in');
  end if;
  -- One export at a time per user, so two taps cannot both get through.
  perform pg_advisory_xact_lock(hashtext('export:' || uid::text));
  select max(e.created_at) into last_export from public.data_exports e where e.user_id = uid;
  if last_export is not null and last_export > now() - interval '24 hours' then
    return jsonb_build_object('error', 'export_limit', 'available_at', last_export + interval '24 hours');
  end if;
  for table_name in
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where c.relkind in ('r', 'p') and c.relname not in ('data_exports', 'account_password_checks')
    order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.user_id::text = $1', table_name)
      into table_rows using uid::text;
    tables := tables || jsonb_build_object(table_name, table_rows);
  end loop;
  insert into public.data_exports (user_id) values (uid);
  return jsonb_build_object(
    'exported_at', now(),
    'tables', tables,
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'user_metadata', u.raw_user_meta_data)
                from auth.users u where u.id = uid)
  );
end;
$$;

-- Deletes the signed-in user's account after checking their password.
-- Returns 'ok' (password checked, with p_check_only), 'deleted',
-- 'wrong_password', 'too_many_attempts' or 'photos_remaining' (progress photos
-- are removed through the storage API first, which removes the files; deleting
-- storage rows here would leave the files behind). Every row with the user's
-- user_id is deleted from every public table, then the sign-in account.
-- Supabase keeps its own backups, which expire on their schedule.
create or replace function public.delete_my_account(p_password text, p_check_only boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  stored text;
  pending text[];
  failed text[] := '{}';
  table_name text;
  attempt integer;
begin
  if uid is null then
    return 'not_signed_in';
  end if;
  perform pg_advisory_xact_lock(hashtext('delete:' || uid::text));
  if (select count(*) from public.account_password_checks p
      where p.user_id = uid and p.created_at > now() - interval '15 minutes') >= 5 then
    return 'too_many_attempts';
  end if;
  select u.encrypted_password into stored from auth.users u where u.id = uid;
  if stored is null or stored = '' or extensions.crypt(coalesce(p_password, ''), stored) <> stored then
    insert into public.account_password_checks (user_id) values (uid);
    return 'wrong_password';
  end if;
  if p_check_only then
    return 'ok';
  end if;
  if exists (select 1 from storage.objects o
             where o.bucket_id = 'checkin-photos' and (storage.foldername(o.name))[1] = uid::text) then
    return 'photos_remaining';
  end if;
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into pending
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
  where c.relkind in ('r', 'p');
  -- A table referenced by another is retried after the other is emptied.
  for attempt in 1..6 loop
    failed := '{}';
    foreach table_name in array pending loop
      begin
        execute format('delete from public.%I where user_id::text = $1', table_name) using uid::text;
      exception when foreign_key_violation then
        failed := failed || table_name;
      end;
    end loop;
    exit when cardinality(failed) = 0;
    pending := failed;
  end loop;
  if cardinality(failed) > 0 then
    raise exception 'Could not delete rows from: %', array_to_string(failed, ', ');
  end if;
  delete from auth.users u where u.id = uid;
  return 'deleted';
end;
$$;

revoke all on function public.set_health_consent(text, boolean) from public, anon;
grant execute on function public.set_health_consent(text, boolean) to authenticated;
revoke all on function public.record_signup_health_consent() from public, anon, authenticated;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
revoke all on function public.delete_my_account(text, boolean) from public, anon;
grant execute on function public.delete_my_account(text, boolean) to authenticated;

notify pgrst, 'reload schema';
