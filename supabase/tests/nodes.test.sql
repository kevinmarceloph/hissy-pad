-- pgTAP: RLS and last-write-wins on public.nodes. Run with `supabase test db`.
begin;
select plan(13);

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

-- A writes a row; user_id defaults to A.
select pg_temp.become('11111111-1111-1111-1111-111111111111');
insert into public.nodes (id, parent_id, rank, text, updated_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', null, 'a0', 'hello', '2026-10-28T00:00:01Z');

select is((select user_id::text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111', 'user_id defaults to the caller');
select is((select count(*) from public.nodes), 1::bigint, 'A sees A''s row');

-- A cannot plant a row on B.
select throws_ok(
  $$ insert into public.nodes (id, user_id, rank, text, updated_at)
     values ('aaaaaaaa-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'a0', 'x', now()) $$,
  '42501', null, 'insert with another user_id is rejected by RLS');

-- B sees nothing and cannot touch A's row.
select pg_temp.become('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.nodes), 0::bigint, 'B sees none of A''s rows');
update public.nodes set text = 'hijack', updated_at = '2030-01-01T00:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.become('11111111-1111-1111-1111-111111111111');
select is((select text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'hello', 'B''s update did not apply');

-- Last write wins on updated_at, enforced by the trigger.
update public.nodes set text = 'stale', updated_at = '2026-10-28T00:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'hello', 'an older updated_at is dropped');
update public.nodes set text = 'same', updated_at = '2026-10-28T00:00:01Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'hello', 'an equal updated_at is dropped too');

select synced_at as before_sync from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001' \gset
update public.nodes set text = 'newer', updated_at = '2026-10-28T00:00:02Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'newer', 'a newer updated_at applies');
select ok((select synced_at from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001') > :'before_sync'::timestamptz,
  'synced_at advances on a real update');

-- The owner cannot be changed by the client.
update public.nodes set user_id = '22222222-2222-2222-2222-222222222222', updated_at = '2026-10-28T00:00:03Z'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select user_id::text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111', 'user_id cannot be reassigned');

-- Upsert is how clients push: a replayed batch is harmless.
insert into public.nodes (id, parent_id, rank, text, updated_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', null, 'a0', 'replayed older', '2026-10-28T00:00:01Z')
on conflict (id) do update set text = excluded.text, updated_at = excluded.updated_at, rank = excluded.rank, parent_id = excluded.parent_id;
select is((select text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'newer', 'replaying an older upsert changes nothing');

-- Tombstones are the only deletion.
select throws_ok(
  $$ delete from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', null, 'DELETE is revoked for authenticated');
update public.nodes set deleted_at = '2026-10-28T00:00:04Z', updated_at = '2026-10-28T00:00:04Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select isnt((select deleted_at from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'tombstone applies');

select * from finish();
rollback;
