# 11a: Replan only what an effect touched

**What to build:** after a dynamic choice changes the page, replan the questions that choice
affects rather than the whole page, so a portal opening does not cost a full re-read.

**Blocked by:** reader evidence of the affected set. Nothing in the observation says which
questions a control's effect touches, so `affects` is hard-coded empty at the coordinator's
checkpoint site, `checkpoint.awaitingObservation` is written only as empty, and the
interpretation cache is never constructed outside tests.

**Owed to:** ticket 11 box 1, whose first two clauses are already proven.

**Status:** ready-for-agent

- [ ] The observation states, for a control that changed the page, which questions it affected, or states that it cannot tell and says so rather than reporting an empty set.
- [ ] The coordinator's checkpoint carries that set and the next round plans exactly those questions, with a test whose portal question is answerable so the narrower path is observable rather than trivially equal.
- [ ] If the reader cannot supply the set, this ticket says so and the box is restated, because an `affects` field that nothing populates is what the audit caught the first time.

## Note

The existing test near the checkpoint's affected-set assertions is vacuous: its combobox
question has no matching fact, so the before and after counts it compares are equal whether
or not anything was replanned. Replace it rather than adding beside it.
