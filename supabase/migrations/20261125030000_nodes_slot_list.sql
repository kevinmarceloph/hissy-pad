-- A line can be put in hours that do not touch: runs with commas between them,
-- 'YYYY-MM-DDT09,YYYY-MM-DDT14+2'. One hour and one run keep their shape, so every row
-- already stored still passes. At most 24 runs: a day of hours picked one by one.
alter table public.nodes drop constraint if exists nodes_slot_check;
alter table public.nodes
  add constraint nodes_slot_check check (
    slot is null
    or slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}(\+[0-9]{1,2})?(,[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}(\+[0-9]{1,2})?){0,23}$'
  );
