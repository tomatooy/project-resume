# 14: Page audit and readiness

**What to build:** A fresh, whole-page verdict that the user can trust, computed from coverage and verification rather than from the number of writes completed.

**Blocked by:** 11, 12, 13

**Status:** ready-for-agent

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
