create type job_platform as enum ('linkedin', 'indeed');

-- The binding policy references the column whose type changes.
drop policy binding_owner on job_resume_bindings;
alter table job_targets drop constraint job_identity_pair;
alter table job_targets alter column platform type job_platform using platform::job_platform;
alter table job_targets add constraint job_identity_pair check (
  (platform is null and external_job_id is null) or
  (platform is not null and external_job_id is not null and
    ((platform = 'linkedin' and external_job_id ~ '^[0-9]{6,}$') or
     (platform = 'indeed' and length(external_job_id) between 1 and 200)))
);
alter table job_targets add column apply_url text check (
  apply_url is null or (length(apply_url) <= 4000 and apply_url ~ '^https?://[^[:space:]]+$')
);

-- A durable attempt retains its own instructions for generation and retry.
alter table tailor_operations add column additional_instruction text not null default ''
  check (length(additional_instruction) <= 4000);

create policy binding_owner on job_resume_bindings for all using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists(select 1 from resumes r where r.id=resume_id and r.user_id=auth.uid())
  and exists(select 1 from job_targets j where j.id=job_target_id and j.user_id=auth.uid() and j.platform::text=job_resume_bindings.platform and j.external_job_id=job_resume_bindings.external_job_id)
  and (source_resume_id is null or exists(select 1 from resumes r where r.id=source_resume_id and r.user_id=auth.uid()))
);

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
    insert into job_targets(user_id,platform,external_job_id,source_url,apply_url,raw_text)
      values(auth.uid(),(p_input->>'platform')::job_platform,p_input->>'externalJobId',p_input->>'sourceUrl',p_input->>'applyUrl',p_input->>'jobText') returning id into target_id;
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
  insert into tailor_operations(id,user_id,binding_id,resume_id,job_target_id,attempt,status,expected_revision,input_version_id,idempotency_key,workflow_id,deadline,agent_run_id,additional_instruction)
    values(operation_id,auth.uid(),b.id,r.id,b.job_target_id,next_attempt,'queued',r.revision,(v->'version'->>'id')::uuid,(p_input->>'idempotencyKey')::uuid,operation_id,now()+interval '5 minutes',run_id,coalesce(p_input->>'additionalInstruction',case when retry then o.additional_instruction end,'')) returning * into o;
  update job_resume_bindings set current_operation_id=o.id,updated_at=now() where id=b.id;
  return to_jsonb(o);
end $$;


create or replace function tailor_adopt(p_platform text,p_external_job_id text,p_resume_id uuid,p_content_hash text) returns void language plpgsql security invoker set search_path=public as $$
declare b job_resume_bindings; r resumes; j uuid; a agent_runs; v jsonb; o uuid := gen_random_uuid(); state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  if exists(select 1 from job_resume_bindings where user_id=auth.uid() and platform=p_platform and external_job_id=p_external_job_id) then return; end if;
  select l.job_target_id into j from resumes r0 join resume_job_targets l on l.resume_id=r0.id join job_targets t on t.id=l.job_target_id
    where r0.deleted_at is null and l.is_origin and t.platform::text=p_platform and t.external_job_id=p_external_job_id
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

create or replace function lookup_tailor_job(p_platform text,p_external_job_id text) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'operation',(select to_jsonb(o) || case
      when o.legacy and o.status in ('queued','running') then case
        when a.status='completed' and exists(select 1 from resume_versions v where v.agent_run_id=a.id) then jsonb_build_object('status','succeeded')
        when a.status in ('failed','cancelled') then jsonb_build_object('status',a.status,'error_class','generation_failed')
        else '{}'::jsonb end
      else '{}'::jsonb end from job_resume_bindings b
      join resumes r on r.id=b.resume_id and r.deleted_at is null
      join tailor_operations o on o.id=b.current_operation_id
      left join agent_runs a on a.id=o.agent_run_id and o.legacy and o.status in ('queued','running')
      where b.user_id=auth.uid() and b.platform=p_platform and b.external_job_id=p_external_job_id),
    'legacy_resume_id',(select l.resume_id from job_targets j
      join resume_job_targets l on l.job_target_id=j.id and l.is_origin
      join resumes r on r.id=l.resume_id and r.deleted_at is null
      where j.user_id=auth.uid() and j.platform::text=p_platform and j.external_job_id=p_external_job_id
      and not exists(select 1 from job_resume_bindings b where b.user_id=auth.uid() and b.platform=p_platform and b.external_job_id=p_external_job_id)
      order by l.created_at desc,l.resume_id desc,l.job_target_id desc limit 1)
  );
$$;
