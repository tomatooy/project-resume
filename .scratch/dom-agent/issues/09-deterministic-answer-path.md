# 09: Deterministic answer path

**What to build:** The tracer bullet: Fill current page resolves the questions it can, writes them safely, verifies what happened, and shows honest progress, with zero model rounds.

**Blocked by:** 02, 06, 07, 08

**Status:** ready-for-agent

- [x] An exact-match binding of facts to questions fills the simple controls and produces a receipt for each.
- [x] Everything unmatched enters the review queue with its original wording rather than being guessed or left silent.
- [x] Progress shown to the user counts verified receipts, never dispatched actions.
- [x] Question interpretation is reused until its semantic evidence changes.
- [x] The frozen multi-field form completes with no whole-page re-reasoning per control.
- [x] Covered by tests over fixtures with the model absent entirely.

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

## Landed

Two modules, split at the boundary the spec draws: `deterministic-path.ts` in resume-core
holds the browser-independent rules, and `run-page.ts` in the extension holds the run.

**The gate is shared, not duplicated.** A deterministic proposal is built as a
`ReasonerAnswer` and run through `reconcileReasoning`, the same gate the model's output
goes through. There is no second, weaker path to a page, so a value the gate would refuse
for the model is refused for an exact wording match too. Two things stay outside the
deterministic tier on purpose: a control kind the reader inferred from a role rather than
read natively, and a value that cannot be copied or losslessly converted (money, whose
amount, currency and period do not fit one control).

**What each box rests on.** Box 1: `exactFactMatch` then `actionFor`, proven by the
end-to-end suite writing a form and reading the receipts. Box 2: `reviewQueue` carries the
question's own wording, its options and its requiredness; an unmatched optional question
is visible and non-blocking rather than dropped. Box 3: progress comes from
`verifiedProgress(receipts)`, and a refused write (empty readonly field) keeps `accepted`
at zero while `dispatched` is one. Box 4: interpretations are cached under the question's
semantic key, never its ref, so a re-observation that renumbers its nodes reuses them and
a re-worded question does not. Box 5: a 20-field form in one interpretation pass, and the
second pass reports 20 reused and zero read.

Box 5 needs one qualifier: the *frozen* form is the performance harness in ticket 17, which
does not exist yet, so this proves the property on a 20-field form of its own. Box 6: the
model is absent from this path entirely (no AI SDK import anywhere in either package's
dom-agent tree), and the reading half is proven over recordings by the observation,
question and fixture suites. The writing half runs against a live tree, because a
recording is data and holds no elements to resolve; that is stated in the suite.

**The guard stays closed.** `engineCanStart()` still refuses the fill action, so none of
this is reachable in the product yet. Flipping it is its own deliberate step, with the
coordinator and the panel, and belongs with ticket 18 or the manual acceptance in 19.

**Left to the coordinator (ticket 11).** `questionRevision` is an input here and defaults
to 1, because the page refuses a write at or below the revision it already wrote. A second
pass over the same document must advance it, and the end-to-end suite proves both halves:
same revision is refused as a replay, a bumped revision writes. `userEditEpoch` is carried
as zero for the same reason: the page does not compare it yet.

**Mutation-proved.** Counting dispatched actions as progress fails two tests; keying the
cache by question ref instead of semantic evidence fails three; dropping an unmatched
question from the queue fails one. Each probe was restored byte-identical.
