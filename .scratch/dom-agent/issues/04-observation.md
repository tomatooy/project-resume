# 04: Observation

**What to build:** A bounded, honest picture of the current page: structure, live control state, accessibility semantics, relationships, errors, and the regions that could not be reached.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] DOM and accessibility are joined by browser node identity, and accessible names are never treated as identifiers.
- [ ] Observation starts with a bounded overview and can read a region, a local fragment, or an option portal on request, within a byte budget.
- [ ] Frames and available shadow content are observed through their own contexts; nodes are never joined across contexts by numeric identifier or accessible text.
- [ ] Requiredness is required, optional or unknown with supporting evidence, and an absent attribute alone never establishes optionality.
- [ ] Unreachable, truncated and unsupported regions are recorded as explicit gaps that survive into the completeness count.
- [ ] Extension UI, credentials and tokens are excluded from what is observed.
- [ ] Tested against recorded fixtures and mocked lifecycle events; truncation and missing context are covered by tests.
