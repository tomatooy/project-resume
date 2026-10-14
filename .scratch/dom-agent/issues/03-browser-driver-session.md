# 03: Browser driver: session

**What to build:** The worker can attach to the current tab through the debugger protocol, prove that real accessibility access exists, and know when everything it observed has become invalid.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The manifest declares the debugger permission and the extension still loads.
- [x] Attach is refused unless a run is active, and detach happens on completion, cancellation, and pause that needs the user.
- [x] A capability probe reports whether accessibility access is genuinely available; when it is not, filling stays paused and says so, and there is no silent fallback to the old reader.
- [x] Frame, execution-context and document generation are tracked separately, and out-of-process frames are reachable through child sessions.
- [x] Detach, navigation, document replacement and context destruction invalidate the affected node references and cancel dependent in-flight work.
- [x] A restarted worker reattaches and observes before any further write.
- [x] A shared chrome debugger mock replaces the hand-rolled inline stubs for this path, and protocol lifecycle events are covered by tests.

## Landed

Landed: `apps/extension/src/dom-agent/cdp.ts` (reviewed CDP method allowlist plus the only `chrome.debugger` call site) and `session.ts` (attach owned by a runId, real capability probe rather than assuming support, generation-checked sends, invalidation on document, frame and execution-context events, child sessions for out-of-process frames, no capability reused across attachments). Added the `debugger` permission, the shared `test/helpers/chrome-debugger.ts` harness, and `test/dom-agent-session.test.ts` (15 cases). `onEvent` delivers a `DebuggerSession` while `onDetach` delivers a plain `Debuggee`; that distinction is what the types now say.
