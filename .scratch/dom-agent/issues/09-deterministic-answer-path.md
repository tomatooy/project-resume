# 09: Deterministic answer path

**What to build:** The tracer bullet: Fill current page resolves the questions it can, writes them safely, verifies what happened, and shows honest progress, with zero model rounds.

**Blocked by:** 02, 06, 07, 08

**Status:** ready-for-agent

- [ ] An exact-match binding of facts to questions fills the simple controls and produces a receipt for each.
- [ ] Everything unmatched enters the review queue with its original wording rather than being guessed or left silent.
- [ ] Progress shown to the user counts verified receipts, never dispatched actions.
- [ ] Question interpretation is reused until its semantic evidence changes.
- [ ] The frozen multi-field form completes with no whole-page re-reasoning per control.
- [ ] Covered by tests over fixtures with the model absent entirely.
