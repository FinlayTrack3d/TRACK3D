-- TRACK3D Fitness Coaching V1.2
-- Additive migration only. It does not drop, rename, or rewrite existing tables.

create extension if not exists pgcrypto;

create table if not exists public.coach_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personality text not null default 'balanced' check (personality in ('strict','balanced','supportive')),
  experience_level text,
  primary_goal text,
  priority_muscles text[] not null default '{}',
  typical_availability jsonb not null default '{}'::jsonb,
  equipment_context jsonb not null default '{}'::jsonb,
  explanation_depth text not null default 'concise' check (explanation_depth in ('concise','standard','detailed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_programmes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('draft','active','completed','archived')),
  started_on date,
  review_on date,
  source text not null default 'track3d',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.programme_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  programme_id uuid not null references public.training_programmes(id) on delete cascade,
  session_key text not null,
  exercise_key text not null,
  exercise_name text not null,
  position integer not null,
  prescription_type text not null default 'straight_sets' check (prescription_type in ('straight_sets','top_backoff')),
  prescribed_sets integer not null check (prescribed_sets > 0),
  rep_min integer,
  rep_max integer,
  prescription jsonb not null default '{}'::jsonb,
  rest_seconds integer,
  tempo text,
  top_tips text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programme_id, session_key, exercise_key)
);

create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  programme_id uuid references public.training_programmes(id) on delete set null,
  legacy_workout_log_id text,
  session_key text,
  session_name text not null,
  planned_for date,
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  status text not null default 'in_progress' check (status in ('planned','in_progress','completed','missed','cancelled')),
  temporary_context jsonb not null default '{}'::jsonb,
  achievement jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.training_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  programme_exercise_id uuid references public.programme_exercises(id) on delete set null,
  exercise_key text not null,
  exercise_name text not null,
  set_index integer not null,
  set_kind text not null default 'working' check (set_kind in ('warmup','working','extra')),
  weight numeric(8,2),
  reps integer,
  prescribed_weight numeric(8,2),
  rep_min integer,
  rep_max integer,
  completed boolean not null default true,
  form_feedback text check (form_feedback in ('solid','could_be_better') or form_feedback is null),
  progression_decision jsonb,
  performed_at timestamptz not null default now(),
  unique (session_id, exercise_key, set_index, set_kind)
);

create table if not exists public.exercise_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_key text,
  exercise_name text not null,
  preference text not null check (preference in ('like','dislike','avoid','favourite')),
  reason text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('goal','priority','exercise_preference','equipment','availability','schedule','communication')),
  memory_key text not null,
  value jsonb not null,
  evidence text,
  confidence numeric(3,2) not null default 0.7 check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('candidate','active','superseded','dismissed')),
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, memory_key)
);

create table if not exists public.pain_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.training_sessions(id) on delete set null,
  exercise_key text,
  body_area text,
  report text not null,
  severity text not null default 'unspecified' check (severity in ('unspecified','mild','moderate','concerning')),
  status text not null default 'active' check (status in ('active','monitoring','resolved')),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  activity_type text not null,
  duration_minutes integer,
  steps integer,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.coach_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content text not null,
  structured_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.coach_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.coach_conversations(id) on delete set null,
  action_type text not null,
  scope text not null check (scope in ('today','this_week','next_session','temporary','permanent')),
  payload jsonb not null,
  rationale text,
  status text not null default 'ready' check (status in ('ready','pending_approval','approved','applied','rejected','expired','failed')),
  approved_at timestamptz,
  applied_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workout_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null references public.coach_actions(id) on delete cascade,
  session_id uuid references public.training_sessions(id) on delete cascade,
  override_type text not null,
  payload jsonb not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists training_sessions_user_completed_idx on public.training_sessions(user_id, completed_at desc);
create index if not exists training_sets_user_exercise_idx on public.training_sets(user_id, exercise_key, performed_at desc);
create index if not exists coach_messages_user_created_idx on public.coach_messages(user_id, created_at desc);
create index if not exists coach_memories_user_active_idx on public.coach_memories(user_id, status, category);
create index if not exists pain_reports_user_active_idx on public.pain_reports(user_id, status, reported_at desc);
create index if not exists activity_logs_user_date_idx on public.activity_logs(user_id, activity_date desc);
create index if not exists coach_actions_user_status_idx on public.coach_actions(user_id, status, created_at desc);

alter table public.coach_profiles enable row level security;
alter table public.training_programmes enable row level security;
alter table public.programme_exercises enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_sets enable row level security;
alter table public.exercise_preferences enable row level security;
alter table public.coach_memories enable row level security;
alter table public.pain_reports enable row level security;
alter table public.activity_logs enable row level security;
alter table public.coach_conversations enable row level security;
alter table public.coach_messages enable row level security;
alter table public.coach_actions enable row level security;
alter table public.workout_overrides enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['coach_profiles','training_programmes','programme_exercises','training_sessions','training_sets','exercise_preferences','coach_memories','pain_reports','activity_logs','coach_conversations','coach_messages','coach_actions','workout_overrides']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format('create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', table_name || '_owner_all', table_name);
  end loop;
