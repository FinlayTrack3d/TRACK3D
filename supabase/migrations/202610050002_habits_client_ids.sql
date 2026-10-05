-- habits.id: the app creates its own habit ids (supabase_setup.sql defines
-- id as client-supplied text). A live table created with an identity column
-- rejects them ("cannot insert a non-DEFAULT value into column id"). Stop the
-- database generating ids so the app's ids are accepted; existing ids and
-- rows are unchanged. Safe to run more than once.
do $$
declare
  col record;
begin
  select data_type, is_identity, column_default into col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'habits' and column_name = 'id';
  if col.is_identity = 'YES' then
    execute 'alter table public.habits alter column id drop identity';
  elsif col.column_default is not null then
    execute 'alter table public.habits alter column id drop default';
  end if;
  -- App ids are millisecond timestamps, too large for a 4-byte integer.
  if col.data_type in ('integer', 'smallint') then
    execute 'alter table public.habits alter column id type bigint';
  end if;
  -- Ticks store the same id, so they need room for it too.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'habit_completions'
               and column_name = 'habit_id' and data_type in ('integer', 'smallint')) then
    execute 'alter table public.habit_completions alter column habit_id type bigint';
  end if;
end $$;

notify pgrst, 'reload schema';
