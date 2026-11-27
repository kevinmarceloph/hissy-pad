-- pgTAP: RLS and last-write-wins on public.nodes. Run with `supabase test db`.
begin;
select plan(45);

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

-- Pads: a root row with the flag; the column defaults to false and survives a write
-- from a client that does not send it (an older build editing the pad's name).
insert into public.nodes (id, parent_id, rank, text, pad, updated_at)
values ('aaaaaaaa-0000-0000-0000-000000000002', null, 'a1', 'Work', true, '2026-11-02T00:00:00Z');
select is((select pad from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000002'), true, 'a pad row keeps its flag');
select is((select pad from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), false, 'pad defaults to false');
insert into public.nodes (id, parent_id, rank, text, updated_at)
values ('aaaaaaaa-0000-0000-0000-000000000002', null, 'a1', 'Work, renamed', '2026-11-02T00:00:01Z')
on conflict (id) do update set text = excluded.text, updated_at = excluded.updated_at, rank = excluded.rank, parent_id = excluded.parent_id;
select is((select text || ':' || pad::text from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'Work, renamed:true',
  'an upsert without the pad column leaves the flag alone');

-- done_at: nullable timestamptz, written and cleared by the client like any other column.
select has_column('public', 'nodes', 'done_at', 'nodes has done_at');
select col_type_is('public', 'nodes', 'done_at', 'timestamp with time zone', 'done_at is timestamptz');
update public.nodes set done = true, done_at = '2026-11-02T00:00:05Z', updated_at = '2026-11-02T00:00:05Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select done_at from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '2026-11-02T00:00:05Z'::timestamptz, 'done_at round-trips');

-- slot: the hour a line is assigned to, 'YYYY-MM-DDTHH'; null by default, shape checked.
select is((select slot from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'slot defaults to null');
update public.nodes set slot = '2026-11-23T09', updated_at = '2026-11-23T00:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select slot from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '2026-11-23T09', 'slot round-trips');
select throws_ok(
  $$ update public.nodes set slot = '9am Monday', updated_at = '2026-11-23T00:00:01Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'a slot that is not a day and an hour is rejected');
update public.nodes set slot = '2026-11-23T22+4', updated_at = '2026-11-23T00:00:02Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select slot from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '2026-11-23T22+4', 'a run of hours round-trips');
select throws_ok(
  $$ update public.nodes set slot = '2026-11-23T22+', updated_at = '2026-11-23T00:00:03Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'a run without its length is rejected');
update public.nodes set slot = '2026-11-23T09,2026-11-23T14+2', updated_at = '2026-11-23T00:00:04Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select slot from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '2026-11-23T09,2026-11-23T14+2', 'hours apart round-trip');
select throws_ok(
  $$ update public.nodes set slot = '2026-11-23T09,', updated_at = '2026-11-23T00:00:05Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'a list that ends on a comma is rejected');

-- category: the id of one of Hours' categories; null by default, same length rule as its id.
select is((select category from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'category defaults to null');
update public.nodes set category = 'c-work', updated_at = '2026-11-24T00:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select category from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'c-work', 'category round-trips');
select throws_ok(
  $$ update public.nodes set category = '', updated_at = '2026-11-24T00:00:01Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'an empty category is rejected');

-- doing: the middle state, false by default.
select is((select doing from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), false, 'doing defaults to false');
update public.nodes set doing = true, updated_at = '2026-11-24T01:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select doing from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), true, 'doing round-trips');

-- pinned: kept at the top of its pad, false by default.
select is((select pinned from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), false, 'pinned defaults to false');
update public.nodes set pinned = true, updated_at = '2026-11-25T00:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select pinned from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), true, 'pinned round-trips');

-- divider: a section divider, false by default.
select is((select divider from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), false, 'divider defaults to false');
update public.nodes set divider = true, updated_at = '2026-11-25T00:00:00.5Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select divider from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), true, 'divider round-trips');

-- count_hidden: a pad's tab leaves out its count, false by default.
select is((select count_hidden from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), false, 'count_hidden defaults to false');
update public.nodes set count_hidden = true, updated_at = '2026-11-25T01:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count_hidden from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), true, 'count_hidden round-trips');

-- due and fresh (Boomerang): out until a day, then back with a mark.
select is((select due from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'due defaults to null');
select is((select fresh from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), false, 'fresh defaults to false');
update public.nodes set due = '2026-12-01', fresh = true, updated_at = '2026-11-25T02:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select due from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '2026-12-01', 'due round-trips');
select is((select fresh from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), true, 'fresh round-trips');

-- repeat and origin (recurring items): a template's rule, and the template an instance came from.
select is((select repeat from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'repeat defaults to null');
select is((select origin from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'origin defaults to null');
update public.nodes set repeat = '{"mode":"every","n":1,"unit":"w"}', origin = 'aaaaaaaa-0000-0000-0000-000000000002', updated_at = '2026-11-27T02:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select repeat from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '{"mode":"every","n":1,"unit":"w"}', 'repeat round-trips');
select is((select origin from public.nodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'aaaaaaaa-0000-0000-0000-000000000002', 'origin round-trips');

select * from finish();
rollback;
