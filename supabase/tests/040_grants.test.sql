-- The grant layer, which sits in front of RLS.
--
-- These assertions are what stopped the missing-grants bug from reaching the
-- app: a policy can be perfectly written and still never be consulted, because
-- Postgres checks the table privilege first.

begin;
select plan(8);

-- `anon` is the role PostgREST uses for a request with no JWT. Every screen in
-- this application is behind sign-in, so it should fail at the grant.
set local role anon;
select throws_ok($$ select 1 from resumes limit 1 $$, '42501', null,
                 'anon cannot read resumes at all');
select throws_ok($$ select 1 from suggestions limit 1 $$, '42501', null,
                 'anon cannot read suggestions at all');
select throws_ok(
  $$ select create_resume_version('22222222-0000-4000-8000-000000000001'::uuid,
       '{}'::jsonb, 1, 'h', null, 'user'::created_by_kind, null) $$,
  '42501', null, 'anon cannot call create_resume_version');
select throws_ok(
  $$ select decide_suggestions('77777777-0000-4000-8000-000000000001'::uuid, '[]'::jsonb, null, null) $$,
  '42501', null, 'anon cannot call decide_suggestions');

-- `service_role` bypasses RLS, so it is granted nothing. No service-role key is
-- issued anywhere in the request path, and a leaked one should read no rows.
reset role;
set local role service_role;
select throws_ok($$ select 1 from resumes limit 1 $$, '42501', null,
                 'service_role cannot read resumes even though it bypasses RLS');
select throws_ok($$ select 1 from messages limit 1 $$, '42501', null,
                 'service_role cannot read messages either');

-- The positive control for the grants themselves. No JWT claim is set, so
-- auth.uid() is null and the policies match nothing; the point is only that
-- the statement is permitted and returns empty rather than raising.
reset role;
set local role authenticated;
select lives_ok($$ select 1 from resumes limit 1 $$,
                'authenticated is allowed to query resumes');
select is((select count(*) from resumes), 0::bigint,
          'authenticated with no claim sees nothing, via RLS rather than an error');

reset role;
select * from finish();
rollback;
