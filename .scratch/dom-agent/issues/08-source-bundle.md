# 08: Source bundle service

**What to build:** One pinned, authenticated set of applicant sources per application, from which every answer is derived, with the retired concept-shaped storage still readable.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The bundle holds the selected resume or version, Profile, eligible saved answers, and the PDF rendering configuration, and it is fixed once for the application.
- [x] A later edit in the web app does not change the bundle during an active application; a user-requested source change starts a new run.
- [x] Persistence uses existing RLS and the existing revision-based optimistic concurrency, and a client-provided hash is never treated as authorization.
- [x] Legacy saved answers are mapped at read time; a match that cannot be made safely stays visible for review instead of being generalized.
- [x] Saving to Profile requires a real matching Profile field and an explicit user choice; the default is a temporary answer.
- [x] The planner, draft and policy operations and their extension call sites are deleted, and the prepare operation is reshaped in place.
- [x] Sources never reach the page whole: only the value an action needs and its authorized attachment cross.

## Landed

`SourceService` (`packages/resume-core/src/dom-agent/source-service.ts`) loads and
fixes one bundle per application: `prepare` returns `{ bundle, review }`, and
`document` returns the resume plus the render configuration and a `pdfId` built
from the bundle, the template, its options and the render asset version.
`packages/resume-core/src/dom-agent/saved-answer.ts` holds the read-side mapping:
a stored row becomes a fact only once it carries the question identity ADR 0001
defines, and every other row comes back in `review` with a reason. 16 tests in
`packages/resume-core/test/dom-agent-source.test.ts`.

Pinning is derivation plus identity, and the test states it that way: the bundle
a caller holds does not change when the sources move, and naming the stale bundle
is what reports `source_changed`. Keeping the bundle across a service-worker
restart is run state, which belongs to ticket 11's coordinator.

The three operations are gone end to end: `packages/api` contract, the oRPC
router, the service methods, and the extension call sites. `autofill.prepare`
and `autofill.document` were reshaped in place, as the spec requires, because no
build is distributed. The PDF path now identifies bytes by
`pdfIdentity(bundleId, render)`, which is the gap the spec names in the retired
`SourceStamp`.

## Deleted, and how to get it back

Deleted work is recoverable from `git show 911f251:<path>`, the commit this
ticket started from.

- `packages/resume-core/src/autofill/planner.ts` and
  `test/autofill-data.test.ts`: the planner's implementation and its 68 tests.
  They drove the deleted operations, so they could not stay; the new engine's
  tickets re-cover those behaviours.
- `apps/extension/test/autofill-button-choice.test.ts`: its subject was the
  planner's button-choice decisions, reached through a shared `plan()` helper.
- The retired run body in `apps/extension/src/autofill/background.ts` (was lines
  478-1121). `run()` is now an explicit refusal, and `af.draft` refuses with the
  same `engine` panel error rather than reaching a deleted operation. This is
  the intermediate state the spec allows: the extension loads, the LinkedIn path
  is untouched, and filling refuses rather than failing obscurely.

## Left for later tickets

- Ticket 18 sweeps what this ticket orphaned rather than deleted:
  `packages/resume-core/src/autofill/{facts,rules,concept,page-contract,page-projection,interpreter-port,upload}.ts`,
  `testing/autofill.ts`, and the still-required `Ports` fields
  (`autofillDecider`, `autofillQuota`, `autofillPolicy`, `autofillInterpreter`,
  `autofillDrafter`) that no service consumes now. They are kept so
  `packages/agent`'s port implementations and the extension's message protocol
  keep compiling; removing them is one sweep, not a per-file trickle.
- Ticket 12 joins the upload path to the bundle. `ResumePdfSchema.sourceStamp` is
  now optional and kept only because the retired executor refuses a PDF it cannot
  tie to the plan it was rendered for; a render from a pinned bundle carries no
  stamp, so that executor path refuses until 12 replaces it.
- Ticket 15 rebuilds the panel protocol; `messages.ts` still carries
  `SourceStamp`/`PolicySchema` for the retired commands.
