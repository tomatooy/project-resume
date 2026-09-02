-- The two writes that must be atomic. Both run `security invoker`, so RLS
-- still applies and neither is a way around the ownership boundary.
--
-- Patch application itself deliberately stays in TypeScript: `applyPatches`
-- and `validatePatches` in packages/resume-schema are the single source of
-- truth for the patch contract and are shared with the browser. These
-- functions only persist a result that was already computed.

-- Creates the next immutable version and moves the head onto it.
--
-- Dedupes against the *current* version's hash only. Pressing "Save version"
-- twice with no edit in between must not write a second identical row, but
-- restoring v1 and then saving must, because the current version has moved.
--
-- p_dedupe is false for restore: bringing a version back is an event worth
-- recording in History even when the content it brings back is what the
-- current version already holds.
-- The trailing arguments carry defaults so they can be omitted rather than
-- passed as null. PostgREST calls by name, and the generated TypeScript types
-- mark a defaulted argument optional, which is what lets the adapter leave
-- `p_agent_run_id` out for a user-initiated save instead of lying about its
-- type.
create or replace function create_resume_version(
  p_resume_id      uuid,
  p_content        jsonb,
  p_schema_version int,
  p_content_hash   text,
  p_label          text            default null,
  p_created_by     created_by_kind default 'user',
  p_agent_run_id   uuid            default null,
  p_dedupe         boolean         default true
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current  resume_versions;
  v_version  resume_versions;
  v_revision bigint;
  v_updated  timestamptz;
begin
  select rv.* into v_current
    from resumes r
    join resume_versions rv on rv.id = r.current_version_id
   where r.id = p_resume_id;

  if p_dedupe and found and v_current.content_hash = p_content_hash then
    -- The head can sit ahead of the current version, because autosave moves it
    -- without creating one. Returning without writing the content back would
    -- make a restore onto the current version silently do nothing.
    update resumes
       set data           = p_content,
           schema_version = p_schema_version
     where id = p_resume_id
    returning revision, updated_at into v_revision, v_updated;

    return jsonb_build_object(
      'version',    to_jsonb(v_current),
      'revision',   v_revision,
      'updated_at', v_updated,
      'deduped',    true
    );
  end if;

  -- max + 1, not count + 1: a deleted or renumbered row must never collide.
  insert into resume_versions (
    resume_id, version_no, content, schema_version, content_hash,
    label, created_by, agent_run_id
  )
  select
    p_resume_id,
    coalesce(max(version_no), 0) + 1,
    p_content, p_schema_version, p_content_hash,
    p_label, p_created_by, p_agent_run_id
  from resume_versions
  where resume_id = p_resume_id
  returning * into v_version;

  update resumes
     set data               = p_content,
         schema_version     = p_schema_version,
         current_version_id = v_version.id
   where id = p_resume_id
  returning revision, updated_at into v_revision, v_updated;

  if not found then
    raise exception 'resume % not found', p_resume_id using errcode = 'no_data_found';
  end if;

  -- `revision` comes back from the trigger, so the caller never needs a second
  -- read to learn the concurrency token it must hold next.
  return jsonb_build_object(
    'version',    to_jsonb(v_version),
    'revision',   v_revision,
    'updated_at', v_updated,
    'deduped',    false
  );
end $$;

-- Records accept/reject decisions and, when anything was accepted, creates the
-- resulting version. One transaction, so a suggestion can never end up marked
-- accepted with no version to show for it.
--
-- p_decisions: [{ "suggestionId": uuid, "status": "accepted"|"rejected"|"stale" }]
-- p_new_content: the already-patched document, or null when nothing was accepted.
create or replace function decide_suggestions(
  p_run_id       uuid,
  p_decisions    jsonb,
  p_new_content  jsonb default null,
  p_content_hash text  default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_resume_id uuid;
  v_accepted  int;
  v_result    jsonb;
begin
  select resume_id into v_resume_id from agent_runs where id = p_run_id;
  if not found then
    raise exception 'run % not found', p_run_id using errcode = 'no_data_found';
  end if;

  update suggestions s
     set status     = (d.value->>'status')::suggestion_status,
         decided_at = now()
    from jsonb_array_elements(p_decisions) as d
   where s.id = (d.value->>'suggestionId')::uuid
     and s.agent_run_id = p_run_id;

  select count(*) into v_accepted
    from jsonb_array_elements(p_decisions) d
   where d.value->>'status' = 'accepted';

  if v_accepted = 0 or p_new_content is null then
    select jsonb_build_object(
             'version',    null,
             'revision',   r.revision,
             'updated_at', r.updated_at,
             'deduped',    false
           )
      into v_result
      from resumes r where r.id = v_resume_id;
    return v_result;
  end if;

  return create_resume_version(
    v_resume_id,
    p_new_content,
    (p_new_content->>'schemaVersion')::int,
    p_content_hash,
    'AI suggestions accepted',
    'agent'::created_by_kind,
    p_run_id
  );
end $$;
