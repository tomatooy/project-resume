begin;
select plan(24);

select is(enum_range(null::job_platform)::text, '{linkedin,indeed}', 'platform enum contains the supported values');
insert into auth.users(id,instance_id,aud,role,email) values
 ('90000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tailor-inputs-a@example.test'),
 ('90000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tailor-inputs-b@example.test');
insert into resumes(id,user_id,title,data) values
 ('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','Base','{"schemaVersion":1,"basics":{"name":"Original"},"sections":[]}');
create temporary table test_attempts(name text primary key, op jsonb);
grant all on test_attempts to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select lives_ok($$insert into job_targets(user_id,platform,external_job_id,raw_text)
  values(auth.uid(),'indeed','abc123def456','Description')$$, 'Indeed targets accept non-numeric identities');
select is((select pg_typeof(platform)::text from job_targets limit 1),'job_platform','target platform uses the enum');
select throws_ok($$insert into job_targets(user_id,platform,external_job_id,raw_text)
  values(auth.uid(),'other','123456','Description')$$,'22P02',null,'unsupported platforms are rejected');
select throws_ok($$insert into job_targets(user_id,platform,external_job_id,raw_text)
  values(auth.uid(),'linkedin','abc123','Description')$$,'23514',null,'LinkedIn retains numeric identity validation');
select throws_ok($$insert into job_targets(user_id,apply_url,raw_text)
  values(auth.uid(),'javascript:alert(1)','Description')$$,'23514',null,'application links require HTTP or HTTPS');

insert into test_attempts values('first',tailor_admit(jsonb_build_object(
  'platform','linkedin','externalJobId','123456',
  'sourceResumeId','91000000-0000-4000-8000-000000000001',
  'sourceUrl','https://www.linkedin.com/jobs/view/123456',
  'applyUrl','https://jobs.example.test/123456?source=linkedin',
  'additionalInstruction','Emphasize backend work',
  'jobText',repeat('Job description ',20),
  'idempotencyKey','92000000-0000-4000-8000-000000000001',
  'expectedRevision',1,
  'document','{"schemaVersion":1,"basics":{"name":"Original"},"sections":[]}'::jsonb,
  'contentHash','initial'
)));
select is((select apply_url from job_targets where external_job_id='123456'),
  'https://jobs.example.test/123456?source=linkedin','admission stores the external application URL');
select is((select j.apply_url from resume_job_targets l join job_targets j on j.id=l.job_target_id
  where l.resume_id=(select (op->>'resume_id')::uuid from test_attempts where name='first') and l.is_origin),
  'https://jobs.example.test/123456?source=linkedin','generated copy is linked to its application URL');
select is((select op->>'additional_instruction' from test_attempts where name='first'),
  'Emphasize backend work','admission snapshots the instruction');
select is(lookup_tailor_job('linkedin','123456')->'operation'->>'additional_instruction',
  'Emphasize backend work','lookup returns the saved instruction');
select is(lookup_tailor_job('linkedin','123456')->>'apply_url',
  'https://jobs.example.test/123456?source=linkedin','lookup returns the saved application URL');
select is(tailor_admit(jsonb_build_object('platform','linkedin','externalJobId','123456',
  'idempotencyKey','92000000-0000-4000-8000-000000000001','additionalInstruction','Changed replay'))->>'additional_instruction',
  'Emphasize backend work','replay preserves the original instruction');
select throws_ok($$update tailor_operations set additional_instruction=repeat('x',4001)$$,
  '23514',null,'stored instruction length is bounded');

select tailor_transition((select (op->>'id')::uuid from test_attempts where name='first'),'cancel');
insert into test_attempts values('inherited',tailor_admit(jsonb_build_object(
  'platform','linkedin','externalJobId','123456',
  'expectedOperationId',(select op->>'id' from test_attempts where name='first'),
  'idempotencyKey','92000000-0000-4000-8000-000000000002',
  'expectedRevision',1,'contentHash','initial')));
select is((select op->>'additional_instruction' from test_attempts where name='inherited'),
  'Emphasize backend work','retry without an instruction inherits it');
select tailor_transition((select (op->>'id')::uuid from test_attempts where name='inherited'),'cancel');
insert into test_attempts values('changed',tailor_admit(jsonb_build_object(
  'platform','linkedin','externalJobId','123456',
  'expectedOperationId',(select op->>'id' from test_attempts where name='inherited'),
  'idempotencyKey','92000000-0000-4000-8000-000000000003',
  'additionalInstruction','Keep the summary concise',
  'expectedRevision',1,'contentHash','initial')));
select is((select op->>'additional_instruction' from test_attempts where name='changed'),
  'Keep the summary concise','retry can use a different instruction');
select is((select additional_instruction from tailor_operations where id=(select (op->>'id')::uuid from test_attempts where name='first')),
  'Emphasize backend work','retry does not rewrite the previous attempt');
select tailor_transition((select (op->>'id')::uuid from test_attempts where name='changed'),'cancel');
insert into test_attempts values('cleared',tailor_admit(jsonb_build_object(
  'platform','linkedin','externalJobId','123456',
  'expectedOperationId',(select op->>'id' from test_attempts where name='changed'),
  'idempotencyKey','92000000-0000-4000-8000-000000000004',
  'additionalInstruction','',
  'expectedRevision',1,'contentHash','initial')));
select is((select op->>'additional_instruction' from test_attempts where name='cleared'),
  '','retry can explicitly clear the instruction');

insert into job_targets(id,user_id,platform,external_job_id,apply_url,raw_text)
  values('93000000-0000-4000-8000-000000000001',auth.uid(),'linkedin','654321','https://jobs.example.test/654321','Legacy posting');
insert into resume_job_targets(resume_id,job_target_id,is_origin)
  values('91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',true);
select is(lookup_tailor_job('linkedin','654321')->>'legacy_resume_id',
  '91000000-0000-4000-8000-000000000001','legacy lookup compares text input to the enum');
select lives_ok($$select tailor_adopt('linkedin','654321','91000000-0000-4000-8000-000000000001','legacy')$$,
  'adoption and binding RLS work with enum platforms');
select is(lookup_tailor_job('linkedin','654321')->'operation'->>'additional_instruction',
  '','legacy adoption defaults to no instruction');

select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from job_targets where apply_url is not null),0,'application URLs remain owner-only');
select is((select count(*)::int from tailor_operations where additional_instruction <> ''),0,'instructions remain owner-only');
select is(lookup_tailor_job('linkedin','123456')->'operation','null'::jsonb,'another user cannot look up the saved attempt');
select is(lookup_tailor_job('linkedin','123456')->'apply_url','null'::jsonb,'another user cannot look up the application URL');

reset role;
select * from finish();
rollback;
