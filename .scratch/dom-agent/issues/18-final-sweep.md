# 18: Final sweep: delete the retired engine

**What to build:** The old engine is gone, so nothing can quietly depend on it and no reader has to work out which of two paths is live.

**Blocked by:** 01 to 17

**Status:** ready-for-agent

- [ ] The old engine modules, the retired content-script protocol, the planner, the concept enumeration, the rules table, the statistical decider, the page interpreter and the drafter are deleted.
- [ ] The tests that encode the retired shapes are deleted with them, and no test asserts on a concept or a field snapshot.
- [ ] No import of a retired module remains anywhere, and the import-privilege test still passes.
- [ ] The extension still loads, the LinkedIn path still works, and the navigation panel behaviour is unchanged.
- [ ] Typecheck, lint and the remaining suites pass.
