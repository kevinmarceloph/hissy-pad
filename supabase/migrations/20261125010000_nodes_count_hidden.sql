-- A pad whose tab leaves out its count of open lines. Only read on a pad row (pad = true);
-- the clients set it from the pad's sheet. A client that does not know the column leaves
-- it as it was.
alter table public.nodes add column count_hidden boolean not null default false;
