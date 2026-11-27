-- A section divider: a line drawn as a rule across the pad, its text (if any) centered and
-- gray. It never has lines under it and is never done; the clients keep that so (setKind,
-- moveNodes and indent in core), so there is no check here: a client that does not know
-- the column leaves it as it was and draws the row as a plain line.
alter table public.nodes add column if not exists divider boolean not null default false;
