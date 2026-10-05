-- Per-user rate limit for /api/chat, shared by every server instance.
-- chat_rate_check() is called by the API with the signed-in user's token:
-- it counts that user's requests in the last minute and day, records the new
-- one if allowed, and prunes rows older than a day. The table has row level
-- security on and no policies, so users cannot read, delete or add rows
-- directly; only the function (security definer) touches it.
-- Safe to run more than once. Run in Supabase Dashboard -> SQL Editor.
create table if not exists public.chat_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists chat_requests_user_time on public.chat_requests (user_id, created_at);
alter table public.chat_requests enable row level security;

create or replace function public.chat_rate_check(per_minute integer, per_day integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  minute_count integer;
  day_count integer;
begin
  if uid is null then return 'unauthorised'; end if;
  -- One check at a time per user, so parallel requests cannot all slip in.
  perform pg_advisory_xact_lock(hashtext(uid::text));
  delete from public.chat_requests where user_id = uid and created_at < now() - interval '1 day';
  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into minute_count, day_count
    from public.chat_requests where user_id = uid;
  if minute_count >= per_minute then return 'minute'; end if;
  if day_count >= per_day then return 'day'; end if;
  insert into public.chat_requests (user_id) values (uid);
  return 'ok';
end;
$$;

revoke all on function public.chat_rate_check(integer, integer) from public, anon;
grant execute on function public.chat_rate_check(integer, integer) to authenticated;

notify pgrst, 'reload schema';
