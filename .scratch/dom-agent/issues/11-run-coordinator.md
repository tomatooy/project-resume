# 11: Run coordinator

**What to build:** The engine that schedules independent work, survives interruption, and knows the difference between working and waiting for a person.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Independent work is batched, and dependencies are observed rather than assumed, so a dynamic choice replans only the questions it affects.
- [ ] Checkpoints are written at batch and pause boundaries, and record-creation and upload intents are persisted before dispatch so a lost response cannot duplicate them.
- [x] Recovery after a lost response inspects the page before retrying, and uncertain outcomes stay explicit.
- [x] Pause, continue and cancel behave as specified; continue observes and validates existing receipts instead of replaying a suspended plan; cancel preserves values already written.
- [x] User edits to the target page pause subsequent actions, while a sidebar answer is an input to the review flow.
- [x] Worker restart, navigation and debugger detach all recover through fresh observation, and no old action is replayed.
- [x] The configured ceilings are enforced and exhaustion reports remaining issues and offers continue rather than claiming readiness.

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

## Verdicts from the audit (2026-10-14)

Read-only audit against the committed code, one verdict per box, each with the file, the
line and the test that fails when that line is deleted.

Met: box 4 (continue validates receipts rather than replaying a suspended plan, and cancel
keeps what was written), box 5, box 6, box 7. The audit also closed the open question this
file carried: \`documentGeneration\` and \`userEditEpoch\` are both compared now
(\`runtime/dispatch.ts\`), not merely carried, and the engine guard is confirmed closed with
nothing in \`src\` opening it.

Met in part, and the boxes stay open:

- **Box 1.** Batching is proven, but \`affects\` is hard-coded empty and
  \`checkpoint.awaitingObservation\` is never populated, so after an effect the whole page is
  re-observed and every question replanned rather than only the affected ones. The one
  coordinator test for the claim is vacuous: its combobox question has no matching fact, so
  the numbers it asserts are trivially equal. See \`fix-05\` item 5.
- **Box 2.** The upload half is proven: the intent is on disk before the dispatch leaves.
  The record-creation half is **unreachable**: no candidate ever carries \`add_record_group\`,
  \`intentFor\`'s branch for it cannot fire, and \`recordGroupPlan\` still has no production
  caller, which is the wiring ticket 13's own audit assigned here. See \`fix-05\` item 2.
- **Box 3.** Recovery does inspect and does report doubt, but the verdict does not gate the
  retry: a lost upload response is settled \`uncertain\` and then re-dispatched in the same
  pass, because no attempt was recorded when the response was lost. See \`fix-05\` item 1,
  which is the reason that work order exists.

## After the coordinator lane landed (2026-10-14)

**Box 3 is ticked.** The verdict now gates the retry rather than merely being reported: an
upload the run already wrote down is not looked at again, the question goes to the
not-dispatchable set, and it reaches the user through the review queue in the same pass.
Removing the gate makes the harness record two dispatches for one attachment.

**Box 1 stays open**, and the honest shape of what remains is now much smaller. Batching is
proven and so is the dependency half: a failure is corrected before the batch continues.
What is not implemented is "replans only the questions it affects", and it cannot be
implemented in the coordinator, because nothing observes which questions a control's effect
touches. The attempt key survives that gap, so a question answered earlier in the same run
is found again without a model call, but the whole page is re-observed. Filed as
`11a-scoped-replan.md`, which is the reader work that closes this box. Until then the code
says so at the site instead of leaving the vacuous test as its evidence.

**Box 2 stays open on its record-creation half only.** The upload half is proven and
unchanged: the intent is on disk before the dispatch leaves. A record-creation intent cannot
precede a dispatch that never happens, because nothing in the observation names the control
that adds a group. Filed as `11b-record-group-add.md` with the lane's blocker and its
warning about proposing an add for a group the page already shows.
