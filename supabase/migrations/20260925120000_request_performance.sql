create extension if not exists pg_trgm with schema extensions;

create function resume_search_text(p_data jsonb) returns text
language sql immutable set search_path=public as $$
  select lower(coalesce(string_agg(value #>> '{}', E'\n'), '') collate "C")
  from jsonb_path_query(p_data, 'strict $.** ? (@.type() == "string")') value;
$$;
alter table resumes add column search_text text generated always as (resume_search_text(data)) stored;
-- Non-ASCII rows bypass SQL case folding; JavaScript remains authoritative.
alter table resumes add column search_unicode boolean generated always as (octet_length(data::text) <> char_length(data::text)) stored;
create index resumes_search_text on resumes using gin(search_text extensions.gin_trgm_ops) where deleted_at is null;
create index resumes_search_title on resumes using gin(lower(title collate "C") extensions.gin_trgm_ops) where deleted_at is null;
create index resumes_user_cursor on resumes(user_id,updated_at desc,id desc) where deleted_at is null;
create index agent_runs_resume_created on agent_runs(resume_id,created_at);

create function resume_search_candidates(p_tokens text[],p_phase text,p_before_at timestamptz default null,p_before_id uuid default null)
returns setof resumes language plpgsql stable security invoker set search_path=public,extensions as $$
declare needle text; patterns text[];
begin
  if p_phase not in ('title','body') then raise exception 'Invalid search phase' using errcode='22023'; end if;
  select token into needle from unnest(p_tokens) token where token ~ '^[a-z0-9]{3,}$' order by length(token) desc limit 1;
  if not exists(select 1 from unnest(p_tokens) token where token !~ '^[a-z0-9]{3,}$') then
    select array_agg('%' || token || '%') into patterns from unnest(p_tokens) token;
  end if;
  return query select r.* from resumes r
  where r.user_id=auth.uid() and r.deleted_at is null
    and (p_before_at is null or (r.updated_at,r.id)<(p_before_at,p_before_id))
    and case when p_phase='title' then
      patterns is null or octet_length(r.title)<>char_length(r.title) or lower(r.title collate "C") like any(patterns)
    else needle is null or r.search_unicode or r.search_text like '%' || needle || '%' end
  order by r.updated_at desc,r.id desc limit 51;
end $$;

create function agent_usage_since(p_since timestamptz) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object('count',count(*),'oldest',min(a.created_at))
  from agent_runs a join resumes r on r.id=a.resume_id
  where r.user_id=auth.uid() and a.created_at >= p_since;
$$;
create or replace function reserve_agent_quota() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  if (select count(*) from agent_runs a join resumes r on r.id=a.resume_id where r.user_id=auth.uid() and a.created_at > now()-interval '1 hour') >= 60 then
    raise exception 'Hourly AI limit' using errcode='P0429';
  end if;
  return new;
end $$;

alter table tailor_operations add column dispatch_after timestamptz;
create function lookup_tailor_job(p_platform text,p_external_job_id text) returns jsonb
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
      where j.user_id=auth.uid() and j.platform=p_platform and j.external_job_id=p_external_job_id
      and not exists(select 1 from job_resume_bindings b where b.user_id=auth.uid() and b.platform=p_platform and b.external_job_id=p_external_job_id)
      order by l.created_at desc,l.resume_id desc,l.job_target_id desc limit 1)
  );
$$;
create function claim_tailor_dispatch(p_id uuid) returns timestamptz
language sql volatile security invoker set search_path=public as $$
  update tailor_operations set dispatch_after=now()+interval '30 seconds'
  where id=p_id and user_id=auth.uid() and status='queued' and not legacy
    and deadline>now() and (dispatch_after is null or dispatch_after<=now())
  returning dispatch_after;
$$;
revoke all on function resume_search_candidates(text[],text,timestamptz,uuid),agent_usage_since(timestamptz),lookup_tailor_job(text,text),claim_tailor_dispatch(uuid) from public,anon;
grant execute on function resume_search_candidates(text[],text,timestamptz,uuid),agent_usage_since(timestamptz),lookup_tailor_job(text,text),claim_tailor_dispatch(uuid) to authenticated;
