# 07: Page runtime: actions and receipts

**What to build:** A fixed, bundled action vocabulary that runs in the page and reports what actually happened, with no code path that accepts model-authored JavaScript.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] The runtime exposes only bounded reads, option discovery, text entry, single and multiple choice selection, file attachment, and observed non-submitting record creation.
- [ ] Every action validates the current document and frame generation, the question and option revision, the source bundle identity and the expected current value before it writes.
- [ ] Receipts distinguish dispatch, accepted control state, and unresolved verification, and detect late rejection and framework reversion.
- [ ] A replaced control is resolved from a fresh observation, never by a stale selector or a recycled DOM identifier.
- [ ] The runtime is built as a second self-contained bundle with its own build assertion, and the model never supplies code to it.
- [ ] Success and failure paths are covered by tests against hand-written markup.
