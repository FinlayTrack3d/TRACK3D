-- Personal reusable meals and dated meal plans for the nutrition section.
alter table if exists public.nutrition_plans
  add column if not exists meal_library jsonb not null default '[]'::jsonb,
  add column if not exists weekly_meal_plan jsonb not null default '{}'::jsonb;
