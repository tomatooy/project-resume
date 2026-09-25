-- Qualify the artifact key and reject replays of deleted copies.
create or replace function tailor_admit(p_input jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  b job_resume_bindings; o tailor_operations; r resumes; s resumes; v jsonb;
  target_id uuid; run_id uuid; conversation_id uuid; operation_id uuid := gen_random_uuid();
  retry boolean := p_input ? 'expectedOperationId'; next_attempt integer := 1;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  select * into o from tailor_operations where user_id=auth.uid() and idempotency_key=(p_input->>'idempotencyKey')::uuid;
  if found then
    if not exists(select 1 from job_resume_bindings where id=o.binding_id and platform=p_input->>'platform' and external_job_id=p_input->>'externalJobId') then
      raise exception 'Idempotency conflict' using errcode='23505';
    end if;
    if not exists(select 1 from resumes where id=o.resume_id and deleted_at is null) then
      raise exception 'Previous copy was deleted' using errcode='P0002';
    end if;
    return to_jsonb(o);
  end if;
  select * into b from job_resume_bindings where user_id=auth.uid() and platform=p_input->>'platform' and external_job_id=p_input->>'externalJobId' for update;
  if found then
    select * into o from tailor_operations where id=b.current_operation_id for update;
    select * into r from resumes where id=b.resume_id for update;
    if r.deleted_at is not null then
      update tailor_operations set status='failed', error_class='deleted',finished_at=now() where binding_id=b.id and status in ('queued','running');
      update agent_runs set status='failed',error_class='deleted',finished_at=now(),input='{}' where id=o.agent_run_id and status='running';
      delete from tailor_operation_artifacts art where art.operation_id in (select id from tailor_operations where binding_id=b.id);
      if retry then raise exception 'Resume not found' using errcode='P0002'; end if;
      -- Keep the tombstone binding, so lookup never adopts an older resume.
    elsif not retry then return to_jsonb(o);
    else
      if o.id is distinct from (p_input->>'expectedOperationId')::uuid or o.status not in ('failed','cancelled') then
        raise exception 'Attempt changed' using errcode='23505';
      end if;
      if r.revision <> (p_input->>'expectedRevision')::bigint then raise exception 'Resume changed' using errcode='23505'; end if;
      next_attempt := o.attempt+1;
    end if;
  elsif retry then raise exception 'Not found' using errcode='P0002';
  end if;
  if not retry then
    select * into s from resumes where id=(p_input->>'sourceResumeId')::uuid and deleted_at is null for update;
    if not found then raise exception 'Source not found' using errcode='P0002'; end if;
    if s.revision <> (p_input->>'expectedRevision')::bigint then raise exception 'Source changed' using errcode='23505'; end if;
    if length(p_input->>'jobText') not between 200 and 20000 then raise exception 'Invalid posting' using errcode='22023'; end if;
    insert into job_targets(user_id,platform,external_job_id,source_url,raw_text)
      values(auth.uid(),p_input->>'platform',p_input->>'externalJobId',p_input->>'sourceUrl',p_input->>'jobText') returning id into target_id;
    insert into resumes(user_id,title,subtitle,data,schema_version,template_id,template_options)
      values(auth.uid(),s.title || ' copy','Draft · not tailored',p_input->'document',s.schema_version,s.template_id,s.template_options) returning * into r;
    insert into resume_job_targets(resume_id,job_target_id,is_origin) values(r.id,target_id,true);
    if b.id is null then
      insert into job_resume_bindings(user_id,platform,external_job_id,resume_id,job_target_id,source_resume_id)
        values(auth.uid(),p_input->>'platform',p_input->>'externalJobId',r.id,target_id,s.id) returning * into b;
    else
      -- A new live copy replaces a deleted copy, never revives it.
      next_attempt := o.attempt+1;
      update job_resume_bindings set resume_id=r.id,job_target_id=target_id,source_resume_id=s.id,current_operation_id=null,updated_at=now() where id=b.id returning * into b;
    end if;
  end if;
  v := create_resume_version(r.id,r.data,r.schema_version,p_input->>'contentHash','Before tailoring','system',null,false);
  insert into conversations(user_id,resume_id) values(auth.uid(),r.id) on conflict(resume_id) do update set resume_id=excluded.resume_id returning id into conversation_id;
  insert into agent_runs(conversation_id,resume_id,resume_version_id,hint_skill_id,model,input)
    values(conversation_id,r.id,(v->'version'->>'id')::uuid,'tailor_from_job','pending','{}') returning id into run_id;
  insert into tailor_operations(id,user_id,binding_id,resume_id,job_target_id,attempt,status,expected_revision,input_version_id,idempotency_key,workflow_id,deadline,agent_run_id)
    values(operation_id,auth.uid(),b.id,r.id,b.job_target_id,next_attempt,'queued',r.revision,(v->'version'->>'id')::uuid,(p_input->>'idempotencyKey')::uuid,operation_id,now()+interval '5 minutes',run_id) returning * into o;
  update job_resume_bindings set current_operation_id=o.id,updated_at=now() where id=b.id;
  return to_jsonb(o);
end $$;

