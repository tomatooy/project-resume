# fix-05: What the second audit found

**What to build:** the defects an independent read-only audit of tickets 11 and 16 turned
up. Items 1 and 2 are the ones that can duplicate an upload or leave record groups
unwired, so they land before ticket 14 audits the run end to end and before ticket 15 puts
a panel in front of it.

**Status:** items 1, 3, 4, 6, 7 and 9 are landed with tests that bite; item 2 is landed (its dispatch half came with `11b-record-group-add.md`); item 5 is a restatement by decision; item 6's residue is closed (2026-10-14); item 7's dead-constant residue is closed (2026-10-14); item 9's second box is closed (2026-10-14); item 10 is landed (the 4000-into-500 display cap, `f338724`); item 8 is unstarted and belongs to ticket 15. What remains is listed below rather than left in a box count.

## 1. HIGH: a lost upload response is settled uncertain and then sent again

\`settleIntents\` marks the intent uncertain (\`run-coordinator.ts\`, the settle pass), and
then the same pass rebuilds the attachment candidate and dispatches it again, because no
attempt was recorded when the response was lost. The only remaining barrier is the page's
own hold check, and the verdict is uncertain precisely because that state could not be
read. This is the sentence the box exists for: after recovery, inspect the page before
retrying, avoiding duplicate attachments.

- [x] An uncertain upload intent for a question stops that question's attachment from being re-dispatched until the user resolves it, and the question shows up in the review queue rather than being retried silently.
- [x] A test drives a lost response, then a continue, and asserts exactly one dispatch happened.

## 2. HIGH: record-creation intents cannot occur and record groups are unwired

Landed 2026-10-14 with \`11b-record-group-add.md\`. \`intentFor\`'s \`add_record_group\`
branch fires, \`recordGroupPlan\` has a production caller, and the group counts the coordinator
computes drive a real dispatch instead of a dead branch. Ticket 11 box 2's record-creation half
and ticket 13's owed coordinator wiring were both this, and both are closed.

- [x] Record groups are planned from the observation, kind-declared, one add per observation, and their intents are written before dispatch like an upload's.
- [x] A test adds a blank group for an unmatched record and asserts the intent was on disk before the dispatch left.
- [ ] If this is deliberately deferred instead, box 2 and ticket 13 both say so, because today the code reads as if it were handled.

## 3. MEDIUM: the attempt key is composed on write and compared bare

\`recordAttempt\` stores a composed key while both \`attemptPolicy\` call sites compare the
bare one, so \`no_new_evidence\` can never fire from the coordinator and a failed control is
retried even when nothing changed, up to the corrective ceiling. For uploads that means up
to two extra uploads.

- [x] Store the bare observation key, as the continue path already does, so a genuinely unchanged page stops the retry, and keep the receipt code in the correction so a different failure is still a different attempt.
- [x] A test: a failed write with no new evidence is not attempted again.

## 4. MEDIUM: cold and warm runs disagree about the same confirmation

Found by the metrics lane while reading a real run. \`observe()\` computes dispositions from
the receipts known before that round dispatches, and \`report()\` returns the last stage's
dispositions, so a cold run reports every accepted question as \`unverified\` while the warm
run reports \`answered\` for the same questions. The summary says nineteen confirmed while
each question says unverified.

- [x] The per-question disposition agrees with the receipt that came from the page.
- [x] A test asserts a cold run and a warm run agree on a question the page confirmed.

## 5. MEDIUM: box 1's replan claim is not implemented

\`affects\` is hard-coded empty, \`checkpoint.awaitingObservation\` is written only as empty,
and the interpretation cache is never constructed outside tests, so a dynamic choice
re-observes and replans the whole page. The coordinator test for the claim is vacuous: its
combobox question has no matching fact, so its assertions are trivially true.

- [x] Either populate the affected set from reader evidence and add a coordinator case whose portal question is answerable, so the reobserve branch is observable, or restate box 1 and say plainly that a full replan is what happens.

## 6. LOW-MEDIUM: recovery outcomes are flattened and partly wrong

**Landed**, with its residue closed 2026-10-14. A receipt decides first, \`sameApplication\` is
derived from the page, and \`settled\` gained \`retried\`: a page that showed the action had not
landed is recorded as that rather than flattened into doubt. \`addedGroups\` now lists the states
that count instead of excluding one, which is what stops a retried add from counting as a group
the run never grew.

The upload name is a limit rather than a defect, and its reason is two facts. The reader is
attribute-based and a file input's selection is not an attribute, so no read here can see the
site's own attachment state; and \`recoveryFor\`'s upload branch is unreachable from the
coordinator regardless, because \`settleIntents\` passes \`covered: false\` for every upload. An
upload is settled by a receipt when the page answers and otherwise stays doubtful, which is the
designed answer. The unreachable branch is filed in \`open-after-review-fixes.md\` rather than
deleted here, because deleting it is a design decision.

## 7. LOW: the run-state machine is decorative, and the ceiling is checked once per round

\`run.ts\`'s state table has no production caller, and \`continueRun\` can move a cancelled
run to observing, which that table forbids. Separately, the ceiling is checked once per
observation round rather than between the batches of one round, so a round of several full
batches can overshoot, and \`uploadMs\` and \`retainedRuns\` have no consumer.

## 8. LOW: ends that ticket 15 must tie

\`data-vs-autofill\` is read by the reader and the user-edit listener but set by nothing in
the tree, so the panel must mark its own host when it moves into the page or its own inputs
will count as user edits. And navigation recovery is reachable only through
\`session.onInvalidate\`, which still has no production subscriber, so the wiring order
matters when the coordinator is finally reachable.

## Note on the evidence

The auditor could not run commands, so every verdict is from reading the code and the
tests, and the two High findings are its reading rather than a reproduced failure. The
mutations that would prove items 1 to 5 are listed at the end of its report; run them when
the fix lane lands, so each fix arrives with a test that bites.

## 9. MEDIUM: a saved answer is kept but not yet reusable

Landed 2026-10-14, and the note this section opened with was stale. \`factFromSavedAnswer\`
does have a production caller: \`SourceService.prepare\` reads the legacy port into reviews and
the identity-first port into facts through it, so a newly saved identity-first row does reach a
fill. \`dom-agent-source.test.ts\` proves it end to end, keeping an answer for a question no
vocabulary names and finding it in the bundle as a \`saved_answer\` fact with the scope it was
kept for.

- [x] The bundle's answers port reads identity-first rows, mapping legacy concept rows as it already does, so a saved answer can answer the question it was saved for.
- [x] A test saves an answer for a question with no concept, then prepares a bundle and asserts the fact is present with the right scope.

## Lane ownership (this pass)

Two lanes, split by file so neither touches the other's tree.

**Lane A, items 1 to 7.** Owns `apps/extension/src/dom-agent/run-coordinator.ts`,
`packages/resume-core/src/dom-agent/{scheduling,checkpoint,run,action,record-group}.ts`,
that directory's `index.ts` (this lane holds the barrel), and the coordination tests
(`dom-agent-run-coordinator.test.ts`, `dom-agent-scheduling.test.ts`,
`dom-agent-checkpoint.test.ts`, `dom-agent-records.test.ts`).

**Must not touch:** `packages/resume-core/src/dom-agent/source-service.ts`, the
`saved-answers/` module, `apps/web/**`, or `packages/api/**`. Another lane is wiring saved
answers into the bundle through those files right now.

**Do not open the engine guard**, and do not weaken the EEO exclusion on the way past.

**Lane B, item 9.** Owns `packages/resume-core/src/dom-agent/source-service.ts` and its
test, `packages/resume-core/src/saved-answers/**` and its test,
`apps/web/src/server/adapters/autofill.ts` and its test, and the container wiring in
`apps/web/src/server/container.ts`.

**Must not touch:** the coordinator, `scheduling.ts`, `checkpoint.ts`, `run.ts`,
`record-group.ts`, or the dom-agent barrel.

## What is left in this work order (2026-10-14)

Landed with mutations, in `88a06c1`: item 1 (the gate), item 3 (the bare attempt key with the
refusal in its own column), item 4 (dispositions from the receipts), item 6 (a receipt decides
first, and `sameApplication` derived from the page), item 7 (the enforced state table and the
ceiling between batches), and item 9 (both halves of the table folded into one bundle).

Item 2's dispatch half is `11b-record-group-add.md`, because pressing a control needs reader
work this work order cannot describe. The lane left the unreachable branch commented rather
than deleted, so the next reader finds the reasoning where the code used to be.

Item 5's honest outcome is a restatement: the affected set needs reader evidence, filed as
`11a-scoped-replan.md`, and the coordinator now says so at the site.

Not started, still real: item 6's residue (an upload's
`attachmentName` stays null because no read can see the site's own file list, and `retry` is
still recorded as `uncertain` because the intent's settled field has two values) and item 8
(`data-vs-autofill` is set by nothing, so ticket 15 must mark its own host; navigation
recovery still reaches nothing until the coordinator is reachable).

Closed since this list was written. Item 10, the legacy 4000-into-500 display cap, landed in
`f338724`. Item 7's dead-constant residue is closed too, in the working tree: `uploadMs` now has
the consumer it was written for, because `run-store.ts` renders the attachment with
`AbortSignal.timeout(DOM_AGENT_LIMITS.uploadMs)` instead of a literal `30_000` that had drifted
from it, and `retainedRuns` is deleted, because nothing prunes runs per tab and no reader ever
wanted one. Item 7's other two clauses, the enforced state table and the ceiling between
batches, were already landed above.
