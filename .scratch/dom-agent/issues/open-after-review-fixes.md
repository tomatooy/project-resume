# Open after the review fixes

Residual items from the review pass over `8cdf011..711cb87`. Everything called a
finding is closed; these are the pieces that had no owner, or that cannot be
honestly closed yet. Keep this list short and delete entries as they land.

## Needs an owner

- **`ObservedControlSchema` constraints** (`packages/resume-core/src/dom-agent/observation.ts`).
  Constraints (`maxlength`, `pattern`, `min`, `max`, `inputmode`) are read and carried
  on the candidate question, which is what ticket 06's acceptance box asks for. If they
  are also wanted on the observed control, that file needs a lane: no work order has
  owned it since ticket 02.
- **The upload test's real path.** jsdom has no `DataTransfer`, so the test exercises
  the `Object.defineProperty` fallback and the fake `FileList` (no index access, only
  `length` and `item`) is never used. Closing this needs a browser, so it belongs with
  ticket 19's manual acceptance rather than a unit test.
- **Record-group over-marking.** The current test asserts that record references exist
  and differ, which cannot catch over-marking every sibling as a record. That is reader
  behaviour, so it belongs with ticket 06a or a follow-up to ticket 04.

## Deliberately deferred, with the reason

- **`batchIsAuthorized` has no caller.** There is no batch-level entry point;
  `dispatch.ts` handles one call at a time. The per-action gate means every attachment in
  a batch is still checked. Wire it when a batch entry point exists.
- **The toggle schema requirement.** `ActionSchema` does not require `expectedChecked`.
  The page refuses a null expectation, so it fails closed. Tightening the schema belongs
  in ticket 11, where a caller exists.
- **`documentGeneration` and `userEditEpoch` are carried and never compared.** Ticket 11
  lands the user-edit pause check.
- **Two mutating actions on one question at one revision are refused** by the replay
  guard. Intentional, and ticket 11 must know.

## Related, from other tickets

- **`button_choice` is never produced** and Ashby uses button-based choices: ticket 06a,
  blocked on the ticket 05 capture. Ticket 09 must not ship first.
- **Fixtures**: two acceptance boxes in tickets 04 and 06 stay open until ticket 05 lands,
  and ticket 05 is a user-run capture rather than agent work.
- **Pre-existing red, unrelated to this feature**: `packages/agent` (`models.test.ts`
  smart-tier thinking) and `apps/web` (`word-diff.test.tsx` expects `bg-primary/14`, the
  component renders `bg-success/10`). Both fail at `911f251`.

## Found by the reuse lane (2026-10-14)

**A long legacy answer makes `prepare` throw.** `factFromStoredAnswer` copies a stored value
of up to 4000 characters into `FactSchema.display`, which is capped at 500, so one verbose
legacy row fails the whole bundle. That contradicts the tenant that file states, which is
that an uninterpretable or unusable row is a review outcome rather than a failed run. The
fix wants a decision about what the display should say (the legacy reason already exists for
rows it cannot read) and belongs in `packages/resume-core/src/dom-agent/saved-answer.ts` with
its own test. Untouched by every lane so far because it would have widened their item.

**A worktree makes one preview test red.** `apps/web/src/features/resume/preview/pdfjs.test.ts`
fails inside a worktree even when run alone, because the documented bootstrap links
`node_modules` entries to the primary's real paths and Vite's fs allowlist then denies the
worker's resolved path. It passes in the primary checkout. Lanes should not chase it.

**Ownership, this pass.** The 4000-into-500 display cap has landed (see below). The
remaining item from this section is the legacy reader question, which needs a decision rather
than a lane.

## The display cap landed (2026-10-14)

`source-service.ts` now previews a value into `display` at the 500 limit instead of letting
one long source fail the whole bundle. Two sites were reachable, not one: `resumeFacts`
(`basics.summary`, `Text`, max 2000) and `profileFacts` (the four Profile link URLs, which that
schema also allows to run to 2000). Both go through a local `preview()`, the full text still
reaches the model through `value`, and nothing is dropped: the summary stays usable as a source
rather than losing the fact entirely.

