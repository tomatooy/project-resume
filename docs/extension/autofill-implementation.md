# Extension autofill implementation and release checklist

The implementation started from [the v1 spec](../specs/extension-autofill.md). The September 28, 2026 user request changes the runtime workflow to automatic filling and resume PDF attachment after one **Fill current page** click. This supersedes the original per-field confirmation and manual-upload scope. Saved EEO definitions are limited to the United States (`vs-us-1`). Existing resumes remain independent of Profile data.

## Delivered implementation

| Milestone | Implementation | Verification |
| --- | --- | --- |
| M1 | Account Profile, seven-section workspace editor, CAS revisions, authenticated API, versioned facts, scoped scanning, native controls, trusted panel registration, source stamps, sequential execution | Core, API, Profile editor, DOM, database and adapter tests |
| M2 | Pinned Jev adapter, dependent semantic/record/option decisions, bounded retries, quota reservation, review choices, local replacement preview, session overrides, in-page recovery | Model response, cancellation, API privacy and worker session tests |
| M3 | Capability-based ARIA controls, associated portals, open shadow roots, query attribution, virtual-list budgets, multiselect validation, dependency barriers, main-document targeting | Synthetic DOM tests and manual acceptance checklist below |
| M4 | Atomic quotas, expiring execution policy, global/model/adapter switches, content-free counts, opt-in evaluation runner | Database checks, policy tests and release evidence still required below |

No site-specific adapters are enabled. A hostname alone never establishes support. Unsupported or unobservable controls remain manual.

The work is ordered from schema and storage, through the planning service and model adapter, to Profile UI and browser execution, then adversarial fixtures and release controls. The original spec and early design notes remain available as design history.

## Configuration

Apply `supabase/migrations/20260926120000_autofill.sql` using the normal migration workflow. This migration has been applied to the local test stack, not production.

Server configuration:

- `AUTOFILL_ENABLED=true` enables filling. The default is disabled.
- `AUTOFILL_JEV_ENABLED=true` permits bounded Jev calls. The default is false.
- `TYPESAFE_API_KEY` remains server-only. No evaluation or production model calls were made during implementation.
- `AUTOFILL_POLICY` optionally supplies a JSON policy validated by `PolicySchema`. It carries `version`, `enabled`, `jevEnabled`, pinned `model`, `autoRules`, `autoModel`, and `disabledAdapters`. The server issues a fresh 60-second expiry. Invalid configuration disables execution. Increment the policy version whenever changing a category or switch.
- The extension requests `automation: "automatic"`. Exact rule matches execute directly; model choices need probability at least 0.95 and margin at least 0.15, without ties. These are conservative implementation thresholds, not measured precision. Global, model and adapter switches still apply.
- Legacy callers that omit `automation` retain the review workflow and evaluated `autoRules` / `autoModel` allowlists. Keep those allowlists empty until their categories have independent evaluation evidence. Automatic mode does not depend on those allowlists for its default confidence gates.

The extension adds `activeTab`, `scripting`, `alarms`, and `offscreen`, with declared site access for the application domains below. Other HTTPS pages can open Autofill through a toolbar click using temporary `activeTab` access. Alarms clean up expired session storage even after worker suspension; expiry is also checked before use. Chrome may delay cleanup alarms during sleep. The implementation does not use alarm features introduced after Chrome 127. The extension CSP allows the bundled PDF renderer's WebAssembly; it does not permit remote scripts.

The content script is a separate, self-contained IIFE emitted as `autofill-content.js` by the existing extension Vite configuration. A build was not run, per repository instructions.

### Automatic application-site panel

The in-page Autofill side panel opens automatically once per top-level document on these HTTPS entry points:

| Site family | Hostnames |
| --- | --- |
| Greenhouse | `boards.greenhouse.io`, `job-boards.greenhouse.io`, `boards.eu.greenhouse.io`, `job-boards.eu.greenhouse.io` |
| Lever | `jobs.lever.co`, `jobs.eu.lever.co` |
| Ashby | `jobs.ashbyhq.com` |
| Workday | Subdomains of `myworkdayjobs.com` |
| iCIMS | `careers.icims.com`, `jobs.icims.com`, and `careers-*` / `jobs-*` subdomains of `icims.com` |
| SmartRecruiters | `jobs.smartrecruiters.com`, `careers.smartrecruiters.com` |
| Workable | `apply.workable.com` |
| Jobvite | `jobs.jobvite.com` |

