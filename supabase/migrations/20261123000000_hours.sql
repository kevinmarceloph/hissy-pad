-- Hours: Oras-oras inside HissyPad. Four tables, synced the way nodes are: every device
-- keeps a full local copy, pushes its dirty rows and pulls by synced_at.
--   hour_entries     one row per hour slot: the plan and what happened
--   hour_categories  the user's own list of where an hour can go
--   hour_flags       the user's own questions about an hour, each with its answers
--   recurring_plans  plans that repeat over a run of hours on chosen weekdays
-- These came over from Oras-oras as they stood on 2026-11-21, so two things differ from
-- public.nodes on purpose:
--   updated_at  is the client clock in ms since epoch (bigint), exactly as the device
--               stores it; last write wins per row (the trigger below)
--   no deleted_at: an hour is cleared by writing an empty row, a list row is archived.
--               Clients never DELETE (the privilege is not granted).
-- Nothing is seeded: the lists start empty. A category or flag id on an hour is free text,
-- not a foreign key, because an hour may arrive before the row it points at.

-- Last write wins, decided on the server so every device converges on the same row no
-- matter the arrival order. An older or equal write is dropped silently (returning null
-- skips the update); the server clock stamps synced_at; a row never changes owner.
create or replace function public.hours_before_write()
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

create table public.hour_entries (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day          date not null,
  hour         smallint not null check (hour between 0 and 23),
  -- What happened, in words, and where the hour went: a category id.
  note         text not null default '' check (char_length(note) <= 280),
  category     text check (category is null or char_length(category) <= 32),
  -- What was meant to happen, and where the hour was meant to go.
  planned_note text not null default '' check (char_length(planned_note) <= 280),
  planned      text check (planned is null or char_length(planned) <= 32),
  -- One token per answered flag, "flag:option".
  flags        text[] not null default '{}' check (cardinality(flags) <= 64),
  updated_at  bigint not null,
  synced_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, day, hour)
);

create index hour_entries_user_synced_idx on public.hour_entries (user_id, synced_at);

create trigger hour_entries_before_write
  before insert or update on public.hour_entries
  for each row execute function public.hours_before_write();

alter table public.hour_entries enable row level security;

-- (select auth.uid()) rather than auth.uid() so the planner evaluates it once per query.
create policy "own rows: select" on public.hour_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: insert" on public.hour_entries
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "own rows: update" on public.hour_entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.hour_entries from anon, authenticated;
grant select, insert, update on public.hour_entries to authenticated;

-- Realtime: clients subscribe to their own rows and use the event as a nudge to pull.
alter publication supabase_realtime add table public.hour_entries;

create table public.hour_categories (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (char_length(id) between 1 and 32),
  label       text not null check (char_length(label) between 1 and 48),
  -- A color key from the app's palette. Free text on purpose: an older schema must not
  -- reject a color a newer app added. The app reads a key it does not know as stone.
  color       text not null check (char_length(color) between 1 and 16),
  position    integer not null,
  archived    boolean not null default false,
  updated_at  bigint not null,
  synced_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index hour_categories_user_synced_idx on public.hour_categories (user_id, synced_at);

create trigger hour_categories_before_write
  before insert or update on public.hour_categories
  for each row execute function public.hours_before_write();

alter table public.hour_categories enable row level security;

-- (select auth.uid()) rather than auth.uid() so the planner evaluates it once per query.
create policy "own rows: select" on public.hour_categories
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: insert" on public.hour_categories
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "own rows: update" on public.hour_categories
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.hour_categories from anon, authenticated;
grant select, insert, update on public.hour_categories to authenticated;

-- Realtime: clients subscribe to their own rows and use the event as a nudge to pull.
alter publication supabase_realtime add table public.hour_categories;

create table public.hour_flags (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (char_length(id) between 1 and 32),
  label       text not null check (char_length(label) between 1 and 48),
  -- One emoji that stands for the flag on an hour's row; '' for none.
  icon        text not null default '' check (char_length(icon) <= 16),
  -- The answers, in the editor's order: [{"id", "label", "color"[, "archived": true]}].
  options     jsonb not null
    default '[{"id":"yes","label":"Yes","color":"blue"},{"id":"no","label":"No","color":"rose"}]'::jsonb
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 8),
  position    integer not null,
  archived    boolean not null default false,
  updated_at  bigint not null,
  synced_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index hour_flags_user_synced_idx on public.hour_flags (user_id, synced_at);

create trigger hour_flags_before_write
  before insert or update on public.hour_flags
  for each row execute function public.hours_before_write();

alter table public.hour_flags enable row level security;

-- (select auth.uid()) rather than auth.uid() so the planner evaluates it once per query.
create policy "own rows: select" on public.hour_flags
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: insert" on public.hour_flags
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "own rows: update" on public.hour_flags
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.hour_flags from anon, authenticated;
grant select, insert, update on public.hour_flags to authenticated;

-- Realtime: clients subscribe to their own rows and use the event as a nudge to pull.
alter publication supabase_realtime add table public.hour_flags;

create table public.recurring_plans (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (char_length(id) between 1 and 32),
  note        text not null default '' check (char_length(note) <= 280),
  category    text check (category is null or char_length(category) <= 32),
  -- The run: from from_hour up to, not including, to_hour. A to_hour at or before
  -- from_hour is on the next day; equal is a whole day.
  from_hour   smallint not null check (from_hour between 0 and 23),
  to_hour     smallint not null check (to_hour between 0 and 23),
  -- The weekdays a run starts on, 0 (Sunday) to 6.
  days        smallint[] not null check (cardinality(days) <= 7 and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  -- The first calendar day the plan applies to.
  since       date not null,
  position    integer not null,
  archived    boolean not null default false,
  updated_at  bigint not null,
  synced_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index recurring_plans_user_synced_idx on public.recurring_plans (user_id, synced_at);

create trigger recurring_plans_before_write
  before insert or update on public.recurring_plans
  for each row execute function public.hours_before_write();

alter table public.recurring_plans enable row level security;

-- (select auth.uid()) rather than auth.uid() so the planner evaluates it once per query.
create policy "own rows: select" on public.recurring_plans
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: insert" on public.recurring_plans
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "own rows: update" on public.recurring_plans
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.recurring_plans from anon, authenticated;
grant select, insert, update on public.recurring_plans to authenticated;

-- Realtime: clients subscribe to their own rows and use the event as a nudge to pull.
alter publication supabase_realtime add table public.recurring_plans;
