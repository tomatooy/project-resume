# Old autofill domain layer: recon brief

## 1. Pipeline, stage by stage, and owner modules

`AutofillService` (`packages/resume-core/src/autofill/planner.ts:63`) is the one orchestrator. Public API: `policy()`, `draft()`, `document()`, `prepare()`, `plan()`. `plan()` (`planner.ts:352`) is the main pipeline:

1. **Validate input** `planner.ts:357` against `PlanInputSchema` + `AUTOFILL_LIMITS.bodyBytes`.
2. **Reserve quota** `planner.ts:399` (`quota.reserve("plan")`).
3. **Pin/load source** `pinnedSource()`/`source()` `planner.ts:238,268` -> `SourceSnapshot` (resume + profile + scoped answers, contract.ts:130).
4. **Build facts** `factsFor()` `facts.ts:16` (resume/profile/overrides/supplemental -> `Fact[]`).
5. **Rule classification** `ruleFor()`/`blockedField()` `rules.ts:74,110` (deterministic label->concept).
6. **Page interpretation** `planner.ts:526`, calls `AutofillPageInterpreter.interpret` (agent `page-interpreter.ts`), reconciled by `reconcilePageInterpretation` `interpreter-port.ts:119`.
7. **Jev decision** `ask()` `planner.ts:456,488` -> `AutofillDecider.decide` (agent `jev-decider.ts`).
8. **Decide per field** -> `FieldDecision[]`, build `FillPlan` (actions + interactions) -> `AutofillPlanOutput`.
9. Separate paths: `draft()` `planner.ts:79` (open questions via `AutofillDrafter`), `document()` `planner.ts:196`, live `ScopedAnswerService` `answers.ts:159`.

**Concept enum**: `packages/resume-core/src/autofill/concept.ts:3` `ConceptSchema` = **44 members** (`display_name`...`ambiguous`).

## 2. page-contract / page-projection, model-boundary size

`page-contract.ts` defines the observation shape crossing the boundary. `PageViewSchema` (`page-contract.ts:27`): `roots` (<=40), `nodes` (<=1000 `PageNode`), `coverage`. `PageNodeSchema` (`:10`): ref/rootId/parentRef, tag<=80, role<=100, text<=2000, fieldId, relations<=40. `PAGE_VIEW_LIMITS` (`:4`): nodes 1000, **bytes 49152**, roots 40, contextReads 3. `PageInterpretationSchema` (`:89`): regions<=40, fields<=200, groups<=200, excluded<=200, needsContext<=200 — the schema actually sent to the model in `page-interpreter.ts:172`. Interpreter prompt hard cap is `PAGE_VIEW_LIMITS.bytes * 2` = **98304 bytes** (`page-interpreter.ts:210`), batched by group/field into <=32-field chunks (`:88`). `page-projection.ts:3` `projectPageView` prunes a `PageView` down to only selected fields plus retained ancestors/relations, so only relevant nodes cross the boundary.

## 3. Jev

`jev-decider.ts:66` `createJevDecider(client: TypeSafeClient)` is a **non-LLM statistical decision oracle** (model id literal `"jev-1.13.0"`, `contract.ts:347`) called via `client.systemOne`, returning per-question choice + probability + margin (`validateJevResponse` `jev-decider.ts:27`; probabilities must sum to 1). Gated in `planner.ts` by `policy.enabled && policy.jevEnabled && Date.parse(policy.expiresAt) > now` at `:91` (draft), `:461` (ask), `:521` (interpretation), `:1010`, `:1224`. Adapter sets `jevEnabled: process.env.AUTOFILL_JEV_ENABLED === "true"` (`apps/web/src/server/adapters/autofill.ts:179`); default `reviewPolicy()` has `jevEnabled:false` (`contract.ts:368`). `port.ts` contract: `AutofillDecider`/`DecisionQuestion`/`DecisionAnswer` (`ports.ts:3-22`).

## 4. Browser-independent, reusable pure domain logic

Reusable (pure, no planner coupling):

- `normalize`, `ruleFor`, `blockedField` (rules.ts).
- `factsFor` (facts.ts:16), `supplementalRecordsFor`, `draftFactsFor` (application-data.ts:17,38).
- Answers helpers: `meaningfulAnswer`, `conditionsMatch`, `meaningForField`, `conditionsForField`, `hasRequiredConditions`, `meaningsMatch`, `isRecordConcept` (answers.ts:20-158).
- `isResumeUpload`, `acceptsResumePdf` (upload.ts).
- `projectPageView` (page-projection.ts:3), `validatePageView`, `unresolvedPage`, `reconcilePageInterpretation`, `validateDraft` (interpreter-port.ts).
- `reviewPolicy` (contract.ts:363).

Planner-coupled: `ScopedAnswerService` (answers.ts:159, repository+clock), `AutofillService` (all stages above).

## 5. Types a new Q/A protocol could reuse / must replace

Reusable concepts/data: `Concept`/`ConceptSchema`, `AnswerMeaningSchema` (contract.ts:81), `AnswerConditionsSchema` (:61), `SourceRefSchema` (:37), `ApplicationAnswerSchema` (:93), `ScopedAnswerSchema` (:107), `FactSchema` (:135), `FieldSnapshotSchema` (:186), `DraftInputSchema`/`DraftResponseSchema`/`AutofillDraftSchema` (interpreter-port.ts:256-283), `DecisionQuestion`/`DecisionAnswer` (ports.ts:3-17).

Replace/retire (planner- and scan-centric): `PageViewSchema`/`PageNode`/`PageInterpretation` (page-contract.ts), `FormSnapshotSchema` (contract.ts:216), `PlanInputSchema`/`FillPlanSchema`/`ActionSchema`/`InteractionSchema` (contract.ts), `DecisionSchema` (`FieldDecision`), `AutofillPlanOutputSchema`, `ExecutionReportSchema`, `PolicySchema` (`model: "jev-1.13.0"` literal, `contract.ts:347`).

## 6. Public exports today (hand-curated)

`packages/resume-core/src/index.ts`: `./autofill/contract`, `./autofill/ports`, `./autofill/planner`, `./autofill/answers`, `./autofill/page-contract`, `./autofill/page-projection`, `./autofill/interpreter-port` (plus `./domain`, `./ports`, `./services`, `autofill-profile`). Note `facts.ts`, `rules.ts`, `upload.ts`, `application-data.ts`, `concept.ts` are NOT re-exported directly (reached transitively via contract/planner).

`packages/agent/src/index.ts:30-32`: `createJevDecider`, `createPageInterpreter`, `createAutofillDrafter` only.

## Start here

`packages/resume-core/src/autofill/planner.ts:63` (the orchestrator) and `packages/resume-core/src/autofill/contract.ts` (the full type surface a new protocol must reuse or replace).

**Residual risks / open questions:** 44-member Concept enum is heavily applicant-form-specific; Jev is a hard-coded external model literal embedded in `PolicySchema`; `AutofillService.plan()` mutates `input.snapshot.fields`/`groups` in place (planner.ts:549-560), a side effect any replacement should avoid.
