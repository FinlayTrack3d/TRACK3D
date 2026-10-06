-- Read-only check after deleting a test account (Profile -> Account ->
-- Delete my account). Put the test account's user id on the next line, then
-- run in Supabase Dashboard -> SQL Editor. Every line should show 0: no rows
-- in any table that has a user_id column, no photos in its storage folder
-- and no sign-in account.
with target as (select '00000000-0000-0000-0000-000000000000'::text as id)
select c.relname::text as place,
       (xpath('/row/n/text()', query_to_xml(
         format('select count(*) as n from public.%I where user_id::text = %L', c.relname, (select id from target)),
         false, true, '')))[1]::text::int as rows_left
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
where c.relkind in ('r', 'p')
union all
select 'storage: checkin-photos/<user id>/', count(*)::int
from storage.objects
where bucket_id = 'checkin-photos' and (storage.foldername(name))[1] = (select id from target)
union all
select 'auth.users (the sign-in account)', count(*)::int
from auth.users
where id::text = (select id from target)
order by 2 desc, 1;
