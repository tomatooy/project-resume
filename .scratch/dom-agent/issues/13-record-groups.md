# 13: Record groups

**What to build:** Blank experience and education groups can be added and filled from the selected resume without inventing history or duplicating records.

**Blocked by:** 07, 08

**Status:** ready-for-agent

- [ ] A group is bound to exactly one source record by available evidence, and an ambiguous assignment is refused rather than guessed from position.
- [ ] Existing records are preserved, and a newly added blank group is observed and bound before another add action.
- [x] Records are never deleted or merged, and two jobs are never combined into one record.
- [ ] A page asking for broader history than the selected resume holds produces a request for the missing facts.
- [x] Experience and education supplements stay in the application and never become edits to the resume.
- [x] Covered by tests including the repeated-record and ambiguous-match cases.

## Lane ownership (this pass)

Tickets 12 and 13 are one lane and share these files.

**Owns:** `apps/extension/src/autofill/**` (the PDF and offscreen path),
`apps/extension/src/dom-agent/**` except the barrels, `packages/resume-render/**` if the
render pipeline needs it, a new record-rule module in
`packages/resume-core/src/dom-agent/`, and new tests:
`packages/resume-core/test/dom-agent-records.test.ts` plus the extension's own.

**Must not touch:** `packages/resume-core/src/dom-agent/index.ts` or
`packages/resume-core/src/index.ts` (lane 10 owns both barrels: report the export line you
need and the parent adds it at merge), `packages/agent/**`, or
`packages/resume-core/test/dom-agent.test.ts`.

## Verdicts from the audit (2026-10-14)

Boxes 3, 5 and 6 are met with named tests. Boxes 1, 2 and 4 are met in part, and the
missing parts are the coordinator, not the rule module: nothing calls `recordGroupPlan`,
so re-observing an added group before another add, and turning `missing` and refusals
into a user-visible request, are ticket 11's work.

Box 1 also has a real defect, filed as `fix-04` item 1 and worth reading before wiring
anything: `SourceRecord.kind` is written and never read, and a page group declares no
kind, so a blank education group binds to a leftover experience record. Flipping the kind
in the existing test leaves every assertion passing.

## Board state 2026-10-14, appended while the coordinator lane runs

Boxes 3, 5 and 6 are provable now and the audit named their tests; they are left unticked
because the lane landing the coordinator may tick them, or report which it can, and two
writers on these lines would only produce a patch conflict for no gain.

Boxes 1, 2 and 4 wait on the coordinator, which is in flight: the record rules exist and
nothing drives them, so re-observing an added group before another add, and turning a
`missing` verdict or a refusal into a request the user sees, are being wired right now.
Box 1's real defect is already gone, because `fix-04` item 1 made the record kind load
bearing: `SourceRecord.kind` is required rather than merely written, and `kindMatches`
holds a group that declares a kind to it, so a blank education group is no longer answered
by a leftover job. Two details to read before wiring anything, because both are deliberate:
the group's own kind is nullable, and null means "the page said nothing", never "either
kind", which is why a null-kind group keeps the old any-record answer; and the record's
kind decides only the binding, so the audit's flip stays silent in the one test whose group
declares nothing, by design rather than by accident.

## After the coordinator lane landed (2026-10-14)

Boxes 3, 5 and 6 are ticked. Boxes 1, 2 and 4 wait on `11b-record-group-add.md`, which is a
reader ticket rather than a coordinator one: the plan is driven and reported now, but nothing
in the observation names the control that adds a group, so an add cannot be dispatched and a
newly added group cannot be recognised on the next read. This ticket's remaining half is
therefore not "finish the coordinator", and the code no longer reads as if it were handled,
which was the state the audit objected to.
