\set ON_ERROR_STOP on
begin;
create temporary table perf_user as select gen_random_uuid() id;
insert into auth.users(id) select id from perf_user;
insert into resumes(user_id,title,data)
select u.id, 'Resume ' || n,
  jsonb_build_object('schemaVersion',1,'basics',jsonb_build_object('name','Person ' || n,'summary',repeat('Experienced engineer delivering reliable systems. ',300) || case when n % 100 = 0 then ' rarekeyword' else '' end),'sections','[]'::jsonb)
from perf_user u cross join generate_series(1,1000) n;
insert into resume_versions(resume_id,version_no,content,schema_version,content_hash,created_by)
select r.id,n,r.data,1,n::text,'user' from resumes r cross join generate_series(1,1000) n
where r.user_id=(select id from perf_user) and r.title='Resume 1';
analyze resumes;
analyze resume_versions;
\if :optimized
select gin_clean_pending_list('resumes_search_text');
select gin_clean_pending_list('resumes_search_title');
\endif
select set_config('request.jwt.claim.sub',(select id::text from perf_user),true);
-- Index eligibility probe before RLS, matching the private owner-scoped helper.
\if :optimized
explain (analyze,buffers) select id from resumes where user_id=auth.uid() and deleted_at is null and search_text like '%rarekeyword%';
\endif
select id as version_resume_id from resumes where user_id=auth.uid() and title='Resume 1' \gset
set local role authenticated;
\timing on
\if :optimized
explain (analyze,buffers) select count(*) from resumes where deleted_at is null;
explain (analyze,buffers) select id,title,subtitle,template_id,updated_at from resumes where deleted_at is null and user_id=auth.uid() order by updated_at desc,id desc limit 31;
select octet_length(json_agg(r)::text) as summary_payload_bytes from (select id,title,subtitle,template_id,updated_at from resumes where deleted_at is null order by updated_at desc,id desc limit 30) r;
explain (analyze,buffers) select id from resume_search_candidates(array['rarekeyword'],'body');
select octet_length(json_agg(r)::text) as search_payload_bytes from (select id,user_id,title,subtitle,data,schema_version,template_id,template_options,current_version_id,revision,created_at,updated_at,deleted_at from resume_search_candidates(array['rarekeyword'],'body')) r;
explain (analyze,buffers) select id,version_no,label,created_by,created_at from resume_versions where resume_id=:'version_resume_id' order by version_no desc limit 31;
select octet_length(json_agg(v)::text) as version_payload_bytes from (select id,version_no,label,created_by,created_at from resume_versions where resume_id=:'version_resume_id' order by version_no desc limit 30) v;
\else
explain (analyze,buffers) select id,title,subtitle,template_id,updated_at from resumes where deleted_at is null order by updated_at desc;
select octet_length(json_agg(r)::text) as summary_payload_bytes from (select id,title,subtitle,template_id,updated_at from resumes where deleted_at is null order by updated_at desc) r;
explain (analyze,buffers) select id,user_id,title,subtitle,data,schema_version,template_id,template_options,current_version_id,revision,created_at,updated_at,deleted_at from resumes where deleted_at is null order by updated_at desc;
select octet_length(json_agg(r)::text) as search_payload_bytes from (select id,user_id,title,subtitle,data,schema_version,template_id,template_options,current_version_id,revision,created_at,updated_at,deleted_at from resumes where deleted_at is null order by updated_at desc) r;
explain (analyze,buffers) select id,version_no,label,created_by,created_at from resume_versions where resume_id=:'version_resume_id' order by version_no desc;
select octet_length(json_agg(v)::text) as version_payload_bytes from (select id,version_no,label,created_by,created_at from resume_versions where resume_id=:'version_resume_id' order by version_no desc) v;
\endif
rollback;
