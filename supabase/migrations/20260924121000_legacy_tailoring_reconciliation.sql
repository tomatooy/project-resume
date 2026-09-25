alter table tailor_operations add column legacy boolean not null default false;

create or replace function tailor_transition(p_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path=public as $$
declare o tailor_operations; b job_resume_bindings; r resumes; a tailor_operation_artifacts; reason text;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  select b0.* into b from job_resume_bindings b0 join tailor_operations o0 on o0.binding_id=b0.id where o0.id=p_id for update of b0;
  if not found then raise exception 'Not found' using errcode='P0002'; end if;
  select * into o from tailor_operations where id=p_id for update;
  select * into r from resumes where id=o.resume_id for update;
  if o.legacy and o.status in ('queued','running') then
    if exists(select 1 from agent_runs where id=o.agent_run_id and status='completed') and exists(select 1 from resume_versions where agent_run_id=o.agent_run_id) then
      update tailor_operations set status='succeeded',finished_at=now() where id=o.id returning * into o;
    elsif exists(select 1 from agent_runs where id=o.agent_run_id and status in ('failed','cancelled')) then
      update tailor_operations set status=(select status::text from agent_runs where id=o.agent_run_id),error_class='generation_failed',finished_at=now() where id=o.id returning * into o;
    end if;
  end if;
  if o.status not in ('queued','running') then
    delete from tailor_operation_artifacts where operation_id=o.id;
    return to_jsonb(o);
  end if;
  if b.current_operation_id <> o.id or r.deleted_at is not null then reason := 'deleted';
  elsif o.deadline <= now() then reason := 'expired';
  elsif p_action='complete' and r.revision <> o.expected_revision then reason := 'conflict';
  end if;
  if reason is not null or p_action='fail' then
    update tailor_operations set status='failed',error_class=coalesce(reason,p_payload->>'errorClass','generation_failed'),finished_at=now() where id=o.id returning * into o;
  elsif p_action='cancel' then
    update tailor_operations set status='cancelled',finished_at=now() where id=o.id returning * into o;
  elsif p_action='claim' then
    update tailor_operations set status='running' where id=o.id returning * into o;
  elsif p_action='stage' then
    insert into tailor_operation_artifacts(operation_id,user_id,content,content_hash,title,subtitle,label,expires_at)
      values(o.id,auth.uid(),p_payload->'document',p_payload->>'contentHash',p_payload->>'title',p_payload->>'subtitle',p_payload->>'label',o.deadline)
      on conflict(operation_id) do nothing;
  elsif p_action='complete' then
    select * into a from tailor_operation_artifacts where operation_id=o.id;
    if not found then raise exception 'Missing output' using errcode='P0002'; end if;
    perform create_resume_version(r.id,a.content,1,a.content_hash,a.label,'system',o.agent_run_id,false);
    -- Preserve a concurrent manual rename.
    update resumes set title=case when o.attempt=1 and title like '% copy' then a.title else title end,subtitle=a.subtitle where id=r.id;
    update tailor_operations set status='succeeded',finished_at=now() where id=o.id returning * into o;
  end if;
  if o.status in ('succeeded','failed','cancelled') then
    delete from tailor_operation_artifacts where operation_id=o.id;
    update agent_runs set status=(case o.status when 'succeeded' then 'completed' else o.status end)::run_status,error_class=o.error_class,finished_at=now(),input='{}' where id=o.agent_run_id and status='running';
  end if;
  return to_jsonb(o);
end $$;

create or replace function tailor_adopt(p_platform text,p_external_job_id text,p_resume_id uuid,p_content_hash text) returns void language plpgsql security invoker set search_path=public as $$
declare b job_resume_bindings; r resumes; j uuid; a agent_runs; v jsonb; o uuid := gen_random_uuid(); state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  if exists(select 1 from job_resume_bindings where user_id=auth.uid() and platform=p_platform and external_job_id=p_external_job_id) then return; end if;
  select l.job_target_id into j from resumes r0 join resume_job_targets l on l.resume_id=r0.id join job_targets t on t.id=l.job_target_id
    where r0.deleted_at is null and l.is_origin and t.platform=p_platform and t.external_job_id=p_external_job_id
    order by l.created_at desc,r0.id desc,t.id desc limit 1;
  if j is null then return; end if;
  select * into r from resumes where id=p_resume_id and deleted_at is null and id=(select l.resume_id from resume_job_targets l join resumes r1 on r1.id=l.resume_id where l.job_target_id=j and l.is_origin and r1.deleted_at is null order by l.created_at desc,l.resume_id desc limit 1);
  if not found then return; end if;
  select * into a from agent_runs where resume_id=r.id and hint_skill_id='tailor_from_job' order by created_at desc,id desc limit 1;
  state := case when a.status='completed' and exists(select 1 from resume_versions where agent_run_id=a.id) then 'succeeded'
    when a.status='cancelled' then 'cancelled' when a.status='running' and a.created_at > now()-interval '10 minutes' then 'running' else 'failed' end;
  v := create_resume_version(r.id,r.data,r.schema_version,p_content_hash,'Linked job resume','system',null,false);
  insert into job_resume_bindings(user_id,platform,external_job_id,resume_id,job_target_id)
    values(auth.uid(),p_platform,p_external_job_id,r.id,j) returning * into b;
  insert into tailor_operations(id,user_id,binding_id,resume_id,job_target_id,attempt,status,expected_revision,input_version_id,idempotency_key,workflow_id,deadline,agent_run_id,error_class,legacy)
    values(o,auth.uid(),b.id,r.id,j,1,state,r.revision,(v->'version'->>'id')::uuid,gen_random_uuid(),o,coalesce(a.created_at,now())+interval '10 minutes',a.id,case when state='failed' then 'unverified_legacy' end,true);
  update job_resume_bindings set current_operation_id=o where id=b.id;
end $$;
