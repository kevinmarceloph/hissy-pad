-- pgTAP: RLS and last-write-wins on public.hour_flags, and the flags column on
-- public.hour_entries. Run with `supabase test db`.
begin;
select plan(23);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '', now(), now(), now(), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '', now(), now(), now(), '{}', '{}');

create or replace function pg_temp.become(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.label_of(fid text) returns text language sql as $$
  select label from public.hour_flags where id = fid
$$;

-- A pushes a seeded flag; user_id defaults to A.
select pg_temp.become('11111111-1111-1111-1111-111111111111');
insert into public.hour_flags (id, label, position, updated_at) values ('halts', 'HALTS', 2, 0);

select is((select user_id::text from public.hour_flags where id = 'halts'),
  '11111111-1111-1111-1111-111111111111', 'user_id defaults to the caller');

select throws_ok(
  $$ insert into public.hour_flags (user_id, id, label, position, updated_at)
     values ('22222222-2222-2222-2222-222222222222', 'x', 'X', 0, 0) $$,
  '42501', null, 'insert with another user_id is rejected by RLS');

select throws_ok(
  $$ insert into public.hour_flags (id, label, position, updated_at) values ('empty', '', 1, 0) $$,
  '23514', null, 'an empty label is rejected');

-- B sees nothing of A's and owns the same id separately.
select pg_temp.become('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.hour_flags), 0::bigint, 'B sees none of A''s flags');
update public.hour_flags set label = 'hijack', updated_at = 9000 where id = 'halts';
insert into public.hour_flags (id, label, position, updated_at) values ('halts', 'Hungry or tired', 0, 0);

select pg_temp.become('11111111-1111-1111-1111-111111111111');
select is(pg_temp.label_of('halts'), 'HALTS', 'B''s update did not reach A''s row');

-- A second device seeds the same row again: equal updated_at, dropped.
insert into public.hour_flags (id, label, position, updated_at) values ('halts', 'HALTS', 2, 0)
on conflict (user_id, id) do update
  set label = excluded.label, position = excluded.position,
      archived = excluded.archived, updated_at = excluded.updated_at;
select is((select count(*) from public.hour_flags), 1::bigint, 'a second seed of the same id does not duplicate');

-- A rename is newer and lands; a stale write after it is dropped.
update public.hour_flags set label = 'Hungry or tired', updated_at = 2000 where id = 'halts';
select is(pg_temp.label_of('halts'), 'Hungry or tired', 'a newer rename applies');
update public.hour_flags set label = 'stale', updated_at = 1999 where id = 'halts';
select is(pg_temp.label_of('halts'), 'Hungry or tired', 'an older updated_at is dropped');

-- A flag written without an icon has none; an icon is stored and limited in length.
select is((select icon from public.hour_flags where id = 'halts'), '', 'a row from an older client has no icon');
update public.hour_flags set icon = '🛑', updated_at = 2500 where id = 'halts';
select is((select icon from public.hour_flags where id = 'halts'), '🛑', 'an icon is stored');

-- A flag written without options has the list every device starts with; options are
-- stored, and the list cannot be empty, too long or something other than a list.
select is((select options::text from public.hour_flags where id = 'halts'),
  '[{"id": "yes", "color": "blue", "label": "Yes"}, {"id": "no", "color": "rose", "label": "No"}]',
  'a row from an older client has Yes and No');
update public.hour_flags
  set options = '[{"id":"yes","label":"Hungry","color":"ochre"},{"id":"o1a2b3","label":"Tired","color":"night"},{"id":"no","label":"No","color":"rose","archived":true}]',
      updated_at = 2600
  where id = 'halts';
select is((select options -> 1 ->> 'label' from public.hour_flags where id = 'halts'), 'Tired', 'options are stored');
select throws_ok($$ update public.hour_flags set options = '[]', updated_at = 2700 where id = 'halts' $$,
  '23514', null, 'an empty option list is rejected');
select throws_ok($$ update public.hour_flags set options = '{"id":"yes"}', updated_at = 2700 where id = 'halts' $$,
  '23514', null, 'options must be a list');

-- Archiving is a newer row, not a delete.
update public.hour_flags set archived = true, updated_at = 3000 where id = 'halts';
select is((select archived from public.hour_flags where id = 'halts'), true, 'archive is an update');
select throws_ok($$ delete from public.hour_flags $$, '42501', null, 'clients cannot delete');

-- An hour carries its flags; a row written without them reads as no flags. The plan
-- columns are gone (2026-11-27).
select hasnt_column('public', 'hour_entries', 'planned', 'the plan column is dropped');
select hasnt_column('public', 'hour_entries', 'planned_note', 'the plan words column is dropped');
insert into public.hour_entries (day, hour, note, category, updated_at) values ('2026-11-20', 8, 'email', 'admin', 1);
select is((select cardinality(flags) from public.hour_entries where hour = 8), 0, 'an older client''s row has no flags');

insert into public.hour_entries (day, hour, note, category, flags, updated_at)
values ('2026-11-20', 9, 'scrolled', 'drift', '{distracted,halts}', 1);
select is((select array_to_string(flags, ',') from public.hour_entries where hour = 9),
  'distracted,halts', 'the flags are stored');

-- An older client edits the hour without sending the flags: they are kept.
insert into public.hour_entries (day, hour, note, category, updated_at) values ('2026-11-20', 9, 'scrolled a lot', 'drift', 2)
on conflict (user_id, day, hour) do update
  set note = excluded.note, category = excluded.category, updated_at = excluded.updated_at;
select is((select note || '|' || array_to_string(flags, ',') from public.hour_entries where hour = 9),
  'scrolled a lot|distracted,halts', 'an upsert that leaves the flags out keeps them');

-- A flag's answer is a token in the same array, beside tokens from before options.
update public.hour_entries set flags = '{distracted,halts:o1a2b3,mindful:no}', updated_at = 3 where hour = 9;
select is((select array_to_string(flags, ',') from public.hour_entries where hour = 9),
  'distracted,halts:o1a2b3,mindful:no', 'an answer is stored as flag:option');

select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.hour_flags $$, '42501', null, 'anon has no access');

select * from finish();
rollback;
