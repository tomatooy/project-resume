-- A snapshot writes its content back onto the head, so an autosave landing
-- between the caller's read and this write would be silently undone. A caller
-- that passes the revision it read gets P0409 instead and can read again.
-- Callers without a revision keep the old behavior through the default.
drop function create_resume_version(uuid, jsonb, int, text, text, created_by_kind, uuid, boolean);
create function create_resume_version(
  p_resume_id         uuid,
  p_content           jsonb,
  p_schema_version    int,
  p_content_hash      text,
  p_label             text            default null,
  p_created_by        created_by_kind default 'user',
  p_agent_run_id      uuid            default null,
  p_dedupe            boolean         default true,
  p_expected_revision bigint          default null
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
  v_rev      bigint;
begin
  select revision into v_rev from resumes where id = p_resume_id for update;
  if not found then
    raise exception 'resume % not found', p_resume_id using errcode = 'no_data_found';
  end if;
  if p_expected_revision is not null and v_rev <> p_expected_revision then
    raise exception 'Resume changed' using errcode = 'P0409';
  end if;

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

revoke all on function create_resume_version(uuid, jsonb, int, text, text, created_by_kind, uuid, boolean, bigint) from public;
grant execute on function create_resume_version(uuid, jsonb, int, text, text, created_by_kind, uuid, boolean, bigint) to authenticated;
