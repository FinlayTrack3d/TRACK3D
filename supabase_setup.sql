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