end $$;

create or replace function public.get_coach_recent_context(window_days integer default 14)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'window_start', now() - make_interval(days => greatest(1, least(window_days, 30))),
    'profile', (select to_jsonb(p) - 'user_id' from coach_profiles p where p.user_id = auth.uid()),
    'memories', coalesce((select jsonb_agg(to_jsonb(m) - 'user_id' order by m.updated_at desc) from coach_memories m where m.user_id = auth.uid() and m.status = 'active'), '[]'::jsonb),
    'active_pain', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id' order by p.reported_at desc) from pain_reports p where p.user_id = auth.uid() and p.status <> 'resolved'), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id' order by coalesce(s.completed_at,s.created_at) desc) from training_sessions s where s.user_id = auth.uid() and coalesce(s.completed_at,s.created_at) >= now() - make_interval(days => greatest(1, least(window_days, 30)))), '[]'::jsonb),
    'sets', coalesce((select jsonb_agg(to_jsonb(ts) - 'user_id' order by ts.performed_at desc) from training_sets ts where ts.user_id = auth.uid() and ts.performed_at >= now() - make_interval(days => greatest(1, least(window_days, 30)))), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.activity_date desc) from activity_logs a where a.user_id = auth.uid() and a.activity_date >= current_date - greatest(1, least(window_days, 30))), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(cm) - 'user_id' order by cm.created_at desc) from (select * from coach_messages where user_id = auth.uid() and created_at >= now() - make_interval(days => greatest(1, least(window_days, 30))) order by created_at desc limit 100) cm), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(to_jsonb(ca) - 'user_id' order by ca.created_at desc) from coach_actions ca where ca.user_id = auth.uid() and ca.created_at >= now() - make_interval(days => greatest(1, least(window_days, 30)))), '[]'::jsonb)
  );
$$;

create or replace function public.search_training_history(
  exercise_search text default null,
  from_date date default null,
  to_date date default null,
  result_limit integer default 50
)
returns table (
  performed_at timestamptz,
  session_name text,
  exercise_name text,
  set_index integer,
  weight numeric,
  reps integer,
  set_kind text,
  form_feedback text
)
language sql
stable
security invoker
set search_path = public
as $$
  select ts.performed_at, s.session_name, ts.exercise_name, ts.set_index, ts.weight, ts.reps, ts.set_kind, ts.form_feedback
  from training_sets ts
  join training_sessions s on s.id = ts.session_id and s.user_id = auth.uid()
  where ts.user_id = auth.uid()
    and (exercise_search is null or ts.exercise_name ilike '%' || exercise_search || '%')
    and (from_date is null or ts.performed_at::date >= from_date)
    and (to_date is null or ts.performed_at::date <= to_date)
  order by ts.performed_at desc
  limit greatest(1, least(result_limit, 200));
$$;

create or replace function public.apply_coach_action(action_uuid uuid, approve_permanent boolean default false)
returns public.coach_actions
language plpgsql
security invoker
set search_path = public
as $$
declare action_row public.coach_actions;
begin
  select * into action_row from coach_actions where id = action_uuid and user_id = auth.uid() for update;
  if not found then raise exception 'Coach action not found'; end if;
  if action_row.status in ('applied','rejected','expired') then raise exception 'Coach action is already final'; end if;
  if action_row.scope = 'permanent' and not approve_permanent then raise exception 'Permanent changes require explicit approval'; end if;

  if action_row.action_type = 'propose_permanent_set_change' then
    update programme_exercises
      set prescribed_sets = (action_row.payload->>'setCount')::integer, updated_at = now()
      where id = (action_row.payload->>'programmeExerciseId')::uuid and user_id = auth.uid();
  elsif action_row.action_type = 'propose_permanent_exercise_swap' then
    update programme_exercises
      set exercise_key = action_row.payload->>'replacementExerciseId', exercise_name = coalesce(action_row.payload->>'replacementExerciseName', action_row.payload->>'replacementExerciseId'), updated_at = now()
      where id = (action_row.payload->>'programmeExerciseId')::uuid and user_id = auth.uid();
  elsif action_row.scope <> 'permanent' then
    insert into workout_overrides(user_id, action_id, session_id, override_type, payload, expires_at)
    values (auth.uid(), action_row.id, nullif(action_row.payload->>'workoutId','')::uuid, action_row.action_type, action_row.payload,
      case when action_row.scope = 'this_week' then now() + interval '7 days' else now() + interval '1 day' end);
  end if;

  update coach_actions set status = 'applied', approved_at = case when scope = 'permanent' then now() else approved_at end, applied_at = now()
  where id = action_row.id returning * into action_row;
  return action_row;
end;
$$;

grant execute on function public.get_coach_recent_context(integer) to authenticated;
grant execute on function public.search_training_history(text,date,date,integer) to authenticated;
grant execute on function public.apply_coach_action(uuid,boolean) to authenticated;