`apps/extension/src/autofill/sites.ts` owns the entry-point allowlist. Tests keep its match patterns aligned with the manifest and reject lookalike domains, account/admin hosts, non-HTTPS URLs and nested frames. These are panel entry points, not site-specific control adapters or evidence of form compatibility.

Opening the panel does not scan a form, prepare a source, call Jev, or execute actions. The user clicks **Fill current page** to begin. Close remains effective for that document across worker restarts; the toolbar can explicitly reopen it. A new document can open a fresh panel. The per-tab dismissal marker contains only a document id and is removed when the tab closes. Autofill stays in the application page. Automatic entry, toolbar entry and Retry never launch a fallback window. Slow panel registration can retry in place until the launch expires. Fill targets the main document of the bound application tab without a frame picker. Switching tabs or windows pauses execution and does not refocus the application automatically.

Panel registration validates the extension sender, private launch nonce, tab, panel document and frame identities, and the current application document. It checks the HTTPS host document because Chrome does not expose extension iframe URLs through `webNavigation.getFrame`. Navigation or a different panel identity invalidates the registration. Account, service and session failures have distinct fixed recovery messages without forwarding upstream error contents.

After rebuilding and reloading the extension manually, grant the declared site access and reload an application page. Chrome's [static content-script matching](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) supplies the initial entry point without requiring a toolbar click. Custom company domains remain available through the toolbar.

### One-click filling and resume attachment

Fill chooses the sole application form, or the sole form with a recognizable Resume/CV upload control. Only ambiguous form targets need selection. Saved facts, confident record bindings and confident option matches proceed without individual confirmation. Missing or uncertain answers remain visible for optional correction, while other supported fields continue. Record bindings stay consistent within a run across rescans. Existing user input and attachments are preserved.

Application tab panels with an accessible Application/Apply label are also recognized when the site has no native form element. The supplied Ashby capture is reduced to a fixture without applicant data. Its Yes/No buttons use `aria-pressed` and `data-option`, with a hidden checkbox linked to the question by name. The capability-based `button-choice-v1` adapter resolves that local relationship, clicks the observed option, and verifies the pressed state. It preserves an existing No, rejects changed labels/options, and refuses buttons that could submit an associated form. Hostnames are not used to authorize this adapter.

The exact US work-authorization question uses the saved US authorization answer directly. The supported combined sponsorship question uses `sponsorship_now_or_future`, derived from the two saved answers in that country: either Yes produces Yes; both No produce No; other combinations remain unknown. A combined answer is never reused for a current-only or future-only question. These exact matches need neither a Jev call nor individual confirmation.

`POST /api/v1/autofill/document` returns only the authenticated, source-stamped resume and its template settings with `private, no-store`. A hidden offscreen document uses the existing `resume-render` package to generate the selected resume as a PDF. No new visible window opens. The worker checks the source again before execution and sends a bounded PDF payload only with its upload action. PDF bytes stay in memory and are never saved to extension storage.

Attachment supports identifiable native Resume/CV file inputs, including hidden inputs with visible associated labels, that accept PDF files. The limit is 5 MiB. Directory inputs, document-only formats, unrelated attachments and unsupported drop zones remain manual. The executor validates the PDF signature, size, digest, source stamp and current target, then dispatches input/change events and reads the resulting file selection. A successful result means the file was attached to the control; it does not prove the site's server accepted or processed it. The page is rescanned afterward so existing ATS-populated values are preserved. Cancellation prevents pending attachment, and PDF failures leave other supported fields available to fill.

## Capability limits

Native controls use actual observed options and native setters, followed by stable control readback. ARIA controls require a uniquely associated listbox. Searchable controls additionally need observable loading and matching `data-query` evidence; generic loading transitions alone are insufficient to prove which response arrived. Unknown site widgets are reported for manual attention.

