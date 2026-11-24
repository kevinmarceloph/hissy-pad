-- A line can carry one of Hours' categories: the id of a row of public.hour_categories,
-- drawn as that category's icon before the line's text. Null for none. No foreign key:
-- a category and a line sync on their own and either may reach the server first, and a
-- category is archived, never deleted, so the id keeps meaning the same thing.
alter table public.nodes
  add column category text check (category is null or char_length(category) between 1 and 32);
