-- Recurring items. `repeat` is on a template: its rule as JSON (how often, the day of the
-- next one, what happens to one left open), null on any other line. A template is kept
-- under Later with `due` set to '9999-12-31'. `origin` is on an instance: the id of the
-- template it was made from. A client that does not know the columns leaves them as they were.
alter table public.nodes add column if not exists repeat text;
alter table public.nodes add column if not exists origin text;
