# Autofill engine recon

## Files Retrieved

1. `apps/extension/src/autofill/background.ts` (52-82 maps+keys, 476-1099 `run`, 1150-1633 listeners)
2. `apps/extension/src/autofill/messages.ts` (18-226 protocol, 320-342 `sendAutofill`)
3. `apps/extension/src/autofill/content.ts` (22-70 bootstrap, 84-186 command handling)
4. `apps/extension/src/autofill/executor.ts` (132-430 execute, 214-240 upload, 500-560 addRecord, 585-698 discover)
5. `apps/extension/src/autofill/scanner.ts` (160-425), `page-reader.ts` (29-360)
6. `apps/extension/src/autofill/registry.ts` (43-465), `button-choice.ts` (1-53)
7. `apps/extension/src/autofill/pdf-background.ts` (21-90), `render-pdf.tsx` (1-34), `pdf-contract.ts`, `offscreen.ts`
8. `packages/resume-core/src/autofill/{contract,concept,page-contract,rules,planner}.ts`

## 1. End-to-end flow

Trigger: user clicks toolbar `chrome.action.onClicked` (`background/widget.ts:22-27`) then panel "Fill current page" (`af.start`). Background owns all run state in module maps (`background.ts:52-58`: `sessions`, `running`, `openings`, `retired`, `resumePages`). `af.start` builds an `AutofillSession` and calls `void run(session)` (background.ts:1430). `run` loops: observe -> plan batches -> execute actions -> discover -> addRecord -> audit (background.ts:605-1098).

Panel never talks to the page directly. The content script injects the panel as a closed-shadow iframe (`content.ts:48-58`) pointing at `panel.html#autofill=<nonce>`. Panel -> background via `chrome.runtime.sendMessage(PanelCommand)`; background -> page via `chrome.tabs.sendMessage(ContentCommand)` (background.ts:481-506). Message types: **PanelCommand** = `af.connect|state|resumes|start|continue|cancel|close|preview|captureAnswer|saveAnswer|draft|profile` (messages.ts:130-224). **ContentCommand** = `af.hello|bootstrap|preview|observe|addRecord|execute|discover|audit|cancel|release` (messages.ts:21-89). Plus signals `af.ready`, `af.userIntervened`, PDF `af.pdf.ready/render`. Separate LinkedIn protocol (`lib/messages.ts`: `state|connect|disconnect|tailor|retry|cancel|edit|apply|open-app`, widget messages, `capture-apply-link`, `resume-page`).

## 2. Module ownership (one line)

- `background.ts`: run state, plan batching, action dispatch, session persistence.
- `content.ts`: page-side command router, panel iframe injection, lifecycle cancels.
- `registry.ts`: element->id map, live `Entry` per field, option reading, mutation observers, per-control adapters (native/aria-combobox/button-choice).
- `scanner.ts`: builds `FormSnapshot` (fields, groups, coverage) from registry.
- `page-reader.ts`: builds bounded `PageView` DOM graph + record "Add" entrypoints.
- `executor.ts`: writes/verifies actions, option discovery, record creation, audit.
- `dom.ts`: shadow/DOM traversal helpers. `button-choice.ts`: yes/no button-pair adapter.
- `pages`: `messages.ts` protocol/Zod; `sites.ts` ATS URL allowlist; `application.ts` application identity;
- `confirmed-answers.ts`, `profile-answer.ts`: answer confirmation + profile mapping.
- `pdf-background.ts`/`offscreen.ts`/`render-pdf.tsx`/`pdf-contract.ts`: PDF render pipeline.

## 3. Persistence

All in `chrome.storage.session` (trusted contexts, `background.ts:1150`):
`autofill:launch:<nonce>` (LaunchSchema 38-48), `autofill:session:<tabId>` (`SessionSchema`, messages.ts:177-260: status, sourceStamp/sourceSnapshot, applicationAnswers, supplementalRecords, savedAnswerIds, drafts, decisions, results, selections, overrides, observation), `autofill:apply:<tabId>` (AssociationSchema), `autofill:auto:<tabId>` (tombstone). `store()` (background.ts:85-102) strips observation/decisions/previews and forces `paused`. In-memory `sessions` map shadow it. Temporary answers = `session.applicationAnswers`/`overrides`/`selections` inside that blob; only `af.saveAnswer`/Profile writes reach the server. Source bundle = `sourceSnapshot` (resume+profile+scopedAnswers+template) fetched via `client.autofill.prepare`. Separate LinkedIn data: `widget:position`, `base:<userId>`, `request:<acct>:<job>:<action>` in `storage.local`.

