-- HissyPad: one table. Every client keeps a full local copy and syncs row by row.
--   updated_at  client clock; last write wins per row (enforced by the trigger below)
--   synced_at   server clock; the pull cursor ("give me everything that changed after X")
--   deleted_at  tombstone; clients never DELETE (the privilege is revoked)
-- parent_id is deliberately not a foreign key: rows from one device can arrive before
-- their parent from another, and the client repairs orphans to the root on read.
create table public.nodes (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id   uuid,
  rank        text not null,
  text        text not null default '',
  done        boolean not null default false,
  collapsed   boolean not null default false,
  numbered    boolean not null default false,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default clock_timestamp()
);

create index nodes_user_synced_idx on public.nodes (user_id, synced_at);

-- Last write wins, decided on the server so every device converges on the same row no
-- matter the arrival order. An older write is dropped silently (returning null skips the
-- update); the server clock stamps synced_at; the owner never changes.
create or replace function public.nodes_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at <= old.updated_at then
      return null;
    end if;
    new.user_id := old.user_id;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

create trigger nodes_before_write
  before insert or update on public.nodes
  for each row execute function public.nodes_before_write();

alter table public.nodes enable row level security;

-- (select auth.uid()) rather than auth.uid() so the planner evaluates it once per query.
create policy "own rows: select" on public.nodes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: insert" on public.nodes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "own rows: update" on public.nodes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Privileges are granted explicitly so the table works with the dashboard's "automatically
-- expose new tables" turned off. No delete privilege at all: tombstones are the only deletion.
revoke all on public.nodes from anon, authenticated;
grant select, insert, update on public.nodes to authenticated;

-- Realtime: clients subscribe to their own rows and use the event as a nudge to pull.
alter publication supabase_realtime add table public.nodes;
