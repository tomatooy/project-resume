create or replace function lookup_tailor_job(p_platform text,p_external_job_id text) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'apply_url',(select j.apply_url from job_resume_bindings b
      join resumes r on r.id=b.resume_id and r.deleted_at is null
      join job_targets j on j.id=b.job_target_id
      where b.user_id=auth.uid() and b.platform=p_platform and b.external_job_id=p_external_job_id),
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
