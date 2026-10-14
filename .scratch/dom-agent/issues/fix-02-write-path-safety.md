# fix-02: Write-path and receipt safety

**What to build:** The write-path half of the review findings. Sources are the review pass over `8cdf011..711cb87`; item numbers refer to it.

**Blocked by:** nothing. **Status:** ready-for-agent.

**You own exactly these files.** Change nothing else.

- `apps/extension/src/dom-agent/runtime-request.ts`
- `apps/extension/src/dom-agent/runtime-receipt.ts`
- `apps/extension/src/dom-agent/runtime/dispatch.ts`
- `apps/extension/src/dom-agent/runtime/verbs.ts`
- `apps/extension/src/dom-agent/runtime/control.ts`
- `packages/resume-core/src/dom-agent/receipt.ts`
- `packages/resume-core/src/dom-agent/action.ts`
- `packages/resume-core/src/dom-agent/source-service.ts`
- `packages/resume-core/src/dom-agent/saved-answer.ts`
- `apps/extension/test/dom-agent-runtime.test.tsx`
- `apps/extension/test/dom-agent-runtime-bridge.test.ts`
- `packages/resume-core/test/dom-agent.test.ts`

The parallel lane owns `observation.ts`, `questions.ts`, `primitives.ts`, `question.ts`, the observation and question tests, and `packages/resume-core/test/dom-agent-reader.test.ts`. Do not edit those, even to make a test compile: if you need a change there, report it instead.

Note the other lane is making `ObservedOption.ref` non-empty for the first time, so option references will start resolving in your lane's code paths. Make sure the bridge carries a real reference through rather than a label alone.

## 1. Attachment replacement is unauthorized without a reviewed choice (finding 1, priority 1)

`attachmentIsAuthorized` and `batchIsAuthorized` exist, are unit-tested, and have no production caller. `runtimeCall` drops `replacementConfirmedAt` and passes `replaceExisting` straight through, and the page replaces whenever that boolean is true. So `{ replaceExisting: true, replacementConfirmedAt: null }` is expressible and overwrites the user's own attachment, which no reviewed choice authorized.

Refuse to express an attachment action when `!attachmentIsAuthorized(action)`; returning `null` already reports unresolved to the caller. Belt and braces: carry whether a replacement was confirmed into the step and refuse it in the verb, so the page cannot be talked into a replacement by a malformed request. Add a bridge test with `replaceExisting: true, replacementConfirmedAt: null` asserting that nothing is called.

## 2. A reverted selection must not stay accepted (finding 8, priority 2)

`revertedReceipts` compares only `value` and `checked`. For a radio group the observed `value` is the anchor's immutable `value` attribute, so it never changes; the receipt does carry `observed.optionRef` but the helper ignores it. A selection the page reverts after the settle window therefore stays accepted with no counter-evidence.

Compare `optionRef` when the receipt has one and the fresh observation supplies one. Add the test that fails today: an accepted selection receipt plus a fresh observation selecting a different option must come back as reverted.

## 3. A toggle may not write without an expectation (finding 9)

`expectedChecked` is nullable and the page treats null as do-not-assert, so a toggle can overwrite a state change the user made after the observation. Refuse a toggle whose expectation is null in the page runtime. Do not tighten `ActionSchema` in this batch: no caller exists yet, and ticket 11 is where the requirement belongs. Record that decision in this ticket's report so ticket 11 inherits it.

Also record, in the same report, that `documentGeneration` and `userEditEpoch` travel to the page as data and are compared nowhere, so the user-edit pause rule has no implementing check. Ticket 11 lands that check and needs to know.

## 4. The submit-affordance guard is incomplete (finding 10)

`looksLikeSubmit` blocks `input` only for `submit` and `image`, applies the wording list only to `<button>` and `role=button`, and never looks at `href`. An `<input type="button" value="Continue">` or an `<a>` reading Add or Next is a legal `add_record_group` target and will be clicked, which can navigate or submit. Navigation is manual, always.

Apply the wording list to any activatable element, including `input[type=button]`, and refuse elements carrying an `href` or `role=link`.

## 5. Exports with no consumer (finding: dead and speculative exports)

Make `resumeFacts` and `profileFacts` in `source-service.ts` module-private: they are used two lines above their definition and reachable from no package entry. Do the same for the exports of `saved-answer.ts` that nothing outside the file uses (`ProfileTargetSchema`, `AnswerDestinationSchema`, `isFieldSection`, `profileFieldNames`, `profileFieldExists`), keeping public whatever the tests really import.

Leave the deliberate seams alone: `batchIsAuthorized` becomes wired by item 1 here, and `receiptSettles` / `revertedReceipts` are item 2's subject. Anything still exported only for tests should say so in a comment.

## 6. Three tests survive the mutation they imply

1. In `dom-agent-runtime.test.tsx`, "refuses bytes that are not the rendered PDF" is masked by the length check: `btoa("not a pdf")` is 9 bytes while `sizeBytes` is 8, so the magic-number check never runs. Make the fixture the right length so the magic check is what refuses, and confirm by temporarily removing the magic check that the test now fails.
2. In the same file, "refuses a question revision older than one it already handled" only replays a lower revision, so `<` and `<=` are indistinguishable. An equal-revision replay of `add_record_group` is allowed today and would add a second record group. Add the equal-revision case for a mutating verb and make the guard match what the comment claims.
3. In `dom-agent-questions.test.ts`, `Object.keys(dispositions).length === questions.length` is tautological because one loop produces both. Assert something that does not move with the loop, or drop the line in favour of the explicit per-question assertions.

Two smaller notes to address if cheap: the upload test exercises the `Object.defineProperty` fallback because jsdom has no `DataTransfer`, so the real browser path and its fake `FileList` are unverified; and the record-group test asserts that record refs exist and differ, which cannot catch over-marking every sibling as a record.

## Verification, and what to report

Run, from the repository root unless noted:

```
cd apps/extension && bunx tsc --noEmit && bunx vitest run
cd packages/resume-core && bunx tsc --noEmit && bunx vitest run
bunx biome check --write apps/extension packages/resume-core
```

Report: files changed, the exact commands with their real output, which findings are closed, the two notes for ticket 11 (the toggle schema decision and the uncompared generation and epoch), and anything you could not do. Claim no green check you did not observe.
