# 11a: Replan only what an effect touched

**What to build:** after a dynamic choice changes the page, replan the questions that choice
affects rather than the whole page, so a portal opening does not cost a full re-read.

**Blocked by:** reader evidence of the affected set. Nothing in the observation says which
questions a control's effect touches, so `affects` is hard-coded empty at the coordinator's
checkpoint site, `checkpoint.awaitingObservation` is written only as empty, and the
interpretation cache is never constructed outside tests.

**Owed to:** ticket 11 box 1, whose first two clauses are already proven.

**Status:** landed 2026-10-14

- [x] The observation states, for a control that changed the page, which questions it affected, or states that it cannot tell and says so rather than reporting an empty set.
- [x] The coordinator's checkpoint carries that set and the next round plans exactly those questions, with a test whose portal question is answerable so the narrower path is observable rather than trivially equal.
- [x] If the reader cannot supply the set, this ticket says so and the box is restated, because an `affects` field that nothing populates is what the audit caught the first time.

## Note

The existing test near the checkpoint's affected-set assertions is vacuous: its combobox
question has no matching fact, so the before and after counts it compares are equal whether
or not anything was replanned. Replace it rather than adding beside it.

## Landed (2026-10-14)

All three boxes are met, and box 3's condition did not arise: the reader could state the set, so
nothing needed restating. It is ticked on that basis rather than on a restatement nobody made.

**The reader states it in `PageRead.effectScopes`**, mapping a control's node ref to the refs of
the controls the page says it changes, read from `aria-controls` and `aria-owns` and walked down
the named element so the set is about questions rather than markup. The distinction box 1 asks
for is in the shape itself: **no entry** means the page did not say, an **empty list** means the
page said nothing changes. Those are different facts and they stay different.

**The checkpoint carries it.** `BatchRecord` gained `affected`, and `withBatch` derives the live
`awaitingObservation` from it, so the durable per-batch account and the live pending set cannot
drift apart. The run also carries one `InterpretationCache`, which nothing constructed in
production before, and after an effect the round reads again exactly the questions whose own
evidence changed. `RunReport.replanned` names them. An effect the page did **not** describe forces
the whole page's meaning to be read again, so an undeclared effect never licenses a narrowing.

**The portal clause could not be honoured, and the box is met by substitute.** The ticket asks
for a test whose portal question is answerable. It is not: portal options are read on demand by
`readOptions`, which never runs `emit`, so every one of them carries `ref: ""`, while a proposal
requires `optionRefs` of at least one character and a `select_option` action needs a node ref.
A portal-effect test would therefore assert nothing. The test uses the record-group add instead,
whose effect is dispatchable and whose container the page declares. It asserts the batch's
declared set and that the round after the effect read exactly one question again, the control the
page added inside that container. The underlying gap is filed in `open-after-review-fixes.md`,
because it is bigger than this ticket: a combobox whose options mount in a portal cannot be
answered at all.

**The honest limit.** The declared set is not what decides reuse. A question's own evidence is,
which is stronger evidence than the page's declaration, and the set's consumers are the batch
record, the live `awaitingObservation`, the run report, a resumed run, and ticket 15's panel. If
the set is meant to drive reuse directly, that is a different design and the cache would have to
be scoped per ref.

The vacuous test is gone rather than sitting beside a good one: the replacement asserts the
declared set and the replanned refs, and disabling the cache makes it fail.
