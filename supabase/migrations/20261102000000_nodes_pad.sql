-- Several pads. A pad is a root-level row with `pad` set; its subtree is that pad's
-- content, and the root level itself stays the main pad, so nothing migrates. A boolean
-- beside `header` and `numbered`, for the same reason: older clients keep reading and
-- writing rows unchanged (they show a pad as a heading with its lines under it).
alter table public.nodes add column pad boolean not null default false;
