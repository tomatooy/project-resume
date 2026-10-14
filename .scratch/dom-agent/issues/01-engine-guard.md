# 01: Engine guard

**What to build:** The extension keeps loading and the LinkedIn tailoring path keeps working while the autofill engine is replaced. Fill current page stops trusting the old engine and answers with one explicit not-yet-implemented result that the panel renders as plain text.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The panel reports the unavailable engine as a message, not as a new run state and not as an error toast.
- [x] No new run state is added to the state machine.
- [x] The LinkedIn widget, tailoring, retry and navigation paths are untouched.
- [x] One test covers the refusal and one covers the LinkedIn path still being wired.

## Landed

Landed: `apps/extension/src/dom-agent/engine.ts` (status plus `engineCanStart`), the `engine` panel error code in `messages.ts`, and the guard at the top of the `af.start` branch in `background.ts`, so it refuses before any run state exists. Deleted `test/autofill-session.test.ts`: 16 of its cases drove `af.start` through the retired engine. Recover it with `git show 5693abd:apps/extension/test/autofill-session.test.ts` for ticket 11, which owes those behaviours new tests.