Virtual discovery is bounded to five scroll pages and three searches. Recycled nodes get fresh option identities. A missing item in partial results is never described as absent from the full list. A field that cannot prove committed selection is unverified.

HTTP batching keeps each dependent record group and its review choices together. An individual group over the 256 KiB budget pauses for manual attention. Embedded forms remain manual in the current main-document workflow; the panel reports unscanned embedded or custom content. Closing the panel waits for cancellation acknowledgement; reopening it invalidates earlier panel registrations.

Automatic mode uses saved sensitive answers only when the existing country and definition checks pass. Saved EEO reuse requires US scope and matching question wording without additional descriptions; these answers never go to Jev. Different definitions or descriptions require a session-specific answer or manual entry. General veteran and protected-veteran facts remain distinct. Legacy review mode still requires confirmation for sensitive answers.

No scripts, arbitrary selectors, navigation, submission, CAPTCHA handling, record creation, signatures, declarations, or open-ended drafting are part of the action protocol. Resume PDF attachment is the only supported upload action.

## Automated coverage map

Synthetic tests exercise these acceptance areas. This table does not claim live ATS certification.

| Acceptance cases | Test locations / checks |
| --- | --- |
| AC-01, 02, 04, 05, 06 | `packages/resume-core/test/autofill.test.ts`, fact ownership and exact rules |
| AC-03, 07, 09, 10, 13, 16, 19 | `apps/extension/test/autofill-dom.test.ts`, guarded writes and readback |
| AC-08, 11, 12, 15, 17 | Core option/binding tests, DOM option reuse and query tests; live widget behavior requires manual acceptance |
| AC-14, 21, 22, 23, 25 | `apps/extension/test/autofill-session.test.ts`, document binding and scoped scanner; embedded frames and closed roots remain manual |
| AC-18, 24, 27, 28 | Strict action/message contracts, `packages/agent/test/autofill.test.ts`, API privacy and body-size tests |
| AC-20, 26, 31, 32, 33, 34, 35, 36, 40 | Core source-stamp, explicit fact, EEO isolation and scope tests |
| AC-29, 30, 37, 38, 39 | Profile editor tests, API tests, `supabase/tests/100_autofill.test.sql`, adapter integration checks, keyed workspace lifecycle |
| September 28 automatic workflow | Core automatic semantics/record/option tests, extension worker upload-to-fill test, `autofill-pdf-render.test.ts`, `autofill-pdf-background.test.ts`, DOM attachment/cancellation/rejection fixtures, API document privacy test |
| Captured Yes/No controls | `test/fixtures/ashby-application.html`, `autofill-button-choice.test.ts`, nine sponsorship combinations and country/question-scope checks in core |

## Verification results

Typecheck and Biome lint pass. The core suite passes 216 tests, the extension suite passes 178, shared API contracts pass 3, and the web API suite passes 16. The two extension tests that timed out during a parallel run passed on a serial rerun (41 tests). These include captured Yes/No button controls, sponsorship derivation, automatic filling, real PDF generation, upload readback/cancellation/rejection, source conflicts, request budgets, panel registration and dynamic options. Earlier focused Profile/editor/workspace checks and the Jev adapter tests also pass without provider calls. The local database suite passes 185 checks, and the real Supabase adapter checks pass, including concurrent Profile updates and account isolation; this automatic-upload change requires no additional database migration.

The full repository suite still encounters existing failures in `packages/agent/test/models.test.ts` (smart-tier thinking expectation) and two expectations in `apps/web/src/lib/word-diff.test.tsx` (old highlight class). The existing PDF worker import test also exceeded its five-second timeout under parallel load and passed when rerun alone. These unrelated implementations and expectations were preserved.

## Opt-in model evaluation

Run only with synthetic or explicitly approved captures:

```sh
AUTOFILL_EVAL_OPT_IN=1 bun packages/agent/scripts/evaluate-autofill.ts /absolute/path/to/approved-fixtures.json
```

