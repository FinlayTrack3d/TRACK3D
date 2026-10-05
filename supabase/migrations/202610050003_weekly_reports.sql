-- Weekly reports: the table from supabase_setup.sql section 3, plus the row
-- level security policy it was missing. The live database returned 404 for
-- weekly_reports on 4 Oct 2026, so this was never applied there. Safe to run
-- more than once. Run in Supabase Dashboard -> SQL Editor.
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  week_start date not null,
  week_end date not null,
  patterns text,
  diet_suggestions text,
  created_at timestamptz not null default now()
);
-- Upserts use (user_id, report_date).
create unique index if not exists weekly_reports_user_id_report_date_key on public.weekly_reports (user_id, report_date);

alter table public.weekly_reports enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'weekly_reports') then
    create policy "weekly_reports: users manage their own rows" on public.weekly_reports
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

notify pgrst, 'reload schema';
