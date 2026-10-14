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

## What this ticket also has to do (2026-10-14)

**Nothing currently starts a run.** The last box says everything speaking the retired protocol is
rebuilt, and that rebuild is the wiring, not just the frame: nothing in `apps/extension/src`
constructs `RunCoordinator` or calls `fillCurrentPage` today, and the only import of `dom-agent/`
from outside its own directory is `engineCanStart` in `autofill/background.ts:10`. The guard at
`dom-agent/engine.ts` is hard-coded `{ ready: false }`, so `background.ts:619` refuses every fill
before run state exists.

So this ticket owns the first moment any of tickets 01 to 17 becomes reachable from the product.
Two consequences worth planning for:

- **The audit landed on the coordinator path only.** `run-page.ts:178` (the single-pass path)
  still stops at `auditing` and never calls it. Whoever wires the panel decides whether that path
  survives or is deleted.
- **`RunReport` now carries `audit` and `verdict`, and a finished pass ends `ready` or
  `incomplete` where it used to end `auditing`.** The panel is the first consumer of those
  fields, so the retired protocol's shape is what it has to map onto.
