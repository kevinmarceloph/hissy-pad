-- When a line was crossed out, so "Recently done" can list lines newest first. Null for
-- lines that are not done and for lines done before this column existed (clients fall
-- back to updated_at for those). Cleared again when the line is un-done.
alter table public.nodes add column done_at timestamptz;
