# 07: Page runtime: actions and receipts

**What to build:** A fixed, bundled action vocabulary that runs in the page and reports what actually happened, with no code path that accepts model-authored JavaScript.

**Blocked by:** 03

**Status:** done

- [x] The runtime exposes only bounded reads, option discovery, text entry, single and multiple choice selection, file attachment, and observed non-submitting record creation.
- [x] Every action validates the current document and frame generation, the question and option revision, the source bundle identity and the expected current value before it writes.
- [x] Receipts distinguish dispatch, accepted control state, and unresolved verification, and detect late rejection and framework reversion.
- [x] A replaced control is resolved from a fresh observation, never by a stale selector or a recycled DOM identifier.
- [x] The runtime is built as a second self-contained bundle with its own build assertion, and the model never supplies code to it.
- [x] Success and failure paths are covered by tests against hand-written markup.

## Landed

**Page side** (`apps/extension/src/dom-agent/runtime/`):

- `protocol.ts`: the wire format, the frozen verb list, the evidence codes, clamped
  settle budget, and the structural readers both sides use. Types only from
  `resume-core`, so the bundle inlines no schema library.
- `control.ts`: prototype-setter writes (a framework's value tracker only sees a
  change if the prototype setter is used), label reading, option entries for
  select / radio / checkbox / listbox plus `aria-controls` portals, submit
  detection, bounded settling, and the upload handoff.
- `verbs.ts`: the seven verbs, each reporting what it observed.
- `dispatch.ts`: the single entry point. Refuses an unknown verb, a malformed
  step, a request from another runtime build, a replayed question revision, and a
  source bundle that changed mid-application, all before any write.
- `main.ts`: the bundle entry. One install per document, keyed by a per-install
  nonce, so a page left holding a runtime from an earlier extension build cannot
  be addressed by the current one.

**Worker side**: `runtime-inject.ts` (install expression, install params,
dispatch params, release params, reply reading, bundle loader),
`runtime-request.ts` (action to call, null when a reference is stale),
`runtime-receipt.ts` (reply to `Receipt`, schema-parsed).

**Build**: the runtime is a second self-contained bundle, built by the same
helper in `vite.config.ts` that the content script uses, asserted import-free and
emitted as `dom-agent-runtime.js` (13.5 KB, no imports).

**No code path accepts model-authored JavaScript.** The dispatch declaration is a
fixed literal; the verb arrives as a value and is looked up in a frozen set; the
control arrives as the protocol call target, never as a selector.

Verified: 280 extension tests pass (56 new), `tsc` and `biome` clean, and the
built bundle was executed in a page realm to confirm install, a text write, an
option selection, a stale-revision refusal, a refused submit affordance, a
framework reverting a write, and an unauthorised attachment replacement refusal.

## Deliberate seams left for later tickets

- **Upload completion stays `unresolved`.** Assigning a `FileList` is the local
  handoff; the spec is explicit that an unobservable upload remains unverified.
  ATS attachment state is ticket 12's.
- **`attach_file` bytes are verified by identity.** `runtime-request.ts` refuses
  bytes whose identity is not the action's `pdfIdentity`, so a stale cache can
  never be attached. Rendering those bytes is ticket 12's.
- **`add_record_group` reports growth only when the page names the container**
  (`aria-controls`). Otherwise it is `unresolved` rather than assumed, and the
  fresh observation after an add is the coordinator's (ticket 13).
- **The injection seam has no production caller yet.** `installParams`,
  `dispatchParams`, `releaseParams` and `chromeBundleLoader` are exercised by the
  test suite but will be called by the run coordinator in tickets 09 and 11. They
  are the wire contract between here and there, so they are tested now rather
  than written later against a page runtime nobody can drive.
- **`RuntimeOutcome.state` never returns `dispatched`.** Every verb verifies, so
  the state exists in the contract but is not produced here. Left as contract.

## Notes for whoever picks this up

- `Runtime.callFunctionOn` was added to the reviewed allowlist in `cdp.ts`. It is
  not a widening: `Runtime.evaluate` is already there and is strictly more
  powerful. It is the only way to hand a resolved control to the injected runtime
  as an argument instead of as a selector. Do not remove it without giving the
  runtime another way to receive a control.
- `chromeBundleLoader` reads `dom-agent-runtime.js` with
  `chrome.runtime.getURL` plus `fetch` from the service worker, so no
  `web_accessible_resources` entry is needed and the page never fetches the
  bundle. This route is unverified against a real browser here; the integration
  test in this ticket drives the protocol double instead. Ticket 11 is the first
  place it runs for real.
- `RUNTIME_SETTLE_MAX_MS` mirrors `DOM_AGENT_LIMITS.controlInteractionMs`; a test
  asserts they are equal, so the page can never be asked to wait longer than the
  contract allows.
