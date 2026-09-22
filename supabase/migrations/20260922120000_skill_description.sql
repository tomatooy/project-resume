-- Preserve existing summaries while separating description from usage guidance.
alter table user_skills add column description text;

update user_skills set description = when_to_use;

alter table user_skills
  alter column description set not null,
  alter column when_to_use drop not null;
