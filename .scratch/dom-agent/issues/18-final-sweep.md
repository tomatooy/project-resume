# 18: Final sweep: delete the retired engine

**What to build:** The old engine is gone, so nothing can quietly depend on it and no reader has to work out which of two paths is live.

**Blocked by:** 01 to 17

**Status:** ready-for-agent

- [ ] The old engine modules, the retired content-script protocol, the planner, the concept enumeration, the rules table, the statistical decider, the page interpreter and the drafter are deleted.
- [ ] The tests that encode the retired shapes are deleted with them, and no test asserts on a concept or a field snapshot.
- [ ] No import of a retired module remains anywhere, and the import-privilege test still passes.
- [ ] The extension still loads, the LinkedIn path still works, and the navigation panel behaviour is unchanged.
- [ ] Typecheck, lint and the remaining suites pass.

## The deletion boundary (2026-10-14)

`autofill/` is not all retired engine. Four of its twenty-two files are the PDF and offscreen
path, which the new engine uses and which ticket 12 owns: `pdf-background.ts`, `pdf-contract.ts`,
`render-pdf.tsx` and `offscreen.ts`, covered by `autofill-pdf-background.test.ts`. Their only
production consumer is `dom-agent/run-store.ts`, through `prepareResumePdf`. Deleting those four
takes the attachment path with them, so they either stay or move out of `autofill/` into the new
engine's directory. That choice belongs to whoever wires the run (ticket 15), not to this sweep,
and it should be made before the sweep starts rather than discovered halfway through it.

Everything else in that directory is the retired engine: `application.ts`, `background.ts`,
`batches.ts`, `button-choice.ts`, `confirmed-answers.ts`, `content.ts`, `dom.ts`, `executor.ts`,
`messages.ts`, `page-reader.ts`, `profile-answer.ts`, `registry.ts`, `scanner.ts`, `sites.ts`,
plus the four panel components (`ApplicationAnswers.tsx`, `Panel.tsx`, `ReviewItem.tsx`,
`SupplementalRecordForm.tsx`).
