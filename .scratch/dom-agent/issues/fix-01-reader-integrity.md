# fix-01: Reader integrity

**What to build:** The reader half of the review findings. Sources are the review pass over `8cdf011..711cb87`; item numbers refer to it.

**Blocked by:** nothing. **Status:** ready-for-agent.

**You own exactly these files.** Change nothing else.

- `apps/extension/src/dom-agent/observation.ts`
- `apps/extension/src/dom-agent/observation-payload.ts`
- `apps/extension/src/dom-agent/questions.ts`
- `packages/resume-core/src/dom-agent/primitives.ts`
- `packages/resume-core/src/dom-agent/question.ts`
- `apps/extension/test/dom-agent-observation.test.ts`
- `apps/extension/test/dom-agent-questions.test.ts`
- `packages/resume-core/test/dom-agent-reader.test.ts` (new file)

The parallel lane owns `verbs.ts`, `runtime-request.ts`, `runtime/**`, `receipt.ts`, `source-service.ts`, `saved-answer.ts` and `packages/resume-core/test/dom-agent.test.ts`. Do not edit those, even to make a test compile: if you need a change there, report it instead.

## 1. Options must carry a reference (finding 2, priority 1)

Every option the reader emits is `ref: ""` because grouped members are dropped from the node tree and `<option>` elements are never kept. So a question with options fails its own `CandidateQuestionSchema`, `select_option.optionRef` can never name an observed option, and the staleness check the ref exists for cannot work.

Emit option members and `<option>` elements as referenceable nodes, and fill `ObservedOption.ref` from the member's reference. They stay options, never questions. Add assertions that parse real reader output through `CandidateQuestionSchema` and `QuestionSchema`, so a question with options cannot be emitted with an empty ref again.

## 2. Anything dropped records a coverage gap (finding 5, priority 3)

Two depth ceilings drop subtrees silently: `planNode` past depth 40 and `rootsOf` past depth 10 for frames and shadow roots. The existing truncation check cannot see it, because a child cut by the ceiling is still counted as present, so `coverage.complete` stays true and the question never enters the count. A failed `readAx` on a fragment or option read is swallowed the same way.

Push a `truncated` or `unsupported` gap whenever a ceiling or a failed read drops something. Test by nesting past both ceilings and asserting `coverage.complete === false`, not merely that a gap array is non-empty.

## 3. Wording comes from the page, and a key requires wording (finding 4, decision taken)

`wordingFor` falls back to `node.name`, the browser-computed accessible name, and ADR 0001 lists accessible names among the transient identifiers that must never be identity. Read page-authored evidence instead (`placeholder`, `title`, `aria-label`, the `<legend>` or `<label>` text), and drop the `node.name` fallback.

Decision: a question with no page-authored wording keeps no reusable key. It stays in the list, keeps its place in the count, and can still be filled live, but no saved answer may attach to it. Two unlabelled fields of one kind must not collapse into one identity.

Also state in a comment where explicit page-stated scope enters the key, since today `scope` is always `[]` and that dimension is inert. Ticket 09 supplies it; the key function must not take it from the model or the AX tree.

## 4. Multi-selection is refused in v1 (finding 7, decision taken)

`<select multiple>`, and a checkbox group where more than one selection is expected, must seed `unsupported` with a coverage gap and never reach a write. `applySelection` sets `.value` on a multi-select, which clears every other selection the user had, and no reviewed choice authorizes losing them.

For controls that remain (single choice with a radio anchor, and a radio group where the user has already selected a different option), verification must test that **the target entry is selected**, not that the first selected entry matches the target. Today `find((entry) => entry.selected)` returns the user's own earlier choice, so a correct write reports `option_not_selected` and burns the full settle budget.

## 5. Constraints are read (ticket 06, acceptance box 2)

No `maxlength`, `pattern`, `min`, `max` or `inputmode` is read anywhere, so a candidate question does not carry its constraints. Read them for the kinds that have them and carry them on the observed control. A question whose answer violates a stated constraint should be knowable before a write, not discovered by the page rejecting it.

## 6. The deterministic tier stays native (ticket 06, acceptance box 5)

`exactLabelMatch` has no kind restriction, so the tier is not limited to native kinds and exact label matches as the ticket requires. Enforce the restriction in the API rather than in a comment: a caller must not be able to obtain an exact match for a kind outside the native set.

## 7. A bounded first read (ticket 04, acceptance box 2)

The first read is `DOM.getDocument({ depth: -1 })`, an unbounded fetch, and `readRegion` is exported but has no caller and no test. Start with a bounded overview, then read a region, a local fragment or an option portal on request, within the byte budget. Either call `readRegion` from a tested path or delete it; an exported, untested, uncalled read is how the overview pass went missing.

## Verification, and what to report

Run, from the repository root unless noted:

```
cd apps/extension && bunx tsc --noEmit && bunx vitest run
cd packages/resume-core && bunx tsc --noEmit && bunx vitest run
bunx biome check --write apps/extension packages/resume-core
```

Report: files changed, the exact commands with their real output, which review findings and acceptance boxes are now closed, and anything you could not do. Claim no green check you did not observe.
