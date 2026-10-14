# 11b: Make an add dispatchable

**What to build:** the reader affordance and the coordinator path that let a run press an
"add another" control once, write the intent before it dispatches, and recognise the group it
created on the next observation.

**Blocked by:** nothing beyond this ticket. The record rules exist, the plan is driven, and
`RunReport.recordGroups` already reports bindings, refusals, supplements, missing groups and
the proposed add.

**Owed to:** ticket 13 boxes 1, 2 and 4, and ticket 11 box 2's record-creation half.

**Status:** ready-for-agent

- [ ] The observation carries the control that adds a group for a record container, and the reader obtains it from the page rather than guessing: today it keeps `aria-controls` privately and only for comboboxes, a bare `<button>` is not a question at all, and `KIND_BY_CONTROL` therefore never yields a record-group kind.
- [ ] A group's identity survives one observation, so a group the run added can be bound before another add is asked for. Group refs are assigned per observation today, which is why `recordGroupPlan`'s `added` cannot span two reads.
- [ ] The coordinator dispatches at most one add per observation, with its intent written before dispatch, and the added group is observed and bound before the next add.
- [ ] `missing` and a refusal reach the user as a request rather than as silence.

## The hazard the lane flagged, which this ticket must handle

`nextAdd` fires whenever nothing is unresolved, so on a page showing a *single* entry, which
is unmarked because marking needs two, the proposal is an add for a record the page already
shows. The caller must require that the observation actually holds a group before it presses
anything. Pressing the wrong control adds a blank record to a real application, so this is
the first thing to get right.
