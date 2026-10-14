# 14: Page audit and readiness

**What to build:** A fresh, whole-page verdict that the user can trust, computed from coverage and verification rather than from the number of writes completed.

**Blocked by:** 11, 12, 13

**Status:** landed in the working tree, uncommitted. Two boxes are short of complete and say so below rather than reading as met: box 2 is 4 of 6 and box 5 is 6 of 7.

- [ ] The audit inventories every current question, including untouched values and questions revealed during execution.
- [ ] It checks required fields, committed selections, attachments, validation errors, evidence coverage and cross-field consistency without submitting the form to provoke validation.
- [ ] A preserved pre-existing value satisfies a field when its committed state is observable and no conflict exists, and does not become a reusable fact.
- [ ] Optional blanks do not block readiness; a failed write, unknown requiredness, unresolved conflict or unobserved region does.
- [ ] The report distinguishes verified fills, preserved values, missing information, conflicts, failed controls, unverified results and unobserved regions.
- [ ] Only a complete audit can label the page ready, and readiness never claims the site will accept a later submission.

## Lane ownership (this pass)

One lane, worktree-isolated.

**Owns:** `packages/resume-core/src/dom-agent/audit.ts` and a new
`packages/resume-core/test/dom-agent-audit.test.ts`,
`packages/resume-core/src/dom-agent/index.ts` (this lane holds the barrel),
`apps/extension/src/dom-agent/run-coordinator.ts` and its test, and
`apps/extension/src/dom-agent/observation.ts` or the page-step modules only if a read the
audit needs genuinely does not exist.

**Read `audit.ts` first.** `PageAuditSchema`, `AuditIssueSchema`, `readiness()` and
`issueRefs()` already exist and have no production caller, so most of this ticket is driving
them and finding out which inputs are missing, not writing a module from nothing. Prefer
reading what the run already reports (`progress`, `receipts`, `coverage`, `checkpoint`,
`dispositions`, `reviewQueue`) over adding new reads, and report anything that must be added
rather than widening the reader silently.

**Must not touch:** `packages/resume-core/src/dom-agent/saved-answer.ts`,
`packages/resume-core/test/saved-answers.test.ts`, `packages/agent/**`. A second lane is
working there.

**The honesty rules are the ticket.** Readiness never claims the site will accept a later
submission, an unobserved region blocks readiness, and validation is never provoked by
submitting the form. A verdict that reads better than it is worth is worse than a report that
names what it could not see.

## What the panel will want, since ticket 15 reads this

Ticket 15 puts these numbers in front of a person, so the report has to distinguish the six
outcomes the last box names rather than collapsing them into a count: verified fills,
preserved values, missing information, conflicts, failed controls, unverified results and
unobserved regions. If a distinction cannot be computed from what the run has, say so.

## What landed (2026-10-14)

`buildPageAudit` drives `PageAuditSchema`, `readiness()` and `issueRefs()`. It takes no session
and no page, so it cannot write, click or submit, and validation is never provoked. The audit
reads only what the run already reports (`observation`, `questions`, `dispositions`,
`receipts`, `coverage`). `RunReport` now carries `audit` and `verdict`, and a finished pass
ends `ready` or `incomplete` where it used to end `auditing`.

- `packages/resume-core/src/dom-agent/audit.ts` (+292)
- `packages/resume-core/test/dom-agent-audit.test.ts` (new, 546 lines, 17 tests)
- `apps/extension/src/dom-agent/run-coordinator.ts` (+88)
- `apps/extension/test/dom-agent-run-coordinator.test.ts` (6 new tests)

Verified in the primary checkout: typecheck 9/9, resume-core 394 pass, extension 422 pass.
Fourteen mutations were reported as biting (8 against `audit.ts`, 6 against the coordinator),
including 8 for the review-queue rebuild below.

### The defect the audit exposed, fixed here

The review queue was built **before** the batch ran, so a write the page refused never reached
the user in that pass: the run reported `incomplete` while holding a failed control. The queue
is now rebuilt at the pass tail, which is also what makes `needs_input` reachable for a
refusal.

### Boxes that are not complete

- **Box 2 (4 of 6).** Required, committed selections, attachments and coverage are checked.
  Validation errors and cross-field consistency are not derivable: the observation carries
  each control's own state and the page's error wording, but no stated link between an error
  and the control it belongs to, and no rule relating two controls. Both are named in
  `unchecked` with that reason instead of being approximated.
- **Box 5 (6 of 7).** `conflict` has no producer anywhere, so the bucket is always empty and is
  named as unchecked rather than silently reported as zero. `validation_error` and
  `cross_field_inconsistent` on `AuditIssueSchema` are in the same position.

### Still owed, and who owes it

- **`run-page.ts:178`** (the single-pass path) still stops at `auditing` and never calls the
  audit. Not this ticket's file.
- **`question.ts`**: `questionIsSettled` returns false for `out_of_scope`, which no producer
  emits, so the disposition and the rule disagree in principle.
- **Contract changes this landed**: `RunReport` gained two required fields, and three bounds in
  `audit.ts` were widened (`detail` 400 to 600 so `CoverageGap.detail` is carried verbatim
  rather than truncated, the question arrays 500 to `MAX_REPORTED` to match
  `observationNodes`, and issues to `MAX_ISSUES`).

### The audit has no production caller yet, and that is not this ticket's fault

The audit is driven by `run-coordinator.ts`, and **nothing in `apps/extension/src` constructs
the coordinator or calls `fillCurrentPage`**. The only import of `dom-agent/` from outside that
directory is `engineCanStart`, and `dom-agent/engine.ts` hard-codes `{ ready: false }`, so
`autofill/background.ts:619` refuses every fill before run state exists. The whole replacement
engine is dark by design. Ticket 15 owns the panel rebuild that wires it and ticket 18 owns
deleting the retired engine; until then no part of tickets 01 to 17 is user-visible.
