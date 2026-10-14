# 11b: Make an add dispatchable

**What to build:** the reader affordance and the coordinator path that let a run press an
"add another" control once, write the intent before it dispatches, and recognise the group it
created on the next observation.

**Blocked by:** nothing beyond this ticket. The record rules exist, the plan is driven, and
`RunReport.recordGroups` already reports bindings, refusals, supplements, missing groups and
the proposed add.

**Owed to:** ticket 13 boxes 1, 2 and 4, and ticket 11 box 2's record-creation half.

**Status:** ready-for-agent

- [x] The observation carries the control that adds a group for a record container, and the reader obtains it from the page rather than guessing: today it keeps `aria-controls` privately and only for comboboxes, a bare `<button>` is not a question at all, and `KIND_BY_CONTROL` therefore never yields a record-group kind.
- [x] A group's identity survives one observation, so a group the run added can be bound before another add is asked for. Group refs are assigned per observation today, which is why `recordGroupPlan`'s `added` cannot span two reads.
- [x] The coordinator dispatches at most one add per observation, with its intent written before dispatch, and the added group is observed and bound before the next add.
- [x] `missing` and a refusal reach the user as a request rather than as silence.

## The hazard the lane flagged, which this ticket must handle

`nextAdd` fires whenever nothing is unresolved, so on a page showing a *single* entry, which
is unmarked because marking needs two, the proposal is an add for a record the page already
shows. The caller must require that the observation actually holds a group before it presses
anything. Pressing the wrong control adds a blank record to a real application, so this is
the first thing to get right.

## Landed (2026-10-14)

All four boxes are met. Two of them named a method that was not the one used, so the mechanism
is stated rather than implied, and two limits are stated rather than hidden.

The reader pairs a control with the container it grows, read two ways: `aria-controls` naming
the container, or the control sitting inside it. Wording is the gate, on a button's accessible
name, so a bare button the page does not word as adding stays dropped and a control that merely
sits near a list is never taken for that list's control. The pairing is
`PageRead.groupAddControls`, and `candidateQuestions` turns each pair into a `record_group`
question held in a separate `addGroupControls` list, deliberately outside `questions`, because a
bare button holds no value and must never be asked of the person.

Box 2's outcome is met through the run's own record rather than by making refs stable. An intent
still open on the next read is the run's account of what it grew, and the group that appeared is
the one past the `groupCount` recorded with it. Three guards keep that from being a guess: only a
blank group can be it, the container must already hold a record of that kind, and the record must
not already be placed by identity. Mutation-checked, and the mutation matters: with the run's own
account dropped, the run mis-binds `rec_3` to `r4`, which is the wrong record in the wrong group.

The add is the only candidate in its batch and its batch ends there, so the writes are planned
from a fresh observation of the page the add produced. That is `planBatches` closing on any
action that carries an effect, plus the candidate being built before the others.

Two limits, deliberate and worth knowing:

- **A page showing a single entry gets no add at all.** A container is only repetition, so one
  entry marks no container, nothing is paired, and nothing can be pressed. This is the hazard
  rule in this ticket's own warning, and it is a real functional limit: a resume holding three
  jobs cannot add to a page showing one.
- **The control is found by the page's English wording.** A page that words it otherwise is not
  pressed. Extending that half means adding the observed wording rather than widening the
  structural half, because structure alone is exactly what the hazard rule forbids trusting.

**No dedicated `ControlKind` was added, and that is the decision.** `primitives.ts` holds the
native vocabulary: what the page itself declares a control to be. A button that adds a row
declares no native kind, and the pairing is the reader's inference from wording plus structure,
so putting it in that enum would dress an inference as a declaration. The question kind
`record_group` was already declared with no producer, and that is where the pairing belongs.
