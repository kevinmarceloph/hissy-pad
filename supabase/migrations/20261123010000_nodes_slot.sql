-- The hour a line is assigned to in Hours: a calendar day and hour in the device's local
-- time, 'YYYY-MM-DDTHH', the same slot a row of public.hour_entries is stored under. Null
-- for a line in no hour. Text, not a timestamp: it names a slot on the wall clock, and
-- must read the same on every device whatever its time zone.
alter table public.nodes
  add column slot text check (slot is null or slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$');
