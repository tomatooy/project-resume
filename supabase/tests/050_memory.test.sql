-- create_memory_summary: inserts the row and moves the active pointer in one
-- call, as `authenticated` through RLS.

begin;
select plan(7);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'memory-owner@example.test'),
  ('a0000000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'memory-intruder@example.test');

insert into resumes (id, user_id, title, data) values
  ('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000011', 'CV',
   '{"schemaVersion":1,"basics":{"id":"basics","name":"A","links":[]},"sections":[]}');

insert into conversations (id, user_id, resume_id) values
  ('c0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000011',
   'b0000000-0000-4000-8000-000000000011');

create temp table res (step text primary key, payload jsonb);
grant all on res to authenticated;

-- ------------------------------------------------------------ as the owner

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated"}';
set local role authenticated;

insert into res select 'first', to_jsonb(create_memory_summary(
  'c0000000-0000-4000-8000-000000000011',
  '{"resume_focus":["experience"]}', 'Focus: experience', 1, 12, 'fast-model'));

select is((select payload->>'conversation_id' from res where step = 'first'),
          'c0000000-0000-4000-8000-000000000011', 'returns the inserted row');
select is((select payload->>'summary_text' from res where step = 'first'),
          'Focus: experience', 'stores the rendered text');
select is((select active_summary_id from conversations where id = 'c0000000-0000-4000-8000-000000000011'),
          (select (payload->>'id')::uuid from res where step = 'first'),
          'the conversation points at the new summary');

insert into res select 'second', to_jsonb(create_memory_summary(
  'c0000000-0000-4000-8000-000000000011',
  '{"resume_focus":["education"]}', 'Focus: education', 13, 24, 'fast-model'));

select is((select active_summary_id from conversations where id = 'c0000000-0000-4000-8000-000000000011'),
          (select (payload->>'id')::uuid from res where step = 'second'),
          'a second consolidation moves the pointer');
select is((select count(*) from memory_summaries where conversation_id = 'c0000000-0000-4000-8000-000000000011'),
          2::bigint, 'earlier summaries are kept');

-- ------------------------------------------------------------ as user B

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000012","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$ select create_memory_summary('c0000000-0000-4000-8000-000000000011',
       '{}', 'stolen', 1, 2, 'fast-model') $$,
  '42501', null, 'another user cannot summarise a conversation they do not own');
select is((select count(*) from memory_summaries where conversation_id = 'c0000000-0000-4000-8000-000000000011'),
          0::bigint, 'another user cannot read the summaries');

select * from finish();
rollback;
