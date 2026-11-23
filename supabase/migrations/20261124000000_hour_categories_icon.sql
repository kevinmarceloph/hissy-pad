-- A category gets an icon of its own: one emoji, or '' for none, the same as a flag's.
-- Until now a name could carry one in front of an em dash ("💻 — Deep work"): the part
-- before the dash was what an hour's row showed and the rest was a description.
alter table public.hour_categories
  add column icon text not null default '' check (char_length(icon) <= 16);

-- Names written the old way move over: what is before the dash becomes the icon when it
-- is short and has no letter or digit in it, and what is after becomes the name. The row
-- counts as one write newer, so every device takes it. A name whose first part is words
-- ("Body — gym or a run") is left as it is.
update public.hour_categories
set icon = btrim(split_part(label, '—', 1)),
    label = btrim(substr(label, position('—' in label) + 1)),
    updated_at = updated_at + 1
where position('—' in label) > 0
  and btrim(split_part(label, '—', 1)) <> ''
  and char_length(btrim(split_part(label, '—', 1))) <= 16
  and btrim(split_part(label, '—', 1)) !~ '[[:alnum:]]'
  and btrim(substr(label, position('—' in label) + 1)) <> '';
