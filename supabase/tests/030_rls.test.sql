-- Tenant isolation, table by table.
--
-- This is the suite that justifies having no service-role key: RLS is the only
-- thing standing between two users, so every table gets the same four
-- questions asked of it, as user B holding a real JWT claim.
--
--   1. can B read A's row?          must be no rows, never an error
--   2. can B update A's row?        must affect zero rows
--   3. can B delete A's row?        must affect zero rows
--   4. can B insert a row parented on A's?   must raise 42501
--
-- Reads and updates come back empty rather than throwing on purpose: PostgREST
-- surfaces that as a 404, so another user's resume is indistinguishable from
-- one that does not exist.

begin;
select plan(35);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner@example.test'),
  ('11111111-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'intruder@example.test');

insert into resumes (id, user_id, title, data) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'A''s CV',
   '{"schemaVersion":1,"basics":{"id":"basics","name":"A","links":[]},"sections":[]}'),
  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', 'B''s CV',
   '{"schemaVersion":1,"basics":{"id":"basics","name":"B","links":[]},"sections":[]}');

insert into resume_versions (id, resume_id, version_no, content, schema_version, content_hash, created_by) values
  ('33333333-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 1,
   '{"schemaVersion":1}', 1, 'hash-a', 'user');

insert into conversations (id, user_id, resume_id) values
  ('44444444-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001'),
  ('44444444-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002',
   '22222222-0000-4000-8000-000000000002');

insert into messages (id, conversation_id, role, content) values
  ('55555555-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001',
   'user', '{"text":"private"}');

insert into memory_summaries
  (id, conversation_id, summary, summary_text, source_from_seq, source_to_seq, model) values
  ('66666666-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001',
   '{}', 'private summary', 1, 2, 'demo');

insert into agent_runs (id, conversation_id, resume_id, skill_id, model) values
  ('77777777-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001', 'tighten-bullets', 'demo');

insert into suggestions (id, agent_run_id, resume_id, ordinal, patch, target_node_id, operation) values
  ('88888888-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001', 0, '{}', 'n1', 'replace_text');

create temp table probe (step text primary key, n bigint);
grant all on probe to authenticated;

-- ------------------------------------------------------------ as user B

set local request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;

-- resumes
select is((select count(*) from resumes where id = '22222222-0000-4000-8000-000000000001'),
          0::bigint, 'B cannot read A''s resume');
with u as (update resumes set title = 'owned' where id = '22222222-0000-4000-8000-000000000001' returning 1)
insert into probe select 'resumes_update', count(*) from u;
select is((select n from probe where step = 'resumes_update'), 0::bigint, 'B cannot update A''s resume');
with d as (delete from resumes where id = '22222222-0000-4000-8000-000000000001' returning 1)
insert into probe select 'resumes_delete', count(*) from d;
select is((select n from probe where step = 'resumes_delete'), 0::bigint, 'B cannot delete A''s resume');
select throws_ok(
  $$ insert into resumes (user_id, title, data)
     values ('11111111-0000-4000-8000-000000000001', 'planted', '{"schemaVersion":1}') $$,
  '42501', null, 'B cannot create a resume owned by A');

-- resume_versions
select is((select count(*) from resume_versions where id = '33333333-0000-4000-8000-000000000001'),
          0::bigint, 'B cannot read A''s versions');
with u as (update resume_versions set label = 'owned' where id = '33333333-0000-4000-8000-000000000001' returning 1)
insert into probe select 'versions_update', count(*) from u;
select is((select n from probe where step = 'versions_update'), 0::bigint, 'B cannot update A''s versions');
with d as (delete from resume_versions where id = '33333333-0000-4000-8000-000000000001' returning 1)
insert into probe select 'versions_delete', count(*) from d;
select is((select n from probe where step = 'versions_delete'), 0::bigint, 'B cannot delete A''s versions');
select throws_ok(
  $$ insert into resume_versions (resume_id, version_no, content, schema_version, content_hash, created_by)
     values ('22222222-0000-4000-8000-000000000001', 99, '{}', 1, 'planted', 'user') $$,
  '42501', null, 'B cannot add a version to A''s resume');

-- conversations
select is((select count(*) from conversations where id = '44444444-0000-4000-8000-000000000001'),
          0::bigint, 'B cannot read A''s conversation');
with u as (update conversations set title = 'owned' where id = '44444444-0000-4000-8000-000000000001' returning 1)
insert into probe select 'conversations_update', count(*) from u;
select is((select n from probe where step = 'conversations_update'), 0::bigint, 'B cannot update A''s conversation');
with d as (delete from conversations where id = '44444444-0000-4000-8000-000000000001' returning 1)
insert into probe select 'conversations_delete', count(*) from d;
select is((select n from probe where step = 'conversations_delete'), 0::bigint, 'B cannot delete A''s conversation');
select throws_ok(
  $$ insert into conversations (user_id, resume_id)
     values ('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001') $$,
  '42501', null, 'B cannot start a conversation on A''s resume');