This is deliberately **not** the saved-answer rule, and the comment at `preview()` says so.
That rule truncates a stored answer of the person's, which changes what it says; this previews
the person's own resume into a bundle, where the whole value is carried beside the display.
`displayOfSavedValue` (`saved-answers/service.ts:219`) already did the same at its own site, so
the two now agree in behaviour. The duplicated rule is worth knowing about; unifying it is a
refactor, not a bug fix.

Note what this replaced. The work order originally named `factFromStoredAnswer` in
`saved-answer.ts` as the site that throws. It cannot: see the next section.

## Resolved: the legacy stored-answer reader, and why it has no fact to return

Found by the lane that fixed the display cap, decided 2026-10-14, and implemented in the working
tree. The original order named `factFromStoredAnswer` in `saved-answer.ts` as a site that throws.
It cannot, and the reason is worth keeping because two tests and a board entry said otherwise.

**The mechanism.** One table, `public.autofill_scoped_answers`, holds one `data jsonb` payload and
no `question_key` column. Two shapes live in that column, told apart by a `shape` marker:

- The retired concept vocabulary writes `{meaning, conditions, value, provenance}` and no marker.
  `SupabaseScopedAnswerRepository` selects exactly those rows and parses each into a
  `ScopedAnswer`.
- The identity-first feature writes `{shape: "question", question, value}`.
  `SupabaseSavedAnswerRepository` selects only those. It is the reader that works, so ticket 16's
  headline outcome is reachable in production and `fix-05` item 9's box stands.

**Why no legacy row can become a fact.** The identity ADR 0001 matches on is derived from the live
page at read time (`questionKey`, a sixteen-character fingerprint of the question's text, kind,
scope and options), never read from the wire. The legacy payload has nowhere to keep one, and
`ScopedAnswerSchema` is a `strictObject`, so a row edited by hand cannot supply one either. That is
a conclusion about the shapes, not an observation about a run: no row this reader can be handed
carries the identity, so every one of them is a review. The reader checked a field that could not
exist, and its fact branch was unreachable from the day it was written.

**Why it looked alive.** Two unit tests built rows through `StoredAnswerSchema.parse` directly,
stamping a sixteen-character `questionKey` and a `factValue` onto a legacy row. Both passed, and
both asserted a shape the adapter cannot produce. They are gone, replaced by a test that pins the
impossibility: a legacy row carrying a top-level identity is refused by the read shape.

**What changed.** `factFromStoredAnswer` is now `reviewFromStoredAnswer`, returning a
`ReviewAnswer` rather than a fact-or-review union, so the name cannot mislead the next reader.
`StoredAnswerSchema` lost its top-level `questionKey` and `factValue`, which nothing could supply.
The reasons that survived are `no_question_key`, `unsupported_value` and `excluded_concept`;
`empty_value` is deleted with its line of account-surface copy, since no row can produce it. The
empty-value and structured-concept checks went with the branch, because the unnamed-row check
precedes both and every real row stops there. Behaviour for every row that can exist is unchanged.

Verified: typecheck 9/9, resume-core 393 pass, extension 423 pass, the web autofill-profile tests
5 pass, Biome clean on the six changed files. The one removed test is the impossible case, which
is why resume-core went from 394 to 393.

## Found while landing 11b and 13 (2026-10-14)

