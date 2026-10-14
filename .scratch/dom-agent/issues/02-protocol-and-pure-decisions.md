# 02: Protocol, run states and pure decisions

**What to build:** The browser-independent spine everything else compiles against: the shared protocol the design names, the run state machine, and the pure decision functions that must never be duplicated.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Protocol covers observation and coverage, candidate question and its key, fact and source bundle, answer proposal, action and receipt, and audit issue, all as Zod schemas with types derived by inference.
- [x] Question key derivation is deterministic over normalized wording, kind, explicit scope and option signature; it is a documented migration to change it.
- [x] Application identity extraction uses host, path and a query-name allowlist, and yields an explicit unknown rather than guessing from the hostname.
- [x] The temporary-state key shape covers account, tab and application identity together.
- [x] The readiness rule treats an optional blank as ready, and a failed write, unknown requiredness, unresolved conflict or unobserved region as not ready.
- [x] Coverage accounting can never drop a question silently.
- [x] Statuses and pure functions are unit tested against hand-written inputs with no browser and no model.

## Landed

Landed: `packages/resume-core/src/dom-agent/{limits,fingerprint,primitives,observation,question,source,answer,action,receipt,audit,run,application,session}.ts` with a `./dom-agent` subpath export, plus `test/dom-agent.test.ts` (38 cases). The subtree is deliberately absent from the `src/index.ts` barrel: the retired contract already exports `ActionSchema`, `FactSchema` and `SourceRefSchema`, so a barrel merge would shadow one with the other. `application.ts` moved here from the extension, which now re-exports it.
