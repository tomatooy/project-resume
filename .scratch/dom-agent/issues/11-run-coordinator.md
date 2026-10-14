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


## Inherited from the review fixes (read before starting)

- **The replay guard now keeps two facts**: `revisions` refuses a stale revision
  across every verb, and `writes` refuses a replay on mutating verbs only. A read may
  repeat at one revision, because verifying a write means reading the question again; a
  write may not. **Consequence for you: two mutating actions on one question at one
  revision are refused.** Bump the revision when you need two writes to one question.
- **`ActionSchema` was deliberately not tightened** to require `expectedChecked` for a
  toggle. The page runtime refuses a null expectation, so it fails closed today. The
  schema requirement belongs in this ticket, where a caller finally exists.
- **`documentGeneration` and `userEditEpoch` reach the page as data and are compared
  nowhere.** The user-edit pause rule has no implementing check; this ticket lands it.
- **Multi-selection is refused in v1** (`<select multiple>` and multi-choice groups seed
  `unsupported` with a coverage gap), so do not plan one.
- **The bundle does not survive a service-worker restart.** Pinning is derivation plus
  identity; keeping a bundle across a restart is run state, which is your job, not the
  source service's.
- **`batchIsAuthorized` has no caller** because there is no batch-level entry point yet:
  `dispatch.ts` handles one call at a time. The per-action gate means every attachment
  in a batch is still checked, so the batch guarantee holds through the per-action path.
- The 16 cases that drove `af.start` through the retired engine were deleted in ticket
  01 and are recoverable with `git show 5693abd:apps/extension/test/autofill-session.test.ts`.
  Cancellation generations, worker restarts and auto-upload are still owed tests.

