-- A synchronous web creation may be adopted while its writer is running.
-- Share the cancellation lock so a late web result cannot bypass the fence.
create function commit_tailor_creation(p_input jsonb) returns boolean
language plpgsql security invoker set search_path=public as $$
declare r resumes; a agent_runs; b job_resume_bindings; o tailor_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  select * into b from job_resume_bindings where resume_id=(p_input->>'resumeId')::uuid for update;
  if found then select * into o from tailor_operations where id=b.current_operation_id for update; end if;
  select * into r from resumes where id=(p_input->>'resumeId')::uuid for update;
  select * into a from agent_runs where id=(p_input->>'runId')::uuid and resume_id=r.id for update;
  if r.id is null or a.id is null then raise exception 'Not found' using errcode='P0002'; end if;
  if a.status <> 'running' or r.deleted_at is not null or r.revision <> (p_input->>'expectedRevision')::bigint then return false; end if;
  if o.id is not null and (not o.legacy or o.status not in ('queued','running') or o.deadline <= now()) then return false; end if;
  perform create_resume_version(r.id,p_input->'document',1,p_input->>'contentHash',p_input->>'label','system',a.id,false);
  update resumes set subtitle=p_input->>'subtitle' where id=r.id;
  update agent_runs set status='completed',model=p_input->>'model',latency_ms=(p_input->>'latencyMs')::int,finished_at=now(),input='{}' where id=a.id;
  if o.id is not null then update tailor_operations set status='succeeded',finished_at=now() where id=o.id; end if;
  return true;
end $$;
revoke all on function commit_tailor_creation(jsonb) from public,anon;
grant execute on function commit_tailor_creation(jsonb) to authenticated;
