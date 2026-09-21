-- The user's own playbook library: the skills they wrote, and the built-ins
-- they switched off.
--
-- A skill is prompt text with no authority, so this table holds prose and
-- nothing executable. Built-ins stay TypeScript modules; only the overlay
-- lives here, which is what keeps a shipped playbook's body out of the
-- database and out of a migration.

create table user_skills (
  -- Text rather than uuid on purpose. The id is written into
  -- `agent_runs.skill_ids` and `suggestions.patch->>'skillId'` beside built-in
  -- ids like `bullet_rewrite`, and the `usr_` prefix is what makes the two
  -- tiers tellable apart in a log. It also makes a collision with a built-in
  -- id shipped later impossible.
  id          text primary key default ('usr_' || gen_random_uuid()),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  when_to_use text not null,
  not_for     text,
  starter     text,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Soft delete: an old suggestion card still has to be able to name the
  -- skill it came from after the user removed it.
  deleted_at  timestamptz
);

-- Every turn reads the live rows in creation order.
create index user_skills_user_live
  on user_skills (user_id, created_at) where deleted_at is null;

create trigger user_skills_updated_at
  before update on user_skills
  for each row execute function set_updated_at();

-- Which built-ins the user switched off.
--
-- No foreign key on `skill_id` on purpose: this holds built-in ids, which have
-- no row anywhere, and custom ids alike, so disabling is one uniform operation
-- regardless of tier. The server refuses an id its own library does not hold,
-- which is where that check belongs, because `resume-core` cannot see the
-- built-in ids.
create table user_disabled_skills (
  user_id    uuid not null references auth.users(id) on delete cascade,
  skill_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

alter table user_skills enable row level security;
create policy user_skills_owner on user_skills
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table user_disabled_skills enable row level security;
create policy user_disabled_skills_owner on user_disabled_skills
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- `alter default privileges` in 20260902120300_grants.sql already covers new
-- tables, but only for roles that existed when it ran and only for the role
-- that creates them. Stating the grants makes the two tables self-contained.
grant select, insert, update, delete on user_skills          to authenticated;
grant select, insert, update, delete on user_disabled_skills to authenticated;
