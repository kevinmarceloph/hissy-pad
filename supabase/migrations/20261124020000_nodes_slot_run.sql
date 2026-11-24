-- A line can be put in a run of hours, not only one: 'YYYY-MM-DDTHH+N' is that hour and
-- the N-1 after it (2 to 24, may run past midnight). A single hour keeps the old shape,
-- so every row already stored still passes.
alter table public.nodes drop constraint if exists nodes_slot_check;
alter table public.nodes
  add constraint nodes_slot_check check (slot is null or slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}(\+[0-9]{1,2})?$');
