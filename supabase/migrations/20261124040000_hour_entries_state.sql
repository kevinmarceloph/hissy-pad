-- An hour has a state of its own, the same three a line of the pad has: open, doing, done.
-- Until now an hour counted as done once something was logged on it (words, a category or
-- a flag), judged against a plan. The plan is no longer edited (planned and planned_note
-- stay, unread by hand); done is set by hand, to confirm where a past hour went.
alter table public.hour_entries
  add column state text not null default 'open' check (state in ('open', 'doing', 'done'));

-- Hours logged the old way were drawn as done, so they are. The row counts as one write
-- newer, so every device takes it.
update public.hour_entries
set state = 'done',
    updated_at = updated_at + 1
where category is not null or btrim(note) <> '' or cardinality(flags) > 0;
