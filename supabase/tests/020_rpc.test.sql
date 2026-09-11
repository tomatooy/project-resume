-- create_resume_version and decide_suggestions.
--
-- Every call runs as the `authenticated` role with a JWT claim set, not as
-- postgres. Both functions are `security invoker`, so this is the only way to
-- exercise them the way PostgREST will: through RLS, with no bypass available.

begin;
select plan(23);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rpc@example.test');

insert into resumes (id, user_id, title, data) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'CV',
   '{"schemaVersion":1,"basics":{"id":"basics","name":"v0","links":[]},"sections":[]}');

insert into conversations (id, user_id, resume_id) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001');

insert into agent_runs (id, conversation_id, resume_id, hint_skill_id, model) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'tighten-bullets', 'demo'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'tighten-bullets', 'demo');

insert into suggestions (id, agent_run_id, resume_id, ordinal, patch, target_node_id, operation) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 0, '{}', 'n1', 'replace_text'),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 1, '{}', 'n2', 'replace_text'),
  -- Belongs to the *other* run. A decision naming it must be ignored.
  ('e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 0, '{}', 'n3', 'replace_text');

-- Owned by postgres, but written to after the role switch below.
create temp table res (step text primary key, payload jsonb);
grant all on res to authenticated;

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;

-- ------------------------------------------------- create_resume_version

insert into res select 'v1', create_resume_version(
  'b0000000-0000-4000-8000-000000000001',
  '{"schemaVersion":1,"basics":{"id":"basics","name":"v1","links":[]},"sections":[]}',
  1, 'hash-1', 'First', 'user', null);

select is((select (payload->'version'->>'version_no')::int from res where step = 'v1'),
          1, 'the first version is version_no 1');
select is((select (payload->>'deduped')::boolean from res where step = 'v1'),
          false, 'the first version is not a dedupe');
select is((select current_version_id from resumes where id = 'b0000000-0000-4000-8000-000000000001'),
          (select (payload->'version'->>'id')::uuid from res where step = 'v1'),
          'the head points at the new version');
select is((select data->'basics'->>'name' from resumes where id = 'b0000000-0000-4000-8000-000000000001'),
          'v1', 'the resume data is moved onto the version content');
select is((select revision from resumes where id = 'b0000000-0000-4000-8000-000000000001'),
          2::bigint, 'creating a version bumps revision');
select is((select (payload->>'revision')::bigint from res where step = 'v1'),
          (select revision from resumes where id = 'b0000000-0000-4000-8000-000000000001'),
          'the returned revision is the token the trigger just produced');

insert into res select 'v2', create_resume_version(
  'b0000000-0000-4000-8000-000000000001',
  '{"schemaVersion":1,"basics":{"id":"basics","name":"v2","links":[]},"sections":[]}',
  1, 'hash-2', 'Second', 'user', null);

select is((select (payload->'version'->>'version_no')::int from res where step = 'v2'),
          2, 'the next version is version_no 2');

-- Drop v1 so count(*) is 1 while max(version_no) is 2. count + 1 would collide
-- with the row that is already there; max + 1 is the only correct rule.
delete from resume_versions where id = (select (payload->'version'->>'id')::uuid from res where step = 'v1');

insert into res select 'v3', create_resume_version(
  'b0000000-0000-4000-8000-000000000001',
  '{"schemaVersion":1,"basics":{"id":"basics","name":"v3","links":[]},"sections":[]}',
  1, 'hash-3', 'Third', 'user', null);

select is((select (payload->'version'->>'version_no')::int from res where step = 'v3'),
          3, 'version_no is max + 1, not count + 1');

-- ------------------------------------------------------------- dedupe

insert into res select 'dupe', create_resume_version(
  'b0000000-0000-4000-8000-000000000001',
  '{"schemaVersion":1,"basics":{"id":"basics","name":"edited-head","links":[]},"sections":[]}',
  1, 'hash-3', 'Third again', 'user', null);

select is((select (payload->>'deduped')::boolean from res where step = 'dupe'),
          true, 'a hash equal to the current version dedupes');
select is((select count(*) from resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
          2::bigint, 'a dedupe writes no new version row');
select is((select data->'basics'->>'name' from resumes where id = 'b0000000-0000-4000-8000-000000000001'),
          'edited-head',
          'a dedupe still writes the content to the head, so restoring the current version is not a no-op');

insert into res select 'forced', create_resume_version(
  'b0000000-0000-4000-8000-000000000001',
  '{"schemaVersion":1,"basics":{"id":"basics","name":"v3","links":[]},"sections":[]}',
  1, 'hash-3', 'Restored from v3', 'user', null, false);

select is((select (payload->>'deduped')::boolean from res where step = 'forced'),
          false, 'p_dedupe false records a version even when the hash matches');
select is((select (payload->'version'->>'version_no')::int from res where step = 'forced'),
          4, 'the forced version still gets max + 1');

select throws_ok(
  $$ select create_resume_version('b0000000-0000-4000-8000-0000000000ff',
       '{"schemaVersion":1}'::jsonb, 1, 'hash-x', null, 'user'::created_by_kind, null) $$,
  '42501', null,
  'a resume the caller cannot see is refused by RLS, not silently written'
);

-- -------------------------------------------------- decide_suggestions

insert into res select 'reject', decide_suggestions(
  'd0000000-0000-4000-8000-000000000001',
  '[{"suggestionId":"e0000000-0000-4000-8000-000000000002","status":"rejected"}]',
  null, null);

select is((select payload->'version' from res where step = 'reject'),
          'null'::jsonb, 'rejecting everything creates no version');
select is((select count(*) from resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
          3::bigint, 'rejecting everything leaves the version count alone');
select is((select status::text from suggestions where id = 'e0000000-0000-4000-8000-000000000002'),
          'rejected', 'the rejected suggestion is marked rejected');
select isnt((select decided_at from suggestions where id = 'e0000000-0000-4000-8000-000000000002'),
            null, 'the rejected suggestion is stamped decided_at');

insert into res select 'accept', decide_suggestions(
  'd0000000-0000-4000-8000-000000000001',
  '[{"suggestionId":"e0000000-0000-4000-8000-000000000001","status":"accepted"},
    {"suggestionId":"e0000000-0000-4000-8000-000000000003","status":"accepted"}]',
  '{"schemaVersion":1,"basics":{"id":"basics","name":"accepted","links":[]},"sections":[]}',
  'hash-accepted');

select is((select count(*) from resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
          4::bigint, 'accepting creates exactly one version');
select is((select status::text from suggestions where id = 'e0000000-0000-4000-8000-000000000001'),
          'accepted', 'the accepted suggestion is marked accepted');
select is((select status::text from suggestions where id = 'e0000000-0000-4000-8000-000000000003'),
          'pending', 'a decision naming another run''s suggestion is ignored');
select is((select created_by::text from resume_versions
            where id = (select (payload->'version'->>'id')::uuid from res where step = 'accept')),
          'agent', 'the version created by accepting is attributed to the agent');
select is((select agent_run_id from resume_versions
            where id = (select (payload->'version'->>'id')::uuid from res where step = 'accept')),
          'd0000000-0000-4000-8000-000000000001'::uuid,
          'the version created by accepting is linked to the run');

reset role;
select * from finish();
rollback;
