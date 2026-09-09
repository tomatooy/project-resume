-- Job postings a user has tailored against, and which resumes came from them.
--
-- The posting is a first-class row rather than a column on `resumes` because
-- one posting can be tailored against more than once, and because a resume
-- picks up further applications over its life. `agent_runs.input` keeps only
-- the id of a row here, so the run's input is still safe to retain while the
-- posting text has one home.

create table job_targets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Null when the user pasted the description instead of giving a link.
  source_url   text,
  -- The posting as the model saw it, capped by the service at 20,000 chars.
  raw_text     text not null,
  title        text not null default '',
  company      text not null default '',
  location     text,
  -- { mustHaves: string[], niceToHaves: string[], keywords: string[] }.
  -- Jsonb rather than three arrays: the shape is model output, validated by
  -- Zod on the way in and on the way out, and it will grow.
  requirements jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index job_targets_user_created on job_targets (user_id, created_at desc);

-- Many-to-many on purpose. `is_origin` marks the posting the resume was
-- generated from, which is exactly one row today because the creation flow is
-- the only writer; later ways of attaching a posting will add rows with false.
create table resume_job_targets (
  resume_id     uuid not null references resumes(id)     on delete cascade,
  job_target_id uuid not null references job_targets(id) on delete cascade,
  is_origin     boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (resume_id, job_target_id)
);

create index resume_job_targets_by_target on resume_job_targets (job_target_id);

-- Same two-part boundary as every other table: a policy for which rows, a
-- grant for whether the role may reach the table at all.
alter table job_targets enable row level security;
create policy job_targets_owner on job_targets
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Joins through `resumes` like every other child table, and additionally
-- checks the posting is the same user's, so a link row cannot be used to
-- attach someone else's posting to your own resume.
alter table resume_job_targets enable row level security;
create policy resume_job_targets_owner on resume_job_targets
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid())
                 and exists (select 1 from job_targets j where j.id = job_target_id and j.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid())
                 and exists (select 1 from job_targets j where j.id = job_target_id and j.user_id = auth.uid()));

-- `alter default privileges` in 20260902120300_grants.sql already covers new
-- tables, but only for roles that existed when it ran and only for the role
-- that creates them. Stating the grants makes the two tables self-contained.
grant select, insert, update, delete on job_targets        to authenticated;
grant select, insert, update, delete on resume_job_targets to authenticated;
