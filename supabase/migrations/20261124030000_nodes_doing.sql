-- A line's middle state: being worked on, between open and done. The floating switch steps
-- open, doing, done. Clients read it as false on a done line (the watch crosses lines out
-- without knowing this column), so there is no check tying it to `done`.
alter table public.nodes add column doing boolean not null default false;
