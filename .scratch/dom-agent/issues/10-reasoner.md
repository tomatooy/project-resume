# 10: Reasoner

**What to build:** Model reasoning over the questions the driver enumerated, reached through a port so nothing above it depends on the AI SDK.

**Blocked by:** 02, 06, 08

**Status:** ready-for-agent

- [ ] The loop lives in the agent package behind a port declared in the core package, and does not reuse the chat assistant run loop or its patch authority.
- [ ] Tools are limited to bounded reads and option discovery, and the executor enforces the read and round ceilings rather than trusting the model.
- [ ] Proposals bind cited facts to a question, and the transformation is kept separate from the source reference.
- [ ] A proposal may copy an eligible value, apply an explicit lossless format conversion, or select an observed option of equivalent meaning; anything else stays unresolved.
- [ ] Unknown facts become requests for information, never invented values, and no new prose is generated.
- [ ] Model failure leaves deterministic fields filled and unexplained fields visible.
- [ ] Tested with stubbed model responses, plus the existing live eval lane for the grounded-answer acceptance cases.

## Lane ownership (this pass)

**Owns:** `packages/agent/src/**` and its tests; a new port module in
`packages/resume-core/src/dom-agent/`; and **both barrels**,
`packages/resume-core/src/dom-agent/index.ts` and `packages/resume-core/src/index.ts`, so
that exactly one writer ever edits them. New core tests go in
`packages/resume-core/test/dom-agent-reasoner.test.ts`.

**Must not touch:** anything under `apps/extension/`, or
`packages/resume-core/test/dom-agent.test.ts`.
