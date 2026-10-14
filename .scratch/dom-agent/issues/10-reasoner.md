# 10: Reasoner

**What to build:** Model reasoning over the questions the driver enumerated, reached through a port so nothing above it depends on the AI SDK.

**Blocked by:** 02, 06, 08

**Status:** all boxes met, each with a test that fails when the implementing line is deleted, except box 7's live half which is written and skipped by design.

- [x] The loop lives in the agent package behind a port declared in the core package, and does not reuse the chat assistant run loop or its patch authority.
- [x] Tools are limited to bounded reads and option discovery, and the executor enforces the read and round ceilings rather than trusting the model.
- [x] Proposals bind cited facts to a question, and the transformation is kept separate from the source reference.
- [x] A proposal may copy an eligible value, apply an explicit lossless format conversion, or select an observed option of equivalent meaning; anything else stays unresolved.
- [x] Unknown facts become requests for information, never invented values, and no new prose is generated.
- [x] Model failure leaves deterministic fields filled and unexplained fields visible.
- [x] Tested with stubbed model responses, plus the existing live eval lane for the grounded-answer acceptance cases.

## Lane ownership (this pass)

**Owns:** `packages/agent/src/**` and its tests; a new port module in
`packages/resume-core/src/dom-agent/`; and **both barrels**,
`packages/resume-core/src/dom-agent/index.ts` and `packages/resume-core/src/index.ts`, so
that exactly one writer ever edits them. New core tests go in
`packages/resume-core/test/dom-agent-reasoner.test.ts`.

**Must not touch:** anything under `apps/extension/`, or
`packages/resume-core/test/dom-agent.test.ts`.

## Verdicts from the audit (2026-10-14)

Boxes 1 to 5 and 7 are met, each with the test that fails when the implementing line is
deleted. Box 6 is met in part: the visible half is proven, and the "deterministic fields
still filled" half is untestable until ticket 09 exists, since the engine refuses to
start by design. Box 7's live half is written and skipped, so treat the measurement as
opt-in rather than passing; the CI-visible tests in that file inspect the case table and
would pass with the reasoner deleted. See `fix-04-verifier-findings.md` item 4 for the one
gate gap found (scope is never compared) and item 6 for the eval note.
Boxes 1 to 5 and 7 are ticked on the audit's verdicts; it named the test that fails for each
when the implementing line is deleted. **Box 6 stays open**: the visible half is proven, and
the half that says deterministic fields are still filled when the model fails was untestable
while the engine refused to start. Ticket 09 has now landed with that exact property, rules
run through the same reconcile gate, so what box 6 still needs is one test that fails the
model and asserts the deterministic answers survived. Until that exists this ticket is not
done, and it is one small test away.

## What box 6 still needs, and who owns it (this pass)

The remaining half is "deterministic fields are still filled" when the model fails. That
property belongs to two places, so it is being proven in two steps rather than by one lane
editing another's file:

- The reasoner's own failure behaviour (a model that errors or returns nothing leaves the run
  alive and its questions explicit rather than inventing values) is proven in the agent
  package's loop tests, which the small-fixes lane owns this pass.
- The coordinator half (the deterministic proposals still reconcile and land, and the
  questions nothing could answer stay visible in the report) is verified against the final
  coordinator code once ticket 14's lane has finished with it, because that lane owns
  `run-coordinator.ts` and two writers on one file is how patches conflict.

The header of `packages/resume-core/test/dom-agent-deterministic-path.test.ts` already
promises the property, "exercised without a browser and without a model", so the second step
should extend that promise rather than start a file of its own.

## Box 6, first half landed (2026-10-14)

The reasoner's own failure behaviour is now proven in `packages/agent/test/reasoner.test.ts`,
with two tests that fail when the behaviour is removed:

- A model that throws (`the model was unreachable`) leaves `outcome: "failed"`,
  `proposals: []` and every question in `unresolved`.
- A model that ends its turn having said nothing (a new `emptyStream()` in
  `packages/agent/test/mock.ts`) gives the same outcome. The question stays explicit rather
  than being filled with an invented value.

What those two tests do **not** prove is the other half of the box's wording, that deterministic
fields are still filled. They assert `proposals: []` on failure, so they show nothing is
invented, not that the deterministic path survives. That is the coordinator half below, and it
is the reason this ticket stays open.

## Box 6, second half landed (2026-10-14)

The coordinator side is proven in `apps/extension/test/dom-agent-run-coordinator.test.ts`, in
"a page only part of which the run can answer". One page carries a question a fact answers and a
required free-text question nothing does, and one run has to show both halves at once:

- The answerable half is filled: exactly one dispatch, for that question, and the audit counts
  it as verified rather than assumed.
- The unanswerable half stays visible: the page keeps its own empty value, the disposition is
  `needs_input`, the review queue holds `no_matching_fact` with `blocking: true`, the audit
  reports `missing_required`, and the run ends `needs_input` with an `incomplete` verdict.

Note what "model failure" means on this side. `PageRunDeps` carries no reasoner and nothing in
the extension calls `createPageReasoner`, so the coordinator cannot be driven with a failing
model today. The test therefore exercises the state a failed model leaves behind, which is a
run where nothing but its own reading answered anything, and it says so at the top. If a
reasoner is ever wired into the coordinator, this test stays valid and gains a sibling.

Both halves were mutation-checked against the final code, each against a different half of the
claim: removing the `missing_required` issue fails the audit assertion, and stopping the
deterministic proposal from being built fails the count. Verified in the primary checkout with
typecheck 9/9, extension 423 pass and resume-core 394 pass.
