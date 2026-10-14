# 09: Deterministic answer path

**What to build:** The tracer bullet: Fill current page resolves the questions it can, writes them safely, verifies what happened, and shows honest progress, with zero model rounds.

**Blocked by:** 02, 06, 07, 08

**Status:** ready-for-agent

- [ ] An exact-match binding of facts to questions fills the simple controls and produces a receipt for each.
- [ ] Everything unmatched enters the review queue with its original wording rather than being guessed or left silent.
- [ ] Progress shown to the user counts verified receipts, never dispatched actions.
- [ ] Question interpretation is reused until its semantic evidence changes.
- [ ] The frozen multi-field form completes with no whole-page re-reasoning per control.
- [ ] Covered by tests over fixtures with the model absent entirely.

## Lane ownership (this pass)

**Owns:** the new run module under `packages/resume-core/src/dom-agent/` and its export
line in that directory's `index.ts` (this lane holds the barrel, the other lane holds the
files it edits), the extension-side runner under `apps/extension/src/dom-agent/`, the
entry point it needs in `apps/extension/src/autofill/`, and new tests of its own.

**Must not touch:** `record-group.ts`, `proposal-rules.ts`, `runtime/verbs.ts`,
`runtime/control.ts`, and the three test files listed in `fix-04`'s ownership section.
Another lane is editing those right now; report what you need from them instead.

**Do not open the engine guard.** `engineCanStart()` keeps refusing the fill action until
the coordinator and the panel exist, so a half-built path stays unreachable. Flipping it
is its own deliberate step, and it belongs with ticket 18 or the manual acceptance in 19.
