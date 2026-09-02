-- Résumé Studio: initial schema.
--
-- Authorization is Row Level Security, not application code. Every query runs
-- through PostgREST carrying the user's JWT and there is no service-role key
-- anywhere in the Worker, so a handler that forgets an ownership check still
-- cannot reach another user's rows.

create extension if not exists "pgcrypto";

create type created_by_kind   as enum ('user', 'agent', 'system');
create type message_role      as enum ('user', 'assistant', 'system');
create type run_status        as enum ('running', 'completed', 'failed', 'cancelled');
create type suggestion_status as enum ('pending', 'accepted', 'rejected', 'stale');
create type patch_op          as enum ('replace_text', 'update_fields', 'insert_after', 'delete', 'move');

-- ------------------------------------------------------------------ resumes

create table resumes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  title              text not null,
  -- Short line under the title in the rail, e.g. "Tailored · Senior PD".
  subtitle           text not null default '',
  -- The working head. Autosave writes here; versions are separate rows.
  data               jsonb not null,
  schema_version     int  not null default 1,
  -- Plain text, not an enum: adding a template must not need a migration.
  -- Validated on write by Zod and coerced on read, so an unknown value can
  -- never reach the export screen, which indexes the template map directly.
  template_id        text not null default 'lisbon',
  template_options   jsonb not null default '{"pageSize":"LETTER","fontScale":1}',
  -- The optimistic-concurrency token for autosave. Maintained only by the
  -- trigger below; clients never write it.
  revision           bigint not null default 1,
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index resumes_user_updated
  on resumes (user_id, updated_at desc)
  where deleted_at is null;

-- `updated_at` is display only; `revision` is the token. Keeping them apart is
-- what stops a rename or a template switch from turning the next autosave into
-- a conflict the user never caused. The else branch also means a client cannot
-- forge the token through PostgREST.
create or replace function resumes_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  if new.data is distinct from old.data then
    new.revision = old.revision + 1;
  else
    new.revision = old.revision;
  end if;
  return new;
end $$;

create trigger resumes_before_update
  before update on resumes
  for each row execute function resumes_before_update();

-- ---------------------------------------------------------- resume_versions

create table resume_versions (
  id             uuid primary key default gen_random_uuid(),
  resume_id      uuid not null references resumes(id) on delete cascade,
  version_no     int  not null,
  content        jsonb not null,
  schema_version int  not null,
  -- sha256 of the canonical JSON, from contentHash() in resume-schema.
  content_hash   text not null,
  label          text,
  created_by     created_by_kind not null,
  agent_run_id   uuid,
  created_at     timestamptz not null default now(),
  unique (resume_id, version_no)
);

create index resume_versions_resume_no on resume_versions (resume_id, version_no desc);

-- Deferred: create_resume_version inserts the version and points the resume at
-- it inside one statement pair.
alter table resumes
  add constraint resumes_current_version_fk
  foreign key (current_version_id) references resume_versions(id)
  deferrable initially deferred;

-- ------------------------------------------------------------ conversations

create table conversations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  resume_id         uuid not null references resumes(id) on delete cascade,
  title             text,
  active_summary_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (resume_id)
);

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger conversations_updated_at
  before update on conversations
  for each row execute function set_updated_at();

-- No reader until the chat phase. Present now so that phase adds no migration.
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq             bigint generated always as identity,
  role            message_role not null,
  content         jsonb not null,
  agent_run_id    uuid,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index messages_conversation_seq on messages (conversation_id, seq);

create table memory_summaries (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  summary         jsonb not null,
  summary_text    text not null,
  source_from_seq bigint not null,
  source_to_seq   bigint not null,
  model           text not null,
  created_at      timestamptz not null default now()
);

alter table conversations
  add constraint conversations_active_summary_fk
  foreign key (active_summary_id) references memory_summaries(id)
  deferrable initially deferred;

-- --------------------------------------------------- agent runs, suggestions

create table agent_runs (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references conversations(id) on delete cascade,
  resume_id         uuid not null references resumes(id) on delete cascade,
  resume_version_id uuid references resume_versions(id),
  skill_id          text not null,
  model             text not null,
  selected_node_id  text,
  -- Job description and page target, cleared when the run finishes so they are
  -- not retained beyond it.
  input             jsonb not null default '{}',
  status            run_status not null default 'running',
  error_class       text,
  input_tokens      int,
  output_tokens     int,
  latency_ms        int,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index agent_runs_conversation on agent_runs (conversation_id, created_at desc);

alter table resume_versions
  add constraint resume_versions_agent_run_fk
  foreign key (agent_run_id) references agent_runs(id);

create table suggestions (
  id             uuid primary key default gen_random_uuid(),
  agent_run_id   uuid not null references agent_runs(id) on delete cascade,
  resume_id      uuid not null references resumes(id) on delete cascade,
  ordinal        int  not null,
  -- A validated ResumePatch, exactly as resume-schema defines it.
  patch          jsonb not null,
  target_node_id text not null,
  operation      patch_op not null,
  status         suggestion_status not null default 'pending',
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (agent_run_id, ordinal)
);
create index suggestions_run on suggestions (agent_run_id, ordinal);