`TYPESAFE_API_KEY` must already be in the environment. The script refuses to run without the opt-in and approved fixtures. It prints aggregated decision metrics, attempt counts, P50/P95 latency and Wilson 95% precision intervals. It never changes production policy or prints fixture state. Its thresholds are trial thresholds, not calibrated production defaults.

Fixture rows follow `FixtureSchema` in the runner: a non-sensitive id, explicit approval, synthetic/approved source, stratum, language, adapter id, bounded decision question, expected candidate id, and whether that decision is eligible for an automatic-category trial. Include `no_match` and `ambiguous` negative cases. The runner evaluates decision accuracy; DOM readback, unsafe execution and page completion must be measured separately in the manual matrix.

Before release, record at least 500 annotated decisions, including 100 dropdown/multiselect cases and 100 missing/ambiguous/negative/dynamic-failure cases. Report per-category sample counts and confidence intervals. Do not describe the requested automatic mode or its confidence thresholds as evaluated until this evidence exists. Keep the legacy category allowlists empty for categories without evidence. Record real provider token usage and cost from the approved evaluation account without storing prompts in product logs.

## Manual checks

1. Open `/autofill-profile` from the account menu, including with no resumes. Edit and explicitly save each section. Clear an EEO answer, close a dirty Profile tab, and test Save, Discard and Cancel. Edit the same Profile in two tabs and confirm the stale save preserves the draft and requires reconciliation.
2. Import a supported LinkedIn/GitHub link from a resume. Check the preview before saving. Confirm Profile data does not appear in resume JSON, PDF, duplication, versions, or chat.
3. Open a recognized application domain directly or through Go apply. Its in-page side panel should appear automatically, with the returned resume preselected when applicable, but no scan occurs before Fill current page. Close it and check that it remains dismissed on that document, including after a worker restart. The toolbar explicitly reopens it. A lookalike or custom domain must not auto-open. With multiple forms, the sole recognizable resume form should be selected automatically; ambiguous targets still need selection.
4. Click Fill current page once. Exact saved answers, confident model matches and the selected resume PDF should proceed without Verify clicks. Check preserved input, existing attachments, missing facts, consistent record binding, scoped EEO reuse and optional replacement preview. Confirm that control readback produces filled/attached results and that the final Submit button remains untouched. Try a PDF-rejecting control and an unrelated cover-letter upload; neither should receive the resume.
5. Exercise native selects, radios, checkboxes, date/month controls, a supported ARIA listbox, query results arriving out of order, a virtual list, and dependent country/state fields. Inaccessible frames and unsupported widgets must remain visibly uncovered or manual.
6. Press Stop or Close while planning, rendering a PDF and during a control step. Pending PDF work must not attach after cancellation. Switch tabs, revoke a granted origin, change accounts, navigate, suspend/restart the worker, and drop a response. Confirm no blind action replay and that continuation requires a fresh observation. Lost Stop acknowledgements must remain Stopping until acknowledgement or document destruction.
7. Check that the panel has no Application frame picker. Fill current page targets the open application page. Exercise Retry after a connection failure and a slow panel load; it must stay in the same panel with no new window. Block embedding and verify that no fallback window opens. Switch to another tab or window during startup and confirm execution pauses without stealing focus.
8. Save US work-authorization and sponsorship answers in Profile. On the captured Ashby form, click Fill current page. The authorization and combined sponsorship Yes/No buttons should select the saved/derived answers directly. A previously selected No must remain selected. An unknown sponsorship combination must stay unanswered.

| ATS family | Date / form configuration | Adapter / capabilities | Uncovered controls | Result |
| --- | --- | --- | --- | --- |
| Greenhouse | Pending approved manual capture | Pending | Pending | Not accepted |
| Lever | Pending approved manual capture | Pending | Pending | Not accepted |
| Ashby | September 28 user-provided DOM, sanitized fixture | `button-choice-v1`, labeled application panel | Live upload/custom-widget coverage pending | Fixture tested; live acceptance pending |
| Workday | Pending approved manual capture | Pending | Pending | Not accepted |

Release remains gated on this matrix, zero unsafe executions, measured accuracy/latency/cost, and confirmation of TypeSafe account retention and data-region settings. No browser automation or live application submission was used for verification.
