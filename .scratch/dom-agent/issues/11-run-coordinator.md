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


## Lane ownership (this pass)

**Owns:** `apps/extension/src/**` (including `autofill/**` and `dom-agent/**`), the
run-adjacent modules under `packages/resume-core/src/dom-agent/` except the two named
below, that directory's `index.ts` (this lane holds the barrel), and the extension's
tests.

**Must not touch:** `apps/web/**`, `packages/resume-core/src/autofill-profile/**`, or
`packages/resume-core/src/dom-agent/saved-answer.ts`. Another lane owns those, and it is
editing the module that carries the EEO exclusion.

**Do not open the engine guard.** Wire the entry point so that flipping
`engineCanStart()` later is a one-line change, and leave it refusing: the review queue
and panel arrive with ticket 15, so a half-built path must stay unreachable.

## Landed, boxes unverified (2026-10-14)

The code landed as `0079515` after this lane was killed by a network failure during its
final verification. It is green in the primary: extension 392 tests, resume-core 370, root
typecheck 9/9, biome clean. The patch carries `run-coordinator.ts` (run state, batching,
recovery, pause/continue/cancel, ceilings), `checkpoint.ts` (checkpoint shape and the
intents written before dispatch), `scheduling.ts` (batches and dependency-driven
replanning), `page-steps.ts`, `run-store.ts`, `runtime/user-edits.ts`, and the dispatch and
protocol changes that carry a revision, with about 1,100 lines of tests across three files.

**The boxes above are deliberately NOT ticked.** The lane died before reporting, so nobody
has established box by box which claims are proven. That verification pass is owed before
this ticket is called done, and it is the same treatment tickets 10, 12 and 13 got, where
it found a real defect in two of the three.

One defect is already fixed, and the lane's own last test caught it: every read in
`observePage` swallowed its error into a coverage gap, including a closed debugging
session, so a run whose debugger died mid-flight reported the page as read and empty and
reached `auditing` rather than pausing with a lost connection. All five reads now rethrow a
lost session, which is what makes the recovery path this ticket builds reachable at all.
