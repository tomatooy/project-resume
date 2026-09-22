# Database tests

Two suites, both against a running local stack:

```bash
bun run db:test    # pgTAP: the SQL itself
SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep '^SERVICE_ROLE_KEY' | cut -d'"' -f2) \
  bun run db:check # the TypeScript adapters, through PostgREST
```

Both are root scripts. Neither runs under `bun run test`: both need Docker, and
the unit suites have to stay runnable without it.

`db:check` lives at `apps/web/scripts/check-adapters.ts`. It drives the real
services against the real database as two signed-in users, which is what proves
the row mappers agree with the schema. A mistyped column fails there rather than
the first time somebody clicks the button.

## The pgTAP suites

These cover what lives in SQL and therefore cannot be reached from
`packages/resume-core`, whose tests run against in-memory doubles:

| File | What it pins |
|---|---|
| `010_trigger.test.sql` | `revision` moves only when `data` changes, and a client cannot forge it |
| `020_rpc.test.sql` | `create_resume_version` and `decide_suggestions`, called as `authenticated` through RLS |
| `030_rls.test.sql` | Tenant isolation on all seven tables, plus a positive control |
| `040_grants.test.sql` | `anon` and `service_role` are refused before RLS is consulted |
| `060_skills.test.sql` | Description is required; when-to-use guidance is optional |
| `050_memory.test.sql` | `create_memory_summary` inserts and activates in one call, and only for the owner |

## Two things to know before adding a test

**pg_prove runs each file in one transaction, so `now()` never advances.**
`updated_at` cannot be watched moving between two statements. `010` works around
this by inserting the row with an `updated_at` an hour in the past and asserting
the trigger stamps it back to `now()`. The same four properties were also
checked across real transactions with a throwaway psql script; if you change the
trigger, that is worth redoing.

**Set the role, not just the claim.** RLS is only consulted for a non-superuser,
and `pg_prove` connects as `postgres`. Every suite does its fixture setup as
`postgres`, then:

```sql
set local request.jwt.claims = '{"sub":"<user id>","role":"authenticated"}';
set local role authenticated;
```

Temp tables created before the switch need `grant all on <table> to authenticated`.