- **`CandidateQuestion.groupRef` has two meanings and its two producers disagree.** The schema
documents it as "the repeated-group container this question belongs to", and the ordinary
producer fills it from the reader's *region* map while `recordRef` takes the *record container*.
The new add-control question follows the documented meaning and puts the container in `groupRef`,
leaving `recordRef` null. Nothing reads either field for an add question today, so this is inert,
and the field the record-group code actually reads is `recordRef` (`record-group.ts`: `const
groupRef = question.recordRef`). It is recorded because the next reader will see two producers
filling one field differently, and because feeding add questions into `pageRecordGroups` would
silently drop them on that null. Fixing it means choosing which meaning wins, which is a schema
decision rather than a lane's.
- **A page showing one entry cannot be added to.** The reader marks a container by repetition, so
one entry marks nothing, nothing is paired, and no add is proposed. This is 11b's hazard rule
working as designed, since pressing add on a page already showing the record is how a blank
duplicate lands in a real application, but it is a functional limit worth stating: a resume
holding three jobs cannot add to a page showing one. Lifting it needs a positive signal, such as
a page declaring an empty container, rather than a weaker guard.
- **The add control is recognised by English wording** (`/^\s*(?:[+>›]\s*)?add\b/i` against a
button's accessible name). A page that words it otherwise is not pressed, and the honest way to
extend that is to add the wording actually observed rather than to widen the structural half.
- **`openQuestions` in `apps/extension/src/dom-agent/questions.ts` is an unused export.**
Pre-existing, left alone by the lane, and worth deleting when something else touches that file.
- **A lens blocker on an `innerHTML` in `dom-agent-run-coordinator.test.ts` is a false positive.**
Verified: `grep -ic innerhtml` returns 0 in that file and the line it names builds a label with
`document.createElement`. The lane replaced an `innerHTML` it had written during the run before
reporting, so the blocker outlived the code it was about.

## Found while landing 11a and the validation read (2026-10-14)

- **A combobox whose options mount in a portal cannot be answered at all.** `readOptions` reads
the mounted list on demand and never runs `emit`, so every option it returns carries `ref: ""`,
while a proposal requires `optionRefs` of at least one character and a `select_option` action
needs a node ref. `runtimeCall` resolves a ref back to a label against the current options, so the
label mechanism exists and only the ref is missing. This is why 11a's portal-question clause could
not be tested, and it is bigger than 11a: country, state and school pickers are usually built this
way. Recorded rather than fixed, because giving portal options refs changes the read contract.
- **A reused interpretation can carry a stale `optionRef`, and a swapped one writes the wrong
option.** `QuestionInterpretation` holds `optionRef`, which is an observation-scoped node ref
(`deterministic-path.ts`: `optionForFact(question, fact)?.ref ?? null`), while the cache key is
built from the question's wording and option *labels*. A round that reuses a reading after an
effect renumbered the page can therefore hand over a ref that now belongs to a different option:
`deterministic-path.ts` passes it into the proposal and `runtimeCall` resolves it against the
current options. A vanished ref is refused; a swapped one is silently a wrong value in a real
application. **Close this before the guard is flipped.** The cheap shape is to cache the fact and
recompute the ref against the current observation, which kills the class and keeps the semantic
work cached, but that changes `QuestionInterpretationSchema`, a shared contract.
- **`recoveryFor`'s upload branch is unreachable from the coordinator.** `settleIntents` passes
`covered: false` for every upload, so the `attachmentName` comparison and its two `retry` verdicts
never run in production: unit-tested but dead. Deleting it is a design decision, since the
designed answer ("an unobservable outcome stays unverified") is what the coordinator implements.
- **`RunReport.replanned` is the last round's read set**, so a run ending in a no-candidate round
reports an empty set even if earlier rounds read narrowly. Low, and worth knowing before the
panel renders it.
- **Question refs are positional**, so a batch's `affected` refs mean nothing outside the
observation that produced them. The coordinator reads them within one observation today; a
resumed run reading an older checkpoint against a renumbered page would be reading other controls.
- **`MAX_ISSUES` was raised** from `MAX_REPORTED + 64` to `MAX_REPORTED * 2 + 64`, because page
errors add one issue per control and a pathological page could otherwise throw on the parse.
- **`Plan.addControlFor` was dead state** left by the 11b lane: declared and initialised to null in
three places, never set or read. Deleted in this wave.
