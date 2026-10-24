begin;
select plan(7);
insert into auth.users(id) values ('90000000-0000-4000-8000-000000000001');
insert into resumes(id,user_id,title,data) values
('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','Base','{"schemaVersion":1,"basics":{"name":"Ada"},"sections":[]}');
insert into conversations(id,user_id,resume_id) values
('92000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into agent_runs(id,conversation_id,resume_id,model) values
('90000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','m');
select is((select kind::text from agent_runs where id = '90000000-0000-4000-8000-000000000101'), 'chat', 'runs default to chat');
select throws_ok($$insert into agent_runs(resume_id, model) values ('91000000-0000-4000-8000-000000000001', 'm')$$, '23514', null, 'chat runs need a conversation');
select lives_ok($$insert into agent_runs(resume_id, model, kind, hint_skill_id) values ('91000000-0000-4000-8000-000000000001', 'm', 'autofill', 'autofill.infer')$$, 'autofill runs need no conversation');
-- 59 more chat runs, so the hour holds 60.
insert into agent_runs(conversation_id,resume_id,model)
select '92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','m' from generate_series(1,59);
select throws_ok($$insert into agent_runs(conversation_id, resume_id, model) values ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'm')$$, 'P0429', 'Hourly AI limit', 'the 61st chat run is refused');
select lives_ok($$insert into agent_runs(resume_id, model, kind) values ('91000000-0000-4000-8000-000000000001', 'm', 'autofill')$$, 'autofill has its own 60');
select is((agent_usage_since(now() - interval '1 hour') ->> 'count')::int, 60, 'usage defaults to chat');
select is((agent_usage_since(now() - interval '1 hour', 'autofill') ->> 'count')::int, 2, 'usage counts autofill on its own');
reset role;
select * from finish();
rollback;
