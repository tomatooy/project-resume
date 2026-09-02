-- Grants are the other half of the authorization boundary.
--
-- RLS decides which rows a role may touch; the grant decides whether it may
-- touch the table at all. Postgres requires both, and Supabase's defaults give
-- the API roles only REFERENCES, TRIGGER and TRUNCATE. Without this migration
-- every PostgREST request fails with "permission denied for table resumes"
-- before a policy is ever consulted.

-- Start from nothing, so the grants below are the complete list.
revoke all on all tables    in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

-- `authenticated` is the only role the application ever runs as. Every screen
-- is behind sign-in, so `anon` needs no access to any table: an unauthenticated
-- request should fail at the grant, before RLS has to be right.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- `service_role` is deliberately left with nothing. It bypasses RLS, and this
-- application issues no service-role key anywhere in the request path, so a
-- leaked one should not be able to read a single row either.

-- Future tables in this schema get the same treatment, so adding one cannot
-- silently produce a table the application is unable to reach.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Functions are executable by PUBLIC by default, which would leave both RPCs
-- callable by `anon`. They are `security invoker`, so RLS would still stop an
-- anonymous caller reading anything, but the call should not be reachable.
revoke all on function create_resume_version(uuid, jsonb, int, text, text, created_by_kind, uuid, boolean) from public;
revoke all on function decide_suggestions(uuid, jsonb, jsonb, text) from public;

grant execute on function create_resume_version(uuid, jsonb, int, text, text, created_by_kind, uuid, boolean) to authenticated;
grant execute on function decide_suggestions(uuid, jsonb, jsonb, text) to authenticated;
