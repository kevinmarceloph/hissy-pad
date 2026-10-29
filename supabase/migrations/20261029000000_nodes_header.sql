-- Header lines: bold text with a "#" for a bullet. A second flag beside `numbered` rather
-- than a kind enum so older clients keep reading and writing rows unchanged; the client
-- never sets both.
alter table public.nodes add column header boolean not null default false;
