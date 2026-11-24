-- pgTAP: RLS and last-write-wins on public.hour_entries. Run with `supabase test db`.
begin;
select plan(19);

-- Two users, created directly (no GoTrue in a db test).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '', now(), now(), now(), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '', now(), now(), now(), '{}', '{}');

create or replace function pg_temp.become(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.note_at(h int) returns text language sql as $$
  select note from public.hour_entries where day = '2026-11-19' and hour = h
$$;

-- A logs 9am; user_id defaults to A.
select pg_temp.become('11111111-1111-1111-1111-111111111111');
insert into public.hour_entries (day, hour, note, category, updated_at)
values ('2026-11-19', 9, 'proposals', 'deep', 1000);

select is((select user_id::text from public.hour_entries where hour = 9),
  '11111111-1111-1111-1111-111111111111', 'user_id defaults to the caller');
select is((select count(*) from public.hour_entries), 1::bigint, 'A sees A''s row');

-- A cannot plant a row on B.
select throws_ok(
  $$ insert into public.hour_entries (user_id, day, hour, note, updated_at)
     values ('22222222-2222-2222-2222-222222222222', '2026-11-19', 10, 'x', 1000) $$,
  '42501', null, 'insert with another user_id is rejected by RLS');

-- An hour is 0-23.
select throws_ok(
  $$ insert into public.hour_entries (day, hour, note, updated_at) values ('2026-11-19', 24, 'x', 1000) $$,
  '23514', null, 'hour 24 is rejected');

-- B sees nothing, cannot touch A's row, and owns the same slot separately.
select pg_temp.become('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.hour_entries), 0::bigint, 'B sees none of A''s rows');
update public.hour_entries set note = 'hijack', updated_at = 9000 where hour = 9;
insert into public.hour_entries (day, hour, note, updated_at) values ('2026-11-19', 9, 'B''s own 9am', 1000);
select is(pg_temp.note_at(9), 'B''s own 9am', 'B has their own 9am');

select pg_temp.become('11111111-1111-1111-1111-111111111111');
select is(pg_temp.note_at(9), 'proposals', 'B''s update did not reach A''s row');

-- Last write wins on updated_at, enforced by the trigger.
update public.hour_entries set note = 'stale', updated_at = 999 where hour = 9;
select is(pg_temp.note_at(9), 'proposals', 'an older updated_at is dropped');
update public.hour_entries set note = 'same', updated_at = 1000 where hour = 9;
select is(pg_temp.note_at(9), 'proposals', 'an equal updated_at is dropped too');

select synced_at as before_sync from public.hour_entries where hour = 9 \gset
update public.hour_entries set note = 'proposals, then email', updated_at = 2000 where hour = 9;
select is(pg_temp.note_at(9), 'proposals, then email', 'a newer updated_at applies');
select ok((select synced_at from public.hour_entries where hour = 9) > :'before_sync'::timestamptz,
  'synced_at advances on a real update');

-- The owner cannot be changed by the client.
update public.hour_entries set user_id = '22222222-2222-2222-2222-222222222222', updated_at = 3000 where hour = 9;
select is((select user_id::text from public.hour_entries where hour = 9),
  '11111111-1111-1111-1111-111111111111', 'user_id cannot be reassigned');

-- Upsert on the slot is how clients push: a replayed batch is harmless, a newer one lands.
insert into public.hour_entries (day, hour, note, category, updated_at)
values ('2026-11-19', 9, 'replayed older', 'deep', 1000)
on conflict (user_id, day, hour) do update
  set note = excluded.note, category = excluded.category, updated_at = excluded.updated_at;
select is(pg_temp.note_at(9), 'proposals, then email', 'a replayed older upsert is dropped');

-- Clearing an hour is a newer empty row, not a delete.
insert into public.hour_entries (day, hour, note, category, updated_at)
values ('2026-11-19', 9, '', null, 4000)
on conflict (user_id, day, hour) do update
  set note = excluded.note, category = excluded.category, updated_at = excluded.updated_at;
select is((select note || '|' || coalesce(category, 'null') from public.hour_entries where hour = 9),
  '|null', 'a newer empty upsert clears the hour');

-- An hour has a state: open until said otherwise, and one of three.
select is((select state from public.hour_entries where hour = 9), 'open', 'state defaults to open');
update public.hour_entries set state = 'done', updated_at = 5000 where hour = 9;
select is((select state from public.hour_entries where hour = 9), 'done', 'an hour can be marked done');
select throws_ok(
  $$ update public.hour_entries set state = 'kept', updated_at = 6000 where hour = 9 $$,
  '23514', null, 'a state outside open, doing, done is rejected');

select throws_ok($$ delete from public.hour_entries $$, '42501', null, 'clients cannot delete');

-- Signed-out callers get nothing.
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.hour_entries $$, '42501', null, 'anon has no access');

select * from finish();
rollback;
