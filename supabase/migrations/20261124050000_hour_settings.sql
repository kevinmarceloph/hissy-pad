-- Hours' settings follow the account: the hour a day starts at and the chime minutes, which
-- were kept on each device until now. One row per setting, so a change to the chimes on
-- one device never overwrites a day start set on another. Synced like the other hours
-- tables: updated_at is the client clock in ms, last write wins (hours_before_write),
-- synced_at is the server's, clients never delete.
--   day.start      '0'-'23'
--   chime.minutes  the minutes past the hour, comma separated; '' is off
-- The value is text the app reads and cleans, so a key a newer app adds needs no migration.

create table public.hour_settings (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key         text not null check (char_length(key) between 1 and 32),
  value       text not null check (char_length(value) <= 280),
  updated_at  bigint not null,
  synced_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, key)
);

create index hour_settings_user_synced_idx on public.hour_settings (user_id, synced_at);

create trigger hour_settings_before_write
  before insert or update on public.hour_settings
  for each row execute function public.hours_before_write();

alter table public.hour_settings enable row level security;

create policy "own rows: select" on public.hour_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: insert" on public.hour_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "own rows: update" on public.hour_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.hour_settings from anon, authenticated;
grant select, insert, update on public.hour_settings to authenticated;

alter publication supabase_realtime add table public.hour_settings;
