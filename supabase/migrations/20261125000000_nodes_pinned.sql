-- A line kept at the top of its pad, above a divider. Only a pad's top-level lines are
-- pinned; the clients keep that so (settlePins in core), so there is no check here: a
-- client that does not know the column leaves it as it was.
alter table public.nodes add column pinned boolean not null default false;
