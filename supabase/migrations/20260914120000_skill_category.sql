-- Skills are grouped by what they are for, so the library reads as an editor
-- section and an interview one.
--
-- A column rather than a second table: the two categories share every other
-- field, and the grouping is a label the rail groups by, never a gate. Every
-- row that exists predates the grouping and every playbook shipped so far is
-- an editing one, so the default is the backfill.

alter table user_skills
  add column category text not null default 'editor'
  constraint user_skills_category
  check (category in ('editor', 'interview'));
