-- User JWTs remain the authorization boundary for requests and workflows.
alter table job_targets add column platform text;
alter table job_targets add column external_job_id text;
alter table job_targets add column parsed_at timestamptz;
alter table job_targets add constraint job_identity_pair check (
  (platform is null and external_job_id is null) or
  (platform is not null and external_job_id is not null and platform = 'linkedin' and external_job_id ~ '^[0-9]{6,}$')
);
create index job_targets_identity on job_targets(user_id, platform, external_job_id) where platform is not null;
alter table job_targets alter column requirements set default '{"mustHaves":[],"niceToHaves":[],"keywords":[]}';

create table job_resume_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform = 'linkedin'),
  external_job_id text not null check (external_job_id ~ '^[0-9]{6,}$'),
  resume_id uuid not null references resumes(id) on delete cascade,
  job_target_id uuid not null references job_targets(id),
  source_resume_id uuid references resumes(id) on delete set null,
  current_operation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, platform, external_job_id)
);
create table tailor_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  binding_id uuid not null references job_resume_bindings(id) on delete cascade,
  resume_id uuid not null references resumes(id) on delete cascade,
  job_target_id uuid not null references job_targets(id),
  attempt integer not null check (attempt > 0),
  status text not null check (status in ('queued','running','succeeded','failed','cancelled')),
  expected_revision bigint not null,
  input_version_id uuid not null references resume_versions(id),
  idempotency_key uuid not null,
  workflow_id uuid not null,
  deadline timestamptz not null,
  error_class text check (error_class in ('expired','conflict','deleted','generation_failed','dispatch_failed','unverified_legacy')),
  agent_run_id uuid references agent_runs(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(user_id, idempotency_key), unique(binding_id, attempt)
);
create unique index tailor_one_active on tailor_operations(binding_id) where status in ('queued','running');
alter table job_resume_bindings add foreign key(current_operation_id) references tailor_operations(id) deferrable initially deferred;
create table tailor_operation_artifacts (
  operation_id uuid primary key references tailor_operations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null,
  content_hash text not null,
  title text not null, subtitle text not null, label text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index tailor_expiry on tailor_operations(user_id, deadline) where status in ('queued','running');
alter table job_resume_bindings enable row level security;
alter table tailor_operations enable row level security;
alter table tailor_operation_artifacts enable row level security;
create policy binding_owner on job_resume_bindings for all using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists(select 1 from resumes r where r.id=resume_id and r.user_id=auth.uid())
  and exists(select 1 from job_targets j where j.id=job_target_id and j.user_id=auth.uid() and j.platform=job_resume_bindings.platform and j.external_job_id=job_resume_bindings.external_job_id)
  and (source_resume_id is null or exists(select 1 from resumes r where r.id=source_resume_id and r.user_id=auth.uid()))
);
create policy operation_owner on tailor_operations for all using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists(select 1 from job_resume_bindings b where b.id=binding_id and b.user_id=auth.uid() and b.resume_id=tailor_operations.resume_id and b.job_target_id=tailor_operations.job_target_id)
  and exists(select 1 from resume_versions v where v.id=input_version_id and v.resume_id=tailor_operations.resume_id)
  and (agent_run_id is null or exists(select 1 from agent_runs a where a.id=agent_run_id and a.resume_id=tailor_operations.resume_id))
);
create policy artifact_owner on tailor_operation_artifacts for all using(user_id=auth.uid()) with check (
  user_id=auth.uid() and exists(select 1 from tailor_operations o where o.id=operation_id and o.user_id=auth.uid())
);
grant select, insert, update, delete on job_resume_bindings, tailor_operations, tailor_operation_artifacts to authenticated;
revoke all on job_resume_bindings, tailor_operations, tailor_operation_artifacts from anon;

-- Every run, including web chat, shares the admission lock and accounting.
create function reserve_agent_quota() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 241));
  if (select count(*) from agent_runs where created_at > now()-interval '1 hour') >= 60 then
    raise exception 'Hourly AI limit' using errcode='P0429';
  end if;
  return new;
end $$;
create trigger agent_quota before insert on agent_runs for each row execute function reserve_agent_quota();

create function tailor_admit(p_input jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
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
    return to_jsonb(o);
  end if;
  select * into b from job_resume_bindings where user_id=auth.uid() and platform=p_input->>'platform' and external_job_id=p_input->>'externalJobId' for update;
  if found then
    select * into o from tailor_operations where id=b.current_operation_id for update;
    select * into r from resumes where id=b.resume_id for update;
    if r.deleted_at is not null then
      update tailor_operations set status='failed', error_class='deleted',finished_at=now() where binding_id=b.id and status in ('queued','running');
      update agent_runs set status='failed',error_class='deleted',finished_at=now(),input='{}' where id=o.agent_run_id and status='running';
      delete from tailor_operation_artifacts where operation_id in (select id from tailor_operations where binding_id=b.id);
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

-- Consistent lock order: user, binding, operation, resume.
create function tailor_transition(p_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path=public as $$
declare o tailor_operations; b job_resume_bindings; r resumes; a tailor_operation_artifacts; reason text;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  select b0.* into b from job_resume_bindings b0 join tailor_operations o0 on o0.binding_id=b0.id where o0.id=p_id for update of b0;
  if not found then raise exception 'Not found' using errcode='P0002'; end if;
  select * into o from tailor_operations where id=p_id for update;
  select * into r from resumes where id=o.resume_id for update;
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

revoke all on function tailor_admit(jsonb),tailor_transition(uuid,text,jsonb),reserve_agent_quota() from public, anon;
grant execute on function tailor_admit(jsonb),tailor_transition(uuid,text,jsonb) to authenticated;

-- Pin one deterministic legacy origin without merging captures or resumes.
create function tailor_adopt(p_platform text,p_external_job_id text,p_resume_id uuid,p_content_hash text) returns void language plpgsql security invoker set search_path=public as $$
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
  insert into tailor_operations(id,user_id,binding_id,resume_id,job_target_id,attempt,status,expected_revision,input_version_id,idempotency_key,workflow_id,deadline,agent_run_id,error_class)
    values(o,auth.uid(),b.id,r.id,j,1,state,r.revision,(v->'version'->>'id')::uuid,gen_random_uuid(),o,coalesce(a.created_at,now())+interval '10 minutes',a.id,case when state='failed' then 'unverified_legacy' end);
  update job_resume_bindings set current_operation_id=o where id=b.id;
end $$;
revoke all on function tailor_adopt(text,text,uuid,text) from public,anon;
grant execute on function tailor_adopt(text,text,uuid,text) to authenticated;
