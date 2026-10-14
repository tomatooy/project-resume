# fix-05: What the second audit found

**What to build:** the defects an independent read-only audit of tickets 11 and 16 turned
up. Items 1 and 2 are the ones that can duplicate an upload or leave record groups
unwired, so they land before ticket 14 audits the run end to end and before ticket 15 puts
a panel in front of it.

**Status:** ready-for-agent

## 1. HIGH: a lost upload response is settled uncertain and then sent again

\`settleIntents\` marks the intent uncertain (\`run-coordinator.ts\`, the settle pass), and
then the same pass rebuilds the attachment candidate and dispatches it again, because no
attempt was recorded when the response was lost. The only remaining barrier is the page's
own hold check, and the verdict is uncertain precisely because that state could not be
read. This is the sentence the box exists for: after recovery, inspect the page before
retrying, avoiding duplicate attachments.

- [ ] An uncertain upload intent for a question stops that question's attachment from being re-dispatched until the user resolves it, and the question shows up in the review queue rather than being retried silently.
- [ ] A test drives a lost response, then a continue, and asserts exactly one dispatch happened.

## 2. HIGH: record-creation intents cannot occur and record groups are unwired

\`intentFor\`'s \`add_record_group\` branch is unreachable: nothing builds such a candidate,
and \`recordGroupPlan\` has no production caller. Ticket 11 box 2's record-creation half and
ticket 13's owed coordinator wiring are both this. The group counts the coordinator
computes are fed only to the dead branch.

- [ ] Record groups are planned from the observation, kind-declared, one add per observation, and their intents are written before dispatch like an upload's.
- [ ] A test adds a blank group for an unmatched record and asserts the intent was on disk before the dispatch left.
- [ ] If this is deliberately deferred instead, box 2 and ticket 13 both say so, because today the code reads as if it were handled.

## 3. MEDIUM: the attempt key is composed on write and compared bare

\`recordAttempt\` stores a composed key while both \`attemptPolicy\` call sites compare the
bare one, so \`no_new_evidence\` can never fire from the coordinator and a failed control is
retried even when nothing changed, up to the corrective ceiling. For uploads that means up
to two extra uploads.

- [ ] Store the bare observation key, as the continue path already does, so a genuinely unchanged page stops the retry, and keep the receipt code in the correction so a different failure is still a different attempt.
- [ ] A test: a failed write with no new evidence is not attempted again.

## 4. MEDIUM: cold and warm runs disagree about the same confirmation

Found by the metrics lane while reading a real run. \`observe()\` computes dispositions from
the receipts known before that round dispatches, and \`report()\` returns the last stage's
dispositions, so a cold run reports every accepted question as \`unverified\` while the warm
run reports \`answered\` for the same questions. The summary says nineteen confirmed while
each question says unverified.

- [ ] The per-question disposition agrees with the receipt that came from the page.
- [ ] A test asserts a cold run and a warm run agree on a question the page confirmed.

## 5. MEDIUM: box 1's replan claim is not implemented

\`affects\` is hard-coded empty, \`checkpoint.awaitingObservation\` is written only as empty,
and the interpretation cache is never constructed outside tests, so a dynamic choice
re-observes and replans the whole page. The coordinator test for the claim is vacuous: its
combobox question has no matching fact, so its assertions are trivially true.

- [ ] Either populate the affected set from reader evidence and add a coordinator case whose portal question is answerable, so the reobserve branch is observable, or restate box 1 and say plainly that a full replan is what happens.

## 6. LOW-MEDIUM: recovery outcomes are flattened and partly wrong

\`retry\` is coerced to \`uncertain\`, \`sameApplication\` is hard-coded true, the upload
intent's attachment name is always null so its recovery can never say confirmed or
did-not-land, and receipts are ignored, so an upload the page in fact accepted is still
reported as doubtful on the next continue.

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

The ticket's headline outcome, that a company-specific answer can be kept and reused
without an enum member, is half landed. \`factFromSavedAnswer\` has no production caller,
and the bundle's answers port is still the legacy repository, which filters question-shaped
rows out, so a newly saved identity-first row never reaches a fill.

- [ ] The bundle's answers port reads identity-first rows, mapping legacy concept rows as it already does, so a saved answer can answer the question it was saved for.
- [ ] A test saves an answer for a question with no concept, then prepares a bundle and asserts the fact is present with the right scope.
