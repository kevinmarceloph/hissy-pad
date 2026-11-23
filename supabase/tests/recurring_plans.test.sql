-- pgTAP: RLS, last-write-wins and the checks on public.recurring_plans, and the longer
-- names on public.hour_categories and public.hour_flags. Run with `supabase test db`.
begin;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '', now(), now(), now(), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '', now(), now(), now(), '{}', '{}');

create or replace function pg_temp.become(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.note_of(pid text) returns text language sql as $$
  select note from public.recurring_plans where id = pid
$$;

-- A pushes a plan; user_id defaults to A.
select pg_temp.become('11111111-1111-1111-1111-111111111111');
insert into public.recurring_plans (id, note, category, from_hour, to_hour, days, since, position, updated_at)
values ('rsleep0001', 'sleep', 'sleep', 2, 10, '{0,1,2,3,4,5,6}', '2026-11-21', 0, 1000);

select is((select user_id::text from public.recurring_plans where id = 'rsleep0001'),
  '11111111-1111-1111-1111-111111111111', 'user_id defaults to the caller');
select is((select from_hour || '-' || to_hour || ' ' || array_to_string(days, '') || ' ' || since from public.recurring_plans where id = 'rsleep0001'),
  '2-10 0123456 2026-11-21', 'the run, the days and the first day are stored');

select throws_ok(
  $$ insert into public.recurring_plans (user_id, id, from_hour, to_hour, days, since, position, updated_at)
     values ('22222222-2222-2222-2222-222222222222', 'x', 1, 2, '{1}', '2026-11-21', 0, 0) $$,
  '42501', null, 'insert with another user_id is rejected by RLS');
select throws_ok(
  $$ insert into public.recurring_plans (id, from_hour, to_hour, days, since, position, updated_at)
     values ('late', 22, 24, '{1}', '2026-11-21', 1, 0) $$,
  '23514', null, 'hour 24 is rejected');
select throws_ok(
  $$ insert into public.recurring_plans (id, from_hour, to_hour, days, since, position, updated_at)
     values ('eighth', 9, 10, '{7}', '2026-11-21', 1, 0) $$,
  '23514', null, 'a weekday past 6 is rejected');

-- A run across midnight on two days, with words alone.
insert into public.recurring_plans (id, note, from_hour, to_hour, days, since, position, updated_at)
values ('rnight0001', 'night shift', 22, 6, '{5,6}', '2026-11-21', 1, 1000);
select is((select coalesce(category, 'null') || ' ' || from_hour || '-' || to_hour from public.recurring_plans where id = 'rnight0001'),
  'null 22-6', 'a run across midnight with no category is stored');

-- B sees nothing of A's and owns the same id separately.
select pg_temp.become('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.recurring_plans), 0::bigint, 'B sees none of A''s plans');
update public.recurring_plans set note = 'hijack', updated_at = 9000 where id = 'rsleep0001';
insert into public.recurring_plans (id, note, from_hour, to_hour, days, since, position, updated_at)
values ('rsleep0001', 'nap', 13, 14, '{0}', '2026-11-21', 0, 1);

select pg_temp.become('11111111-1111-1111-1111-111111111111');
select is(pg_temp.note_of('rsleep0001'), 'sleep', 'B''s update did not reach A''s row');

-- A newer edit lands; a stale write after it is dropped.
update public.recurring_plans set note = 'sleep, no phone', to_hour = 9, updated_at = 2000 where id = 'rsleep0001';
select is(pg_temp.note_of('rsleep0001'), 'sleep, no phone', 'a newer edit applies');
update public.recurring_plans set note = 'stale', updated_at = 1999 where id = 'rsleep0001';
select is(pg_temp.note_of('rsleep0001'), 'sleep, no phone', 'an older updated_at is dropped');

-- Removing a plan is a newer row, not a delete.
update public.recurring_plans set archived = true, updated_at = 3000 where id = 'rsleep0001';
select is((select archived from public.recurring_plans where id = 'rsleep0001'), true, 'archive is an update');
select throws_ok($$ delete from public.recurring_plans $$, '42501', null, 'clients cannot delete');

-- Names: 48 characters fit, 49 do not, for a category and for a flag.
insert into public.hour_categories (id, label, color, position, updated_at) values ('long', repeat('x', 48), 'blue', 0, 1);
select is((select char_length(label) from public.hour_categories where id = 'long'), 48, 'a category name of 48 characters is stored');
select throws_ok(
  $$ insert into public.hour_categories (id, label, color, position, updated_at) values ('longer', repeat('x', 49), 'blue', 1, 1) $$,
  '23514', null, 'a category name of 49 characters is rejected');
insert into public.hour_flags (id, label, position, updated_at) values ('long', repeat('x', 48), 0, 1);
select is((select char_length(label) from public.hour_flags where id = 'long'), 48, 'a flag name of 48 characters is stored');
select throws_ok(
  $$ insert into public.hour_flags (id, label, position, updated_at) values ('longer', repeat('x', 49), 1, 1) $$,
  '23514', null, 'a flag name of 49 characters is rejected');

select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.recurring_plans $$, '42501', null, 'anon has no access');

select * from finish();
rollback;
