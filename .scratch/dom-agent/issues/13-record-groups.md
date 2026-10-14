# 13: Record groups

**What to build:** Blank experience and education groups can be added and filled from the selected resume without inventing history or duplicating records.

**Blocked by:** 07, 08

**Status:** ready-for-agent

- [ ] A group is bound to exactly one source record by available evidence, and an ambiguous assignment is refused rather than guessed from position.
- [ ] Existing records are preserved, and a newly added blank group is observed and bound before another add action.
- [ ] Records are never deleted or merged, and two jobs are never combined into one record.
- [ ] A page asking for broader history than the selected resume holds produces a request for the missing facts.
- [ ] Experience and education supplements stay in the application and never become edits to the resume.
- [ ] Covered by tests including the repeated-record and ambiguous-match cases.

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