## 4. PDF build/upload

`background.run` on an `upload_resume` action calls `prepareResumePdf` (pdf-background.ts:21): fetches `autofill.document`, creates `offscreen.html`, sends `af.pdf.render` (pdf-background.ts:68). `offscreen.ts` dynamically imports `render-pdf.tsx`, which renders `@workspace/resume-render` and returns base64 PDF (`ResumePdfSchema`). File reaches the page as `file` on `af.execute`; executor rebuilds a `File` via `DataTransfer` and assigns `el.files` (executor.ts:214-239).

## 5. Site-specific hardcoding

`sites.ts`: 13 ATS URL patterns (Greenhouse/Lever/Ashby/Workday/iCIMS/...) + `isAutofillApplicationUrl`. `registry.ts`: adapter ids `native-v1`/`aria-combobox-v1`/`button-choice-v1` and per-control read/verify logic. `button-choice.ts`: one exact yes/no widget shape (2 buttons, `data-option`, aria-pressed). `scanner.ts`: group kind by regex `/education/`, `/employment|experience|work history/` (175-178) and `[data-autofill-record]` as a generic grouping hint. `page-reader.ts`: "add experience/education" button label regex (312-326). `application.ts`: query-name allowlist (gh_jid, job_id, reqid...).

## 6. Fixed concept/classifier/planner artifacts the new spec kills

`concept.ts`: closed 42-value `ConceptSchema` enum. `rules.ts`: hardcoded label->concept phrase table. `contract.ts`: `DecisionSchema.status` enum, `semanticKey: ConceptSchema`, `FieldSnapshot.capabilities`, `PolicySchema` with `model: "jev-1.13.0"`, `PrepareOutput.availableConcepts/missingConcepts`. `page-contract.ts` `PageInterpretationSchema` requires `concept` per field. `planner.ts` (1388 lines) is the whole-page rules+Jev interpreter/planner the spec replaces. Spec `docs/specs/extension-dom-agent.md` ("closed list ... must not determine", "no mandatory Jev stage", "not recreate the old planner").

## 7. Page observation today

`page-reader.ts:read()` produces `PageView`: flat `nodes[{ref,rootId,parentRef,tag,role,text<=2000,fieldId?,relations[{kind,ref}]}]`, `roots`, `coverage{complete,truncated,unobservedFrames}`, capped 1000 nodes/48KB. Separate `scanner.ts` produces `FormSnapshot` (fields with label/description/section/groupId/constraints/state/capabilities, `groups`, `pageView`, `coverage`). Read driven per-run by `af.observe`; content uses MutationObserver + trusted-event intervention detection (registry.ts:386-470).

## Start Here

`apps/extension/src/autofill/background.ts:476` (`run`) is the orchestration spine; then `messages.ts` for the wire contract.

```acceptance-report
{
  "criteriaSatisfied": [
    {"id": "criterion-1", "status": "satisfied", "evidence": "All 7 questions answered with file:line citations in .scratch/dom-agent/recon-engine.md"}
  ],
  "changedFiles": [".scratch/dom-agent/recon-engine.md"],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command": "grep/wc over apps/extension/src/autofill, background, content, packages/resume-core", "result": "passed", "summary": "mapped 7k LOC across ~25 files"},
    {"command": "read key modules", "result": "passed", "summary": "background.ts, messages.ts, executor.ts, scanner.ts, registry.ts, page-reader.ts, content.ts, pdf pipeline, contracts"}
  ],
  "validationOutput": ["Findings cross-checked against docs/specs/extension-dom-agent.md for what the new design replaces"],
  "residualRisks": [
    "Panel.tsx/ReviewItem.tsx read only partially; they are UI over PanelCommand, not engine logic",
    "packages/resume-core/autofill/planner.ts (1388 lines) summarized from imports/head, not fully read"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added recon brief at .scratch/dom-agent/recon-engine.md",
  "reviewFindings": ["no blockers"],
  "manualNotes": "Two distinct protocols coexist: autofill panel protocol (autofill/messages.ts) and LinkedIn widget protocol (lib/messages.ts + background/messages.ts). The brief covers both but centers on autofill."
}
```
