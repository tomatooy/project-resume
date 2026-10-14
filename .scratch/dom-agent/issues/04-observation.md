# 04: Observation

**What to build:** A bounded, honest picture of the current page: structure, live control state, accessibility semantics, relationships, errors, and the regions that could not be reached.

**Blocked by:** 03

**Status:** done

- [x] DOM and accessibility are joined by browser node identity, and accessible names are never treated as identifiers.
- [x] Observation starts with a bounded overview and can read a region, a local fragment, or an option portal on request, within a byte budget.
- [x] Frames and available shadow content are observed through their own contexts; nodes are never joined across contexts by numeric identifier or accessible text.
- [x] Requiredness is required, optional or unknown with supporting evidence, and an absent attribute alone never establishes optionality.
- [x] Unreachable, truncated and unsupported regions are recorded as explicit gaps that survive into the completeness count.
- [x] Extension UI, credentials and tokens are excluded from what is observed.
- [x] Tested against recorded fixtures and mocked lifecycle events; truncation and missing context are covered by tests.

## Landed

`apps/extension/src/dom-agent/observation-payload.ts` validates the two protocol
payloads this reader consumes (DOM tree, AX tree), because the protocol is
external input and a shape surprise must degrade into a gap rather than a crash.

`apps/extension/src/dom-agent/observation.ts` is the reader:

- one DOM read and one AX read per session context, joined by `backendNodeId`;
  accessible names are carried but never used as identity
- two passes: the first decides what is worth keeping and stops at frame and
  shadow boundaries, the second assigns references top-down, so a reference
  always belongs to a context and no parent reference dangles
- frames, same-process frames and open shadow roots each become their own
  context, so nothing is joined across them
- requiredness is decided here, with evidence, and an absent attribute leaves it
  `unknown`; it travels to the question through the read result, because the
  shared `ObservationNode` shape has no field for it
- gaps for unreadable contexts, closed shadow roots, truncated subtrees, budget
  ceilings, and policy exclusions
- on-demand `readRegion`, `readFragment` and `readOptions` reads, addressed by
  browser identity rather than by selector
- the radio and checkbox sets that submit as one field become one control whose
  members are its options, grouped on a native signal (shared `name` in a form)
- an element another control names through `aria-controls`/`aria-owns` is its
  option list, not a question of its own

The last acceptance box stays open on purpose: `Tested against recorded
fixtures` needs ticket 05. Everything else is covered by
`test/dom-agent-observation.test.ts` (29 cases), which drives the reader through
`test/helpers/cdp-page.ts`, a stand-in that builds protocol payloads from
markup. Ticket 05 replaces that stand-in with recordings; the reader does not
change, because it consumes payloads rather than a DOM.

Box ticked 2026-10-14 against named tests rather than an impression:
`dom-agent-observation.test.ts` drives the reader through the fixture loader and asserts a
subtree the browser returned truncated is recorded as such, and
`dom-agent-page-reader.test.ts` reports candidate and text truncation instead of claiming
complete coverage (that report is the fix from `fix-03`).
