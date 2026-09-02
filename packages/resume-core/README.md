# @workspace/resume-core

The domain layer: what a resume, a version, a run and a suggestion are, what
can be done to them, and the repository interfaces that persistence must
satisfy.

Depends on `@workspace/resume-schema` and `zod`, and nothing else. No Supabase,
no React, no TanStack, no `cloudflare:workers`. Every service is constructed
with its repositories, so the whole layer runs against the in-memory doubles in
`@workspace/resume-core/testing` with no database.

```text
domain/    types and errors, no behaviour that needs I/O
ports/     the interfaces persistence implements
services/  use cases, composed from ports
testing/   in-memory implementations of every port
```

Supabase implementations of the ports live in `apps/web/src/server/adapters`.
