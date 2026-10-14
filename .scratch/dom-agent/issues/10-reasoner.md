# 10: Reasoner

**What to build:** Model reasoning over the questions the driver enumerated, reached through a port so nothing above it depends on the AI SDK.

**Blocked by:** 02, 06, 08

**Status:** ready-for-agent

- [x] The loop lives in the agent package behind a port declared in the core package, and does not reuse the chat assistant run loop or its patch authority.
- [x] Tools are limited to bounded reads and option discovery, and the executor enforces the read and round ceilings rather than trusting the model.
- [x] Proposals bind cited facts to a question, and the transformation is kept separate from the source reference.
- [x] A proposal may copy an eligible value, apply an explicit lossless format conversion, or select an observed option of equivalent meaning; anything else stays unresolved.
- [x] Unknown facts become requests for information, never invented values, and no new prose is generated.
- [ ] Model failure leaves deterministic fields filled and unexplained fields visible.
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
