# 15: Review queue and panel

**What to build:** One place where the user resolves what the engine could not, without ever being asked to choose an internal concept or a record identifier.

**Blocked by:** 02, 11, 14

**Status:** ready-for-agent

- [ ] The panel keeps its frame, dock behaviour, progress affordances and pause, continue and cancel controls, and everything speaking the retired protocol is rebuilt.
- [ ] The queue shows one card per question with the original wording, options or format, and the relevant source conflict or missing evidence.
- [ ] Several answers can be submitted in one action, and persistent saving is a separate, explicit choice from confirming an answer.
- [ ] Confirmed answers resume the run against a fresh observation, and answers that reveal more required questions join the queue.
- [ ] Optional missing items stay visible without blocking, and no answer is generated for them.
- [ ] The concept-shaped answer grid and its tests are deleted, and the content script shrinks to hosting the panel.
