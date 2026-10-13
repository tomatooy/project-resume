# Universal autofill implementation graph

Specification: [current-page v1](../specs/universal-autofill.md).

| Task | Depends on | Acceptance slice | Status |
| --- | --- | --- | --- |
| U1 | None | Pinned source and scoped-answer contracts, facts, persistence and tests | Complete |
| U2 | Page contract from U3 | Page reader, safe refs, live state, add-record interaction and DOM tests | Complete |
| U3 | Concept contract from U1 | Grounded page interpretation and review-only drafting with model doubles | Complete |
| U4 | U1, U2, U3 | API wiring, tab application sessions, bounded execution, review/save UI | Complete |
| U5 | U4 | Static checks, regression suites, standards/spec review, manual acceptance guide | Complete |

The main agent integrates in the existing working tree. Parallel agents own
nonoverlapping modules. Existing uncommitted files are preserved, and this work
does not create commits or deploy anything.

## Verification and review

- TypeScript: all 9 workspace tasks pass.
- Core: 241 tests pass. API contract: 3 tests pass.
- Extension: all 252 tests pass, including final readback, batch confirmations,
  bounded retries, safe record creation, and tab-session lifecycle.
- Model layer: 44 focused autofill interpreter, drafting, and Jev tests pass.
- Web: 24 focused Profile, saved answers, adapter, and HTTP API tests pass.
- Biome: all 65 changed TypeScript/TSX/JSON files pass.
- Local database: applied `20261013120000_autofill_scoped_answers.sql` with
  `supabase migration up --local`. All 197 SQL tests and the adapter integration
  script pass, including scoped-answer ownership and concurrent writes.
- Full-suite existing failures: `packages/agent/test/models.test.ts` expects
  enabled smart-tier thinking while its source config disables it;
  `apps/web/src/lib/word-diff.test.tsx` has two outdated color-class assertions.
  Both tests and their implementation files match the captured starting hashes.

Standards and spec reviews found and addressed account-token races, repeated
interpretation budget exhaustion, successful writes consuming retry budgets,
final nonempty-value drift, source-record duplication across batches, and DOM
context leaking editor contents. No build or browser automation was run.

## Manual acceptance

1. Open `/autofill-profile`: identity fields include display name, contact email,
   and phone. Saved answers can be reviewed, edited with conflict handling, or
   removed. Their conditions remain explicit.
2. On an application page, choose a resume and click Fill current page. Confirm
   dropdown/radio interactions are visible. Existing values remain preserved.
3. Review multiple uncertain fields and click Fill confirmed answers once.
   Generate an open-answer draft, edit it, and confirm it before filling.
4. Confirm a temporary answer, then separately choose its Profile or scoped
   save destination. Temporary experience/education supplements never modify
   the resume.
5. Navigate manually to another page of a recognized application. Sources and
   confirmed answers remain available; old DOM references are discarded.
   Close the application tab, reopen it, and confirm a fresh session starts.
6. Edit a field while filling. Automatic operations stop; Continue rereads the
   page. Check final results for preserved, failed, and unverified controls.

## Deployment and limits

The backend still uses `AUTOFILL_ENABLED` and `AUTOFILL_JEV_ENABLED` (or the
existing policy override) to enable execution and model interpretation. New
schema changes were applied only to the local test stack. Deploying the backend,
applying the production migration, and rebuilding/reloading the extension are
separate release steps.

Only the current page is operated. Inaccessible frames, opaque widgets, unknown
committed values, and incomplete record groups remain visible review items.
Large projected or truncated pages do not infer empty record assignments when
other groups may be missing. Session reuse requires a recognized stable job or
application identity; unrecognized navigation starts fresh. Interpretation
cache is best effort within a server instance, bounded to 64 entries and five
minutes; a cold cache still obeys the model-call budget.

Final test commands:

```sh
bun run typecheck
bun run --filter @workspace/extension --filter @workspace/resume-core --filter @workspace/api test
bun run --cwd packages/agent test test/autofill.test.ts test/page-interpreter.test.ts test/autofill-drafter.test.ts
bun run --cwd apps/web test src/features/autofill-profile/AutofillProfileScreen.test.tsx src/features/autofill-profile/SavedAnswers.test.tsx src/server/adapters/autofill.test.ts src/server/api/api.test.ts
bun run db:test
```

The adapter check used the explicit local Supabase URL and local test credentials
in process memory. No credentials were printed or written into repository files.
