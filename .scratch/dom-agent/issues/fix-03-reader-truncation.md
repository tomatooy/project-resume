# fix-03: A read cut at the depth ceiling reports complete

**What to build:** the truncation gap must be reported for every node the read cut, not
only for the nodes that survived planning.

**Status:** done

- [x] A node the payload returned with fewer children than it declares records a gap even
      when the node itself is dropped from the observation.
- [x] A test drives a payload cut the way a browser cuts it (children omitted, child
      count present) and asserts the observation cannot report complete.
- [x] The test that records today's behaviour in `dom-agent-fixtures.test.ts` is updated
      to assert the gap instead.

## Mechanism, verified by reading the code

`emit` reports truncation:

    const declared = plan.dom.childNodeCount ?? 0
    const present = (plan.dom.children ?? []).length
    if (declared > present) → gap "truncated"

But `emit` runs only for nodes that survived `planNode`, which drops a node holding no
control, no region and no kept text:

    const keep = children.length > 0 || control !== null || region || isTextHolder || depth === 0
    if (!keep) return null

So the unread children of a dropped node are counted nowhere. The `depthCapped` counter
cannot cover it either: it increments only when `depth > MAX_PLAN_DEPTH`, which needs a
recursion past the ceiling, which a payload cut at the ceiling does not allow, because
the cut node arrives with no children to recurse into.

Cut payload: `depthCapped.count` stays 0, no truncation gap, `coverage.complete` true.
The stand-in's uncut tree: the same subtrees sit at depth 41, `depthCapped` counts them,
a gap is pushed. That inversion is why the committed test passes.

This is the production shape, not a hypothetical: the reader asks the browser for a
bounded depth (`depth: MAX_PLAN_DEPTH`, at the document read and again for the option
portal), so boundary nodes arrive with a declared child count and no children.

## Fix direction

Check truncation where a node is dropped as well as where it is emitted, which simplest
means checking on entry to `planNode` for every element node before the keep decision and
counting it into the gap the summary already reports. Non-element roots need the same: a
document or shadow root whose children were cut returns null when `roots.length === 0 &&
depth !== 0`, and that is a gap too.

## Why it matters

Coverage is what gates `ready`. A page that reports complete while a subtree went unread
is the same class of lie as a receipt claiming an upload the site never accepted, and the
existing comment already states the intended rule: "a node the read returned without all
of its children is a gap, whether a ceiling cut it or the read itself was bounded before
it". The fix is incomplete for dropped nodes, not absent.

## Lesson folded in

A test double that serves more than the browser would hides exactly the bugs the real
payload shape causes. The stand-in returned uncut trees, so the ceiling path that
production always takes was never exercised; the lane found it only after building a
recorder that prunes the way the browser cuts.

## Lane ownership (this pass)

**Owns:** `apps/extension/src/dom-agent/observation.ts` and its payload module,
`apps/extension/test/dom-agent-observation.test.ts`,
`apps/extension/test/dom-agent-fixtures.test.ts`, the reader modules in
`packages/resume-core/src/dom-agent/` if the gap vocabulary has to change, the
dom-agent barrel if an export is needed, and this ticket plus
`06a-button-based-choices.md`.

**Must not touch:** `apps/extension/src/autofill/**`, `packages/agent/**`, or
anything the other lane reads.

`06a` is in the same lane on purpose: both changes are reader changes in
`observation.ts`, and one writer per file is the rule that has kept every merge
on this branch free of conflicts.

## Landed (2026-10-14, reader lane)

The count moved out of `emit` and to the top of `planNode`, so every node the plan
touches is checked exactly once whether planning keeps it or drops it. `emit`'s copy is
deleted, because leaving both would report one cut twice. The count is summarised per
context beside the depth-ceiling gap, so a wide page cannot push one gap per boundary
node past the 64 the schema allows.

Evidence, all observed: removing the check fails three tests, the dropped-node case
added here (a leaf-shaped div declaring three children), the kept-node case that already
existed, and the recording the depth model cuts. That last one asserted
`complete === true` before this change and asserts the gap now.

Deliberately not done: the per-node detail `n of m children were read` went with
`emit`'s copy, and the summary names the count and the cause instead. If a future reader
needs to know which nodes were cut, that detail has to come back without the per-node
gaps.

No change was needed in `resume-core`: `CoverageGap.reason` already carries
`truncated`, and the summary uses it. Noticed while here and left alone as out of
scope: `observationBytes` is exported and used only inside `observation.ts`.
