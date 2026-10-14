# fix-03: A read cut at the depth ceiling reports complete

**What to build:** the truncation gap must be reported for every node the read cut, not
only for the nodes that survived planning.

**Status:** ready-for-agent

- [ ] A node the payload returned with fewer children than it declares records a gap even
      when the node itself is dropped from the observation.
- [ ] A test drives a payload cut the way a browser cuts it (children omitted, child
      count present) and asserts the observation cannot report complete.
- [ ] The test that records today's behaviour in `dom-agent-fixtures.test.ts` is updated
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