-- messages
select is((select count(*) from messages where id = '55555555-0000-4000-8000-000000000001'),
          0::bigint, 'B cannot read A''s messages');
with u as (update messages set content = '{"text":"owned"}' where id = '55555555-0000-4000-8000-000000000001' returning 1)
insert into probe select 'messages_update', count(*) from u;
select is((select n from probe where step = 'messages_update'), 0::bigint, 'B cannot update A''s messages');
with d as (delete from messages where id = '55555555-0000-4000-8000-000000000001' returning 1)
insert into probe select 'messages_delete', count(*) from d;
select is((select n from probe where step = 'messages_delete'), 0::bigint, 'B cannot delete A''s messages');
select throws_ok(
  $$ insert into messages (conversation_id, role, content)
     values ('44444444-0000-4000-8000-000000000001', 'user', '{"text":"planted"}') $$,
  '42501', null, 'B cannot post into A''s conversation');

-- memory_summaries
select is((select count(*) from memory_summaries where id = '66666666-0000-4000-8000-000000000001'),
          0::bigint, 'B cannot read A''s memory summaries');
with u as (update memory_summaries set summary_text = 'owned' where id = '66666666-0000-4000-8000-000000000001' returning 1)
insert into probe select 'summaries_update', count(*) from u;
select is((select n from probe where step = 'summaries_update'), 0::bigint, 'B cannot update A''s memory summaries');
with d as (delete from memory_summaries where id = '66666666-0000-4000-8000-000000000001' returning 1)
insert into probe select 'summaries_delete', count(*) from d;
select is((select n from probe where step = 'summaries_delete'), 0::bigint, 'B cannot delete A''s memory summaries');
select throws_ok(
  $$ insert into memory_summaries (conversation_id, summary, summary_text, source_from_seq, source_to_seq, model)
     values ('44444444-0000-4000-8000-000000000001', '{}', 'planted', 1, 2, 'demo') $$,
  '42501', null, 'B cannot add a memory summary to A''s conversation');

-- agent_runs
select is((select count(*) from agent_runs where id = '77777777-0000-4000-8000-000000000001'),
          0::bigint, 'B cannot read A''s agent runs');
with u as (update agent_runs set status = 'cancelled' where id = '77777777-0000-4000-8000-000000000001' returning 1)
insert into probe select 'runs_update', count(*) from u;
select is((select n from probe where step = 'runs_update'), 0::bigint, 'B cannot update A''s agent runs');
with d as (delete from agent_runs where id = '77777777-0000-4000-8000-000000000001' returning 1)
insert into probe select 'runs_delete', count(*) from d;
select is((select n from probe where step = 'runs_delete'), 0::bigint, 'B cannot delete A''s agent runs');
select throws_ok(
  $$ insert into agent_runs (conversation_id, resume_id, skill_id, model)
     values ('44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'planted', 'demo') $$,
  '42501', null, 'B cannot start a run against A''s resume');

-- suggestions
select is((select count(*) from suggestions where id = '88888888-0000-4000-8000-000000000001'),
          0::bigint, 'B cannot read A''s suggestions');
with u as (update suggestions set status = 'accepted' where id = '88888888-0000-4000-8000-000000000001' returning 1)
insert into probe select 'suggestions_update', count(*) from u;
select is((select n from probe where step = 'suggestions_update'), 0::bigint,
          'B cannot accept a suggestion on A''s resume');
with d as (delete from suggestions where id = '88888888-0000-4000-8000-000000000001' returning 1)
insert into probe select 'suggestions_delete', count(*) from d;
select is((select n from probe where step = 'suggestions_delete'), 0::bigint, 'B cannot delete A''s suggestions');
select throws_ok(
  $$ insert into suggestions (agent_run_id, resume_id, ordinal, patch, target_node_id, operation)
     values ('77777777-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001',
             9, '{}', 'planted', 'replace_text') $$,
  '42501', null, 'B cannot plant a suggestion on A''s resume');

-- ------------------------------------------------------------ as user A
-- The positive control. Without it every assertion above would also pass if
-- the policies simply denied everyone.

reset role;
set local request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from resumes where id = '22222222-0000-4000-8000-000000000001'),
          1::bigint, 'A can read A''s resume');
select is((select count(*) from resume_versions where id = '33333333-0000-4000-8000-000000000001'),
          1::bigint, 'A can read A''s versions');
select is((select count(*) from conversations where id = '44444444-0000-4000-8000-000000000001'),
          1::bigint, 'A can read A''s conversation');
select is((select count(*) from messages where id = '55555555-0000-4000-8000-000000000001'),
          1::bigint, 'A can read A''s messages');
select is((select count(*) from memory_summaries where id = '66666666-0000-4000-8000-000000000001'),
          1::bigint, 'A can read A''s memory summaries');
select is((select count(*) from agent_runs where id = '77777777-0000-4000-8000-000000000001'),
          1::bigint, 'A can read A''s agent runs');
select is((select count(*) from suggestions where id = '88888888-0000-4000-8000-000000000001'),
          1::bigint, 'A can read A''s suggestions');

reset role;
select * from finish();
rollback;
