-- Agent turns: the run's plan, the playbooks it loaded, and the two flags the
-- request carried.

-- The composer's hint is advisory: nothing enforces it, a turn that ignored it
-- is still a valid turn, and a run may have no hint at all.
alter table agent_runs rename column skill_id to hint_skill_id;
alter table agent_runs alter column hint_skill_id drop not null;

-- The line the model planned with, kept as jsonb so a shape change is a
-- consumer's problem rather than a migration's.
alter table agent_runs add column plan jsonb;

-- The playbooks the turn loaded, in order. Telemetry and the panel's chips;
-- never read for validation, which is why a row written before this column
-- existed still accepts its suggestions normally.
alter table agent_runs add column skill_ids text[] not null default '{}';

-- Whether the user enabled removing and restructuring for this turn. Kept on
-- the row so accept-time validation uses the value the patches were proposed
-- under even if the panel's toggle has since changed.
alter table agent_runs add column structural boolean not null default false;

-- The step budget ran out with nothing proposed.
alter table agent_runs add column budget_exhausted boolean not null default false;
