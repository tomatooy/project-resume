# 16: Profile and saved answers in the web app

**What to build:** The account-level surfaces for the new question identity, so a company-specific answer can be kept and reused without anyone adding an enum member.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] A saved answer can be created, reloaded, edited and deleted with no concept enumeration involved anywhere in the path.
- [ ] Saving for reuse requires an explicit scope, and an unknown scope prevents saving for reuse and says why.
- [ ] Legacy rows remain readable, and an unsafe match stays visible for the user to resolve.
- [ ] Profile preserves unknown versus explicit yes or no, and unanswered versus answered versus decline.
- [ ] Salary is stored as amount, currency and period separately, and the control receives the numeric representation rather than a display string.
- [ ] Work authorization keeps its country and time scope.

## Lane ownership (this pass)

**Owns:** `apps/web/**`, `packages/resume-core/src/autofill-profile/**`,
`packages/resume-core/src/dom-agent/saved-answer.ts`, and the tests for those.

**Must not touch:** `apps/extension/**`, the other modules under
`packages/resume-core/src/dom-agent/`, or that directory's `index.ts` (the coordinator
lane owns the barrel; report any export line you need instead of adding it).

**Preserve the EEO exclusion.** `factFromStoredAnswer` refuses an EEO response with the
`excluded_concept` reason, and the source bundle excludes EEO facts outright. That is a
deliberate product decision, not an oversight: no EEO answer is ever defaulted, and a
stored EEO answer never enters the bundle. If your work touches that path, keep both
rules and their tests.

## Landed, boxes unverified (2026-10-14)

Landed as `0079515`. The new identity-first module is
`packages/resume-core/src/saved-answers/` (schema, legacy mapping, service) with one export
line in the package root barrel, plus additive procedures in `packages/api`, the server
functions and web surfaces, and 611 lines of new tests. Legacy concept rows are untouched
and mapped into the new view on read, per ADR 0001.

The bug found on the way is fixed: the stored answer schema required a sixteen-character
question key while legacy rows hold free-text keys of any length, so a legacy row threw a
ZodError instead of producing the `no_question_key` review outcome that case exists for.

**Boxes are NOT ticked**, for the same reason as ticket 11: the lane died before reporting.
A verification pass is owed, and two claims in particular need evidence rather than the
code merely existing: that nothing anywhere in the path enumerates a concept, and that an
unknown scope refuses to save for reuse and says why.
