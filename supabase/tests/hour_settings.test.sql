-- pgTAP: RLS and last-write-wins on public.hour_settings. Run with `supabase test db`.
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '', now(), now(), now(), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '', now(), now(), now(), '{}', '{}');

create or replace function pg_temp.become(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.value_of(k text) returns text language sql as $$
  select value from public.hour_settings where key = k
$$;

-- A's laptop pushes a day start it kept before settings synced: stamped 0.
select pg_temp.become('11111111-1111-1111-1111-111111111111');
insert into public.hour_settings (key, value, updated_at) values ('day.start', '6', 0);
select is((select user_id::text from public.hour_settings where key = 'day.start'),
  '11111111-1111-1111-1111-111111111111', 'user_id defaults to the caller');

-- A's phone kept another one: equal updated_at, the first stays.
insert into public.hour_settings (key, value, updated_at) values ('day.start', '4', 0)
on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
select is(pg_temp.value_of('day.start'), '6', 'a second device''s old setting does not replace the first');

-- A change made on any device is newer and lands; a stale one after it is dropped.
insert into public.hour_settings (key, value, updated_at) values ('day.start', '5', 2000)
on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
select is(pg_temp.value_of('day.start'), '5', 'a newer setting applies');
update public.hour_settings set value = '9', updated_at = 1999 where key = 'day.start';
select is(pg_temp.value_of('day.start'), '5', 'an older updated_at is dropped');

-- Chimes off is an empty value, not a missing row.
insert into public.hour_settings (key, value, updated_at) values ('chime.minutes', '', 3000);
select is(pg_temp.value_of('chime.minutes'), '', 'an empty value is stored');

select throws_ok($$ insert into public.hour_settings (key, value, updated_at) values ('', 'x', 1) $$,
  '23514', null, 'an empty key is rejected');
select throws_ok($$ delete from public.hour_settings $$, '42501', null, 'clients cannot delete');

-- B sees none of A's settings and cannot write into them.
select pg_temp.become('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.hour_settings), 0::bigint, 'B sees none of A''s settings');

select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.hour_settings $$, '42501', null, 'anon has no access');

select * from finish();
rollback;
