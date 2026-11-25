-- Boomerang: a line sent out of the pads until a later day. `due` is that day, 'YYYY-MM-DD'
-- (a calendar day in the device's local time, no hour), null for a line that is not out.
-- `fresh` marks a line that came back to the Inbox and has not been touched since. A client
-- that does not know the columns leaves them as they were.
alter table public.nodes add column due text;
alter table public.nodes add column fresh boolean not null default false;
