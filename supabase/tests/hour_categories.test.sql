-- pgTAP: RLS and last-write-wins on public.hour_categories. Run with `supabase test db`.
begin;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '', now(), now(), now(), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '', now(), now(), now(), '{}', '{}');

create or replace function pg_temp.become(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.label_of(cid text) returns text language sql as $$
  select label from public.hour_categories where id = cid
$$;

-- A pushes a seeded category; user_id defaults to A.
select pg_temp.become('11111111-1111-1111-1111-111111111111');
insert into public.hour_categories (id, label, color, position, updated_at) values ('deep', 'Deep work', 'blue', 0, 0);

select is((select user_id::text from public.hour_categories where id = 'deep'),
  '11111111-1111-1111-1111-111111111111', 'user_id defaults to the caller');

select throws_ok(
  $$ insert into public.hour_categories (user_id, id, label, color, position, updated_at)
     values ('22222222-2222-2222-2222-222222222222', 'x', 'X', 'blue', 0, 0) $$,
  '42501', null, 'insert with another user_id is rejected by RLS');

select throws_ok(
  $$ insert into public.hour_categories (id, label, color, position, updated_at) values ('empty', '', 'blue', 1, 0) $$,
  '23514', null, 'an empty label is rejected');

-- B sees nothing of A's and owns the same id separately.
select pg_temp.become('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.hour_categories), 0::bigint, 'B sees none of A''s categories');
update public.hour_categories set label = 'hijack', updated_at = 9000 where id = 'deep';
insert into public.hour_categories (id, label, color, position, updated_at) values ('deep', 'Focus', 'moss', 0, 0);
select is(pg_temp.label_of('deep'), 'Focus', 'B has their own deep');

select pg_temp.become('11111111-1111-1111-1111-111111111111');
select is(pg_temp.label_of('deep'), 'Deep work', 'B''s update did not reach A''s row');

-- A second device seeds the same row again: equal updated_at, dropped.
insert into public.hour_categories (id, label, color, position, updated_at) values ('deep', 'Deep work', 'blue', 0, 0)
on conflict (user_id, id) do update
  set label = excluded.label, color = excluded.color, position = excluded.position,
      archived = excluded.archived, updated_at = excluded.updated_at;
select is((select count(*) from public.hour_categories), 1::bigint, 'a second seed of the same id does not duplicate');

-- A rename is newer and lands; a stale write after it is dropped.
update public.hour_categories set label = 'Focus work', color = 'indigo', updated_at = 2000 where id = 'deep';
select is((select label || '|' || color from public.hour_categories where id = 'deep'),
  'Focus work|indigo', 'a newer rename and recolor applies');
update public.hour_categories set label = 'stale', updated_at = 1999 where id = 'deep';
select is(pg_temp.label_of('deep'), 'Focus work', 'an older updated_at is dropped');

-- Archiving is a newer row, not a delete.
update public.hour_categories set archived = true, updated_at = 3000 where id = 'deep';
select is((select archived from public.hour_categories where id = 'deep'), true, 'archive is an update');
select throws_ok($$ delete from public.hour_categories $$, '42501', null, 'clients cannot delete');

select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.hour_categories $$, '42501', null, 'anon has no access');

select * from finish();
rollback;
