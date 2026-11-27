-- Planned against actual is gone (Kevin, 2026-11-27, "rethink the hour view, round 3"): an
-- hour is the lines put in it, and a recurring plan is read when the hour is drawn, never
-- stored on it. No client reads or sends these two columns any more (the web and the
-- phone's update since d97121a). A device still on older code that writes an hour's own
-- row sends them and is refused until it updates; nothing on screen writes that row now.
alter table public.hour_entries
  drop column if exists planned,
  drop column if exists planned_note;
