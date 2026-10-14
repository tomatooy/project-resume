# 20: Portal-backed options cannot be answered

**What to build:** a combobox whose options only mount when its list is opened can be answered,
because today it cannot be answered at all.

**Blocked by:** nothing. Found while landing 11a, which could not write the portal test its own
box asked for, and says so on that ticket.

**Status:** ready-for-agent

- [ ] Options read from a mounted portal carry a reference the rest of the engine can address, so an action can select one.
- [ ] The reference is refused rather than guessed at when the list remounts under it, and a test drives a portal combobox from read through proposal to selection.
- [ ] An error message the page states for the control is still read when the message itself is in a portal, or the ticket says why not.

## Why this is worth fixing

Country, state, city and school pickers are usually built this way on real ATS forms, so this is a
reach limit rather than an edge case: those questions are unfillable today, and they are among the
ones a person most wants filled.

11a made the round after an effect cheap, and a portal is the canonical effect: a choice opens a
list, the list mounts elsewhere in the document, and the next round reads it. So the path this
ticket fixes is the one 11a just made routine.

## The mechanism, so nobody rediscovers it

`readOptions` (`apps/extension/src/dom-agent/observation.ts`) reads the mounted list on demand and
returns `ObservedOption[]` carrying `ref: ""` for every option, because it never runs `emit` and so
never allocates a reference. The read is triggered by the question's own `evidence.portal` through
`needingOptions` (`questions.ts`), and `attachOptions` then attaches what came back to the question
without assigning anything. The three sites that build options at plan time carry `ref: ""` too,
and are fixed up later by `emit`, which is the step the on-demand path skips.

Two things downstream need a real reference:

- A proposal's `optionRefs` is `z.array(z.string().min(1).max(64))`
  (`packages/resume-core/src/dom-agent/answer.ts`), so an empty string fails validation.
- A `select_option` action takes `optionRef: NodeRefSchema`
  (`packages/resume-core/src/dom-agent/action.ts`), and `runtimeCall` resolves that reference to a
  label with `labelFor(input.options, action.optionRef)` before the page is asked to select it.

So the label mechanism already works and only the reference is missing. `attachOptions`
(`apps/extension/src/dom-agent/questions.ts`) attaches the read options to their question and
assigns nothing.

## What the lane has to decide

- **Where a portal option's reference is allocated.** The options are read in a fragment whose
  nodes are not part of the observation's own node list, so either that read emits references of
  its own, or the option carries the identity the runtime needs directly.
- **Whether the reference survives the round that follows**, since a remounted list is a new
  document region. A stale one must be refused, which is the same shape as the existing
  refuse-rather-than-guess rules and as the stale-`optionRef` risk recorded in
  `open-after-review-fixes.md`.
- **Whether the plan-time `ref: ""` sites** should be unified with whatever this lane settles on,
  or left to `emit` as they are.

## Test shape

A fixture whose combobox mounts its options in a portal, driven end to end: the read states the
options, the proposal names one, and the action selects it. The presence of the options alone is
not the claim; the claim is that one can be chosen.
