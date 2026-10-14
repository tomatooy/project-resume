# 16: Profile and saved answers in the web app

**What to build:** The account-level surfaces for the new question identity, so a company-specific answer can be kept and reused without anyone adding an enum member.

**Blocked by:** 08

**Status:** done, boxes met by audit. Its headline outcome, that a saved answer is reusable, still needs `fix-05` item 9: the row is kept today and not yet read back into a bundle.

- [x] A saved answer can be created, reloaded, edited and deleted with no concept enumeration involved anywhere in the path.
- [x] Saving for reuse requires an explicit scope, and an unknown scope prevents saving for reuse and says why.
- [x] Legacy rows remain readable, and an unsafe match stays visible for the user to resolve.
- [x] Profile preserves unknown versus explicit yes or no, and unanswered versus answered versus decline.
- [x] Salary is stored as amount, currency and period separately, and the control receives the numeric representation rather than a display string.
- [x] Work authorization keeps its country and time scope.

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

## Verdicts from the audit (2026-10-14)

All six boxes are met, each with the file, line and test that fails when the implementing
line is deleted. Worth recording from that audit: nothing in the new path enumerates a
concept (a concept field and a caller-supplied key are both refused by the schema), an
empty scope refuses to save with a stated reason, the sixteen-character key bug is fixed
with free-text keys of several lengths covered, unknown is never flattened into no,
unanswered and declined stay distinct, and salary keeps amount, currency and period. The
EEO exclusion holds on both routes, with the new save path refusing demographic wording.

Five follow-ups, none of which reopens a box:

- **G1, medium, cross-ticket.** Saved answers are kept but not yet reusable:
  \`factFromSavedAnswer\` has no production caller and the bundle's answers port is still the
  legacy repository, which filters question-shaped rows out. This needs
  \`source-service.ts\`, which this ticket's lane was not allowed to touch, so it wants its
  own work order before anyone calls saved answers done.
- **G2, closed as part of G1.** The exclusion is structural now: the decision is recorded on
  the row when the answer is saved and the bundle reads that record rather than testing
  wording, with absence treated as no permission rather than as consent. The classifier
  behind the decision also widened from five verbose Profile titles to the subjects pages
  use, plus the answer categories a page offered. Two limits stay stated on the ticket: the
  service always writes the decision as false because the same predicate refuses a
  demographic question at save, and a demographic question worded with none of the Profile's
  subjects still reads as an ordinary question.
- **G3.** The work-authorization fact carries the country but drops \`confirmedAt\`, so a
  time-scoped question cannot be compared against it and \`fix-04\`'s scope gate cannot fire
  for that answer. The Profile itself keeps both, so box 6 stands.
- **G4.** Test gaps on the seams: no router test drives the new procedures, the Supabase
  repository's shape filter and CAS are untested, and the legacy review reason is never
  rendered in a web test.
- **G5.** One unchecked cast in the UI (\`SavedQuestionAnswers.tsx\`) that would render an
  invalid select value for a stored kind outside the seven offered.

One more thing for whoever wires item 9: the new path's EEO refusal is a wording match
against five Profile titles, which the schema comment admits, and it is currently the only
guard on these rows. That is adequate while nothing reads them into a bundle; the moment
item 9 makes them answerable, the bundle must exclude them by the question's kind or scope,
or by a stored flag, rather than by wording alone. The product rule is that no EEO answer is
ever defaulted, and wording is the weakest of the three ways to hold it.
