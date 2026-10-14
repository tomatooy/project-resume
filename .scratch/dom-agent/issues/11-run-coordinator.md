# 11: Run coordinator

**What to build:** The engine that schedules independent work, survives interruption, and knows the difference between working and waiting for a person.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Independent work is batched, and dependencies are observed rather than assumed, so a dynamic choice replans only the questions it affects.
- [ ] Checkpoints are written at batch and pause boundaries, and record-creation and upload intents are persisted before dispatch so a lost response cannot duplicate them.
- [ ] Recovery after a lost response inspects the page before retrying, and uncertain outcomes stay explicit.
- [ ] Pause, continue and cancel behave as specified; continue observes and validates existing receipts instead of replaying a suspended plan; cancel preserves values already written.
- [ ] User edits to the target page pause subsequent actions, while a sidebar answer is an input to the review flow.
- [ ] Worker restart, navigation and debugger detach all recover through fresh observation, and no old action is replayed.
- [ ] The configured ceilings are enforced and exhaustion reports remaining issues and offers continue rather than claiming readiness.

## Retired behaviour worth mining

`test/autofill-session.test.ts` (1284 lines, 28 cases) was deleted by ticket 01
because it drove `af.start` through the retired engine. It covered session
lifecycle, cancellation generations, panel registration, worker restarts and
auto upload. Recover it with:

    git show 5693abd:apps/extension/test/autofill-session.test.ts

Those behaviours still have to hold; this ticket owes them new tests.
