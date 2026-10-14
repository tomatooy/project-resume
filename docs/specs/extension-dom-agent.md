# Extension DOM agent

Status: confirmed. Product decisions settled and implementation decisions
confirmed on 2026-10-13.
Date: 2026-10-13.

This specification replaces the autofill orchestration design in
`extension-autofill.md`, `universal-autofill.md`, and the Jev design when
confirmed. It does not describe the current implementation or authorize a
release. Existing account data and unrelated extension features remain intact.

## Confirmed implementation decisions

Resolved 2026-10-13. Terminology is fixed in `CONTEXT.md`; two of these are
recorded as ADRs.

| Decision | Resolution |
| --- | --- |
| Driver | The debugger protocol observes. A bundled runtime injected into the page's main world acts, exposing a fixed verb list and never accepting model-authored code. Uploads and writes share one adapter because `DOM.setFileInputFiles` cannot carry in-memory bytes and React needs main-world setters. See `docs/adr/0002-hybrid-dom-driver.md`. |
| Question identity | A deterministic key over normalized wording, kind, explicit scope and option signature. Never model-authored, never a browser reference. See `docs/adr/0001-question-identity.md`. |
| Question list | The driver enumerates candidate questions deterministically, with stable order and count. The model interprets meaning, binds facts and selects observed options. It cannot add, drop or hide a question. |
| Reasoning | A new minimal loop in `packages/agent` behind a port declared in `packages/resume-core`. Tools are bounded reads and option discovery only. Budgets are enforced by the executor, never trusted to the model. The chat assistant's run loop is not reused: its patch authority does not belong on this path. |
| EEO | Excluded from the source bundle outright. A confirmed EEO answer stays the user's own and no EEO question is answered from a source, whether by defaulting or from a stored answer. Decided 2026-10-14, over the reading that a confirmed Profile response was an eligible fact. |
| Application identity | Extracted deterministically from host, path and a query-name allowlist. An empty result means unknown, so the run starts fresh and the panel says why. Never inferred from hostname alone. |
| Temporary state | `chrome.storage.session`, keyed by account, tab and application identity together. |
| Telemetry | Timings and counts only, in a bounded local ring buffer with a dev-only readout. Nothing leaves the machine. |
| Panel | The frame, dock behaviour and progress affordances are kept. Everything speaking the retired protocol is rebuilt, and the concept-shaped answer grid is deleted. |
| Distribution | No build is distributed outside the developer's machine. The API contract is reshaped in place, so no additive compatibility work or permission-rollout handling is needed. |
| Replacement | The engine is replaced in place, file by file. Intermediate states leave the extension loadable and the LinkedIn path working, with the fill action refusing explicitly. |
| Chrome facts | The `debugger` permission cannot be optional. An attached session keeps the MV3 worker alive (Chrome 118+, minimum here is 127). Offscreen documents expose only `runtime`, so the debugger client cannot live in the document that renders the PDF. |
| Test lane | A fixture recorder dumps the DOM and accessibility tree per page. The user runs it against the acceptance ATS pages and the fixtures replay offline, because agent-driven browser automation is not permitted in this repository. |

## Confirmed boundary

- Operate in the user's current Chrome tab through the extension.
- Declare the required `debugger` permission and use CDP to read real browser
  accessibility information together with live DOM information.
- Fill and verify the current application page. The user changes pages and
  submits the application. Never click Next, Back, Submit, or equivalent controls.
- Redesign observation, reasoning, and orchestration without inheriting the
  existing fixed concept classification and repeated whole-page planning chain.
- The resume remains immutable to this feature. Reading it and attaching a PDF
  do not authorize edits to it.
- Build a general engine. Initial release acceptance covers current-page forms
  on Ashby, Greenhouse, and Lever. Other ATS pages may be attempted, with visible
  unsupported and unverified results, without claiming verified site support.
- Eligible sources are the selected resume, the user's confirmed Profile,
  explicit answers for this application, and applicable answers the user
  explicitly saved for reuse. Never merge other resumes. A source conflict
  requires a user choice; Profile does not silently override a resume.
- Preserve page values and existing attachments. Only a specific reviewed user
  choice authorizes replacement. Finding a conflict does not authorize a write.
- Do not generate new prose answers. Open questions use an applicable existing
  confirmed answer or ask the user. There is no draft-generation step in v1.
- Add observed blank experience/education record groups when needed, using
  records from the selected resume and explicitly supplied application facts.
  Do not delete records, merge different records, or invent missing history.
- Answers are temporary within the same application/tab unless the user
  separately chooses to save them to Profile or the reusable-answer library.
- Switching away from the application tab does not itself pause a run. Work
  remains confined to that tab. A control requiring focus waits for the user to
  return; the extension never steals focus or types into another tab.
- Collect missing required answers together. Optional questions with no answer
  remain blank and can be completed from the results panel, without blocking.

## User flow

1. The user opens the extension on an application page, selects or confirms a
   resume, and clicks Fill current page. Opening a panel alone does not start
   page inspection or debugger attachment.
2. Load and pin sources while attaching to the target tab and observing the
   application. Prepare its PDF concurrently once the source is fixed.
3. Understand the current questions and resolve answers from eligible sources.
   Start unambiguous independent work while collecting missing information.
4. Attach the resume to the actual resume field and observe any resulting ATS
   autofill before filling affected fields. Unrelated work can proceed. Do not
   invoke a separate resume-autofill import widget in v1. Existing attachments
   remain untouched unless the user specifically chooses replacement.
5. Fill supported controls, explore relevant dynamic options, and add required
   record groups. Show verified progress, not just dispatched action counts.
6. Present required missing answers and conflicts in one review queue. Show the
   original question, options/format, and relevant source conflict or missing
   evidence. Do not make the user select internal concepts or record IDs.
7. Fill confirmed answers resumes against a fresh observation. Answers may
   reveal more required questions, which join the queue. Optional missing items
   remain visible but do not require a reply. No answer is generated for them.
8. Audit the whole current application page and report either ready for user
   review or the exact remaining issues. The user navigates or submits.

The panel exposes progress, Pause/Continue, Cancel, and the review queue. A user
can submit several answers in one action. Persistent saving is a separate
choice from confirming an answer for the current application.

## Application lifetime and interruption

Keep source bundles and temporary answers in trusted extension session storage,
scoped to account, tab, and confirmed application identity. Manual navigation
within the same identifiable application may retain facts and answers; every
page needs a new explicit Fill action and new browser references. Different or
unknown application identity starts fresh. Never reuse data merely because the
hostname is unchanged. Closing the tab or signing out clears its temporary
state. Browser restart begins a new temporary session.

Pause before further actions when the user edits the target application form,
explicitly pauses, navigates, or debugger access is interrupted. A sidebar answer
is an input to the review flow, not an unrelated page edit. Switching to another
tab/window alone is allowed. Background work must use target-bound operations;
if a widget cannot be operated without focus, defer it and continue independent
work before reporting that the user must return.

Continue observes the page and validates existing receipts before proposing new
actions. It does not replay a suspended plan. Cancellation stops further work
and preserves values already written; it does not promise transactional rollback.
Service-worker restart follows the same fresh-observation recovery rule.

Persist source bundles once and checkpoint action intents/results at batch
boundaries. Persist record-creation and upload intents before dispatching the
action, not just after the batch finishes. These intents must survive a lost
response: after recovery inspect the actual page before retrying, avoiding
duplicate records or attachments. Uncertain outcomes remain explicit.

| Run state | Meaning |
| --- | --- |
| observing | Acquiring current browser evidence and sources |
| running | Reasoning, discovering options, or executing verified actions |
| needs_input | Independent work finished; required answers or conflicts remain |
| paused | User intervention, focus-dependent work, or lost browser connection |
| auditing | Checking the entire currently observed application |
| ready | Audit complete with no unresolved required or potentially required issue |
| incomplete | Unsupported, unverified, or uncovered content prevents readiness |
| cancelled | User stopped further actions |

An optional field deliberately left blank does not block ready. A failed write,
unknown requiredness of an unresolved question, unresolved conflict, or an
unobserved potential application region does. The number of writes completed
must never be used as a substitute for this readiness decision.

## Core vocabulary

| Term | Meaning |
| --- | --- |
| Application | One identifiable application in one browser tab; may contain several pages the user visits manually |
| Page run | An explicit request to fill and verify the current page |
| Observation | DOM structure, live control properties, AX semantics, relationships, errors, and explicit coverage gaps |
| Question | The actual prompt, description, choices, constraints, and record context of an observed field or field group |
| Fact | Applicant information with a source reference and relevant scope; absence is not a negative answer |
| Answer proposal | A question-specific value derived from cited facts or supplied by the user |
| Receipt | Observed outcome of a particular action, including whether the widget accepted it |
| Page audit | A fresh check of completeness, consistency, coverage, and validation across the current application page |

## Observation

Start with a bounded page overview to locate application regions. Enumerate
candidate controls before semantic classification, including hidden file inputs
associated with a visible upload interaction. Then read application regions and
their related labels, instructions, errors, and option portals in detail.

Maintain live DOM references and browser AX references within their document and
frame lifetime. Join them by browser node identity when available. Accessible
names are not unique identifiers. A navigation, frame replacement, or replaced
element invalidates affected action references.

DOM supplies structure, constraints, relevant attributes, file inputs, and live
properties such as value and checked state. AX supplies computed names, roles,
and exposed states. Preserve original question text and descriptions alongside
computed names. The two channels are complementary, not independent votes that
must always agree. An AX omission does not erase a DOM-observed upload input.

Requiredness is `required`, `optional`, or `unknown`, with supporting evidence.
Read native and ARIA constraints, group requirements, and visible instructions
or required markers. An absent attribute alone does not establish optionality.
Generated CSS class names are evidence within a page, not permanent selectors.

Observe frames and available shadow content through the relevant browser
contexts. Mark inaccessible or unsupported regions explicitly. Truncation and
missing context must not silently remove questions from the completeness count.
Request a bounded local DOM fragment when the compact view loses needed detail.

Exclude extension UI, authentication fields, cookies, tokens, and unrelated page
regions from model context. Page text is untrusted data, never agent authority.
Do not expose a general arbitrary-JavaScript execution tool to the model.

### Browser session and coverage

Retain the extension's current minimum Chrome version of 127. At startup, probe
the required DOM and Accessibility capabilities; experimental protocol support
is not assumed merely because debugger attachment succeeds. If real AX access
is unavailable, report the limitation and leave filling paused. Do not silently
switch to the old scanner while presenting the same capability.

Track target sessions, frame identity, execution contexts, and a local document
generation separately. Same-process frames may share a target; out-of-process
frames require child sessions and recursive attachment. Never join nodes across
contexts by numeric identifier or accessible text alone.

On detach, navigation, document replacement, or execution-context destruction,
cancel dependent in-flight work and invalidate the affected node references,
option references, remote objects, and pending actions. Keep eligible applicant
facts separately from these ephemeral browser identities. Resuming always
reattaches as needed and observes the current page before further writes.

Enable accessibility observation only while needed by a run. Release protocol
resources on completion, cancellation, or pause that needs user input. Attach
again and rebuild references on Continue. AX update events supplement DOM
observation; they cannot alone establish that no new field has appeared.

## Applicant sources

An authenticated source-loading service returns the selected resume or version,
Profile, eligible explicitly saved answers, and the chosen PDF rendering
configuration. It checks resume access and version ownership, and fixes a source
bundle for the application. A later edit in the main app does not change that
bundle during the current application. A user-requested source change starts a
new run and re-evaluates existing answers without silently overwriting them.

Source loading is independent of the old planner, field snapshots, concept
enumeration, Jev configuration, and available/missing-concept lists. The new
agent receives structured facts with source references. It does not consume
`factsFor` string values as its sole representation of applicant information.

Profile remains an independent account-level document. Preserve unknown versus
explicit yes/no, and unanswered versus answered versus decline. Maintain work
authorization country scope and structured salary amount, currency, and period.
Fact meaning, display text, and the value written into a control are distinct.

Previously saved answers are eligible only when the user explicitly saved them
for reuse and their meaning and scope match this question. Preserve original
question wording, negation, country, employer, time, currency/period, and record
identity where relevant. Similar wording alone is insufficient. Unknown reuse
conditions are not wildcards. Multiple conflicting matches require resolution.
An existing saved-answer concept can be read through a compatibility adapter;
it must not constrain the new question/answer protocol to the old enumeration.

Saving to Profile requires a real matching Profile field and the user's explicit
choice. Other confirmed answers are saved with their question identity and
explicit reuse conditions. The default, only this application, means a temporary
answer with no persistent write. Saving a reusable answer requires an explicit
scope, such as a known employer/job or country and question meaning; unknown
scope prevents saving for reuse. Experience/education supplements stay in this
application and never become edits to the selected resume.

For the exact question and scope, an explicit user resolution for this
application can settle conflicting candidates. Otherwise conflicting source
values are shown together for resolution. A question-specific answer does not
silently become a universal fact about the applicant.

Reuse existing authenticated APIs, Supabase ownership/RLS, and optimistic
concurrency for any persistent writes. A client-provided source hash is an
integrity/version identifier, not a server signature or an authorization grant.
Keep entire source bundles in trusted extension/server contexts. A page receives
only the values required for an action and its authorized attachment.

Identify source bundles using all contributing source versions/content, including
saved-answer changes. Identify PDFs using resume content, template, options,
locale if relevant, and rendering/font asset version. The old SourceStamp alone
does not cover all of these inputs and is insufficient as a PDF cache key.

## Modules and narrow interfaces

| Module | Responsibility | Boundary |
| --- | --- | --- |
| Source service | Load and fix applicant data; return source evidence | Authenticated server service, no browser state or model call. It replaces the existing prepare operation in place; the planner, draft and policy operations it sat beside are deleted rather than versioned, because no build is distributed |
| Browser driver | Observe DOM/AX, resolve live refs, discover options, execute allowed actions | Extension-only CDP and bounded upload adapter |
| Reasoner | Interpret questions, match sources/options, request missing context, propose answers | Model work in agent package, no direct browser/API authority |
| Run coordinator | Schedule independent work, handle dependencies, limits, user intervention, and checkpoints | Extension owns the current application/run state |
| Verifier | Produce action receipts and final page audit | Deterministic live checks plus explicit semantic conflicts |
| Review panel | Present missing questions, conflicts, progress, and results | User decisions are explicit inputs to the coordinator |

Keep source loading, page observation, bounded interaction, batch execution, and
page audit as distinct small interfaces. Do not recreate the old planner behind
one large replacement service. Browser-independent contracts use Zod; types are
derived from schemas. Browser node handles never become persistent answer IDs.

The shared protocol represents: observation/version and coverage; question and
evidence refs; source bundle and fact refs; answer proposals and transformations;
typed action batches with current-value preconditions; per-action receipts;
and audit/review issues. Each candidate question must have an accounted-for
disposition. Model omissions and truncated output remain unresolved.

Allowed interactions are bounded reads, option discovery/querying, text entry,
single/multiple choice selection, file attachment, and observed non-submitting
record creation. A generic click/keyboard tool must not bypass these action
types. Legal agreement/consent, signature, authentication, payment, CAPTCHA,
navigation, and submission remain manual. New narrative drafting is excluded.

## Reasoning and execution

The reasoning step understands questions, binds source evidence, and proposes
typed answers and observed option selections together. It can request more
context or option discovery. Common deterministic matches may bypass model
reasoning once the application region and unambiguous field meaning are known.

A closed list of profile concepts must not determine which questions can be
represented. Company-specific yes/no questions, notice periods, referral
channels, and questions not previously seen retain their original wording and
scope. Unknown facts become requests for information, not invented values.

The model proposes actions using observed references. A deterministic gate
checks the current target, cited sources, allowed operation, preconditions,
format, and option identities. A source reference proves provenance, not that
every semantic inference is valid. Unsupported or conflicting inferences remain
unresolved even when the model reports high confidence.

Automatic answers must copy an eligible value, apply an explicit lossless format
conversion, or select an observed option with equivalent meaning. Preserve the
source refs and the transformation separately. Unsupported factual inference is
not an allowed conversion. User-confirmed question-specific answers can resolve
cases that cannot be derived under those rules.

The extension owns execution and verified progress. The server provides model
reasoning and authenticated data access. Browser APIs remain in the extension;
AI SDK code remains in `packages/agent`; browser-independent contracts and
source/answer rules remain in `packages/resume-core`; API adapters remain in the
existing web data layer. No new service is required by this design.

Reasoning runs as a new, minimal loop in `packages/agent`, reached through a port
declared in `packages/resume-core` alongside the existing interpreter port
pattern. Its tools are bounded reads and option discovery only, and the executor
enforces the budget, so no amount of model-reported confidence can exceed a cap.
It does not reuse the chat assistant's run loop.

Use one configurable model integration through the existing Models abstraction.
There is no mandatory Jev stage. Start with the existing configured fast model
and evaluate it against the grounded-answer acceptance cases; changing a model
does not change the browser contract or introduce another classification pass.
Reasoning requests can use targeted follow-ups for newly discovered evidence.

Before every action validate the document/frame generation, question/option
revision, source-bundle identity, expected current value, and user-edit epoch.
Replaced controls must be resolved from a fresh observation, not through a
stale selector or a newly recycled DOM ID. The reasoning layer cannot bypass
these preconditions by labeling an answer confident.

Batch independent actions in the browser, with a precondition check and receipt
for every action. Observe after actual dependency changes, record creation,
upload parsing, and dynamic option discovery. Replan affected questions and new
controls instead of reinterpreting the whole page after every selection.

Execution has bounded active work. Initial configurable limits are 120 seconds
per page run excluding human waiting, 30 seconds per reasoning request, 8 seconds
per control interaction, and 30 seconds per upload/render operation. Allow one
initial action and at most two corrective attempts per failed control. Require
new evidence or a different justified correction before a retry. Limit reasoning
to six rounds and unresolved context expansion to three reads per question.
Exhaustion reports remaining issues and offers Continue; it never claims ready.
Successful independent writes do not consume correction or model-round budgets.
Limits are resource ceilings, not promised completion times.

Record expansion binds each group to one source record by available evidence.
Use source records matching the question's requested history. If the page asks
for a broader history than the chosen resume provides, ask for the missing facts.
Do not assume a tailored resume is a complete employment history. Observe and
bind a newly added blank group before another add action. Do not combine two
jobs, duplicate a matched record, or guess a record assignment from position
when existing contents make the match ambiguous.

## Answer correctness

- A resume omitting an employer does not establish that the applicant never
  worked there.
- A given name does not establish a preferred name.
- Optional demographic questions remain unanswered without an applicable
  explicit user answer or preference. Do not automatically choose decline.
- URL tracking can explain link attribution, but does not establish how the
  person actually learned about the job.
- Work authorization and sponsorship answers preserve country and time scope.
- Salary facts preserve amount, currency, and period separately. The control
  receives the required numeric representation, not a display string.
- Search text in a combobox is not a committed selection.
- New information may conflict with earlier answers. An address and residence
  city must be checked together when the questions refer to the same address.
- Missing required open-text answers are requested from the user; optional
  ones remain blank and may be supplemented. The agent does not generate
  motivation, cover-letter, or other new narrative answers or silently rewrite
  an existing answer to fit a different question or length constraint.

## Verification

Each action distinguishes dispatch, accepted control state, and unresolved
verification. A successful click or input command is not a successful receipt.
Use live properties and observed widget state rather than HTML serialization
alone. Detect late rejection and framework reversion.

For uploads, FileList assignment is only the local handoff. Look for the ATS
attachment state and settled upload/error indicators. An unobservable upload
completion remains unverified. The resume attachment and a separate autofill
import area are distinct targets.

Render a PDF from the pinned resume and configuration without re-parsing it for
facts. CDP `DOM.setFileInputFiles` accepts filesystem paths, not in-memory PDF
bytes. Use a bounded upload adapter to construct a File/FileList for the resolved
input from authorized bytes, validate type/size/integrity, dispatch the required
events, and then verify the ATS outcome. Do not invent a local path or grant the
model arbitrary file access. This adapter runs in the page's main world and
receives only the resolved input's bytes; the extension keeps the bundle. If a site rejects this upload route, keep the
attachment unresolved and offer manual upload while other fields proceed.

A final page audit inventories all current questions, including untouched
values and questions revealed during execution. It checks required fields,
committed selections, attachments, validation errors, evidence coverage, and
cross-field consistency. It does not submit the form to provoke validation.

A preserved pre-existing value may satisfy a field when its committed state and
validation are observable and no actual conflict is found. It does not need a
second copy in Profile/resume to be counted as filled, and it does not become a
reusable applicant fact automatically. Unknown committed state, an observed
error, or a real source/cross-field conflict remains an issue.

The report distinguishes verified fills, preserved values, missing information,
conflicts, failed controls, unverified results, and unobserved regions. Only a
complete audit can label the current page ready for user review. Readiness is
not proof that an ATS server will accept a later submission.

## Performance requirements

- Load source data and collect the initial page observation concurrently.
- Reuse the question interpretation until its semantic evidence changes.
- Request model work in bounded batches. Do not reclassify the same question in
  separate mandatory page-understanding and concept-selection model stages.
- Local execution batches retain per-action verification, using a shared
  settling window where controls are independent.
- Use relevant changes and bounded polling for waits. Avoid a fixed serial
  delay for every field, regardless of widget behavior.
- Prepare the selected PDF alongside independent work and cache it by the
  complete source and render configuration. Never attach stale cached bytes.
- Persist checkpoints at useful batch and pause boundaries; do not serialize
  the entire applicant source snapshot after each field.
- Keep correctness guards local where possible and avoid repeated equivalent
  account/tab/frame queries for each action.
- Record the measurements below as timings and counts in a bounded local ring
  buffer, read from a dev-only panel view. Nothing leaves the machine, so the
  privacy rule cannot be broken by a logging mistake.

Measure first verified fill, page-run completion time excluding user response
time, model requests and tokens, observation payload size, replanned questions,
verification failures, and observed coverage. Record timing and counts only,
never applicant values, document content, questions, or patch text in telemetry.
Compare cold and warm runs separately. No speed multiplier is asserted before
measurement.

For a frozen 20-field form with known supported facts and already visible
options, the performance acceptance harness must show at most one model round
(zero when deterministic matches suffice), one initial full observation and one
final audit, and no whole-page reasoning triggered solely by each radio choice.
Dynamic dependencies are tested separately. Batch verification cannot reduce
the per-field correctness or audit coverage compared with individual execution.

## Acceptance cases

| Case | Required result |
| --- | --- |
| Ashby representative page | Cover text/email/number, hidden resume input, location suggestions, Yes/No buttons, radios, optional demographic groups, and required-marker-only fields |
| Greenhouse and Lever representative pages | Verify each included control against the same generic contracts; document any unsupported widget instead of adding a false success |
| New company-specific question | Preserve its original meaning and ask for missing facts without requiring a new concept enum entry |
| Known common fields and model failure | Independent deterministic fields can still complete; unexplained fields remain visible |
| Conflicting Profile/resume/page values | Show evidence and request a choice; no silent overwrite or source priority |
| Missing required and optional answers | Required items enter one queue; optional items remain blank; no invented prose or EEO default |
| Salary and address | Numeric salary receives only amount with confirmed units; contradictory address components prevent ready |
| Dynamic location control | Query text alone cannot count as committed; chosen option belongs to the current query |
| Upload and ATS autofill | FileList alone is insufficient; late errors and autofill conflicts are caught before ready |
| Repeated records | Existing records preserved, blank groups added once, each bound to one record; missing history requested |
| Late validation or new field | Final audit catches reversion, unassociated errors, newly revealed questions, and unresolved requiredness |
| Frames, shadow content, portals | Contexts remain distinct; unavailable regions remain visible coverage gaps |
| Navigation, worker restart, or debugger detach | No old action replay; recover with fresh identities and observation |
| Background tab and user edit | No focus stealing or cross-tab input; target-page human edits pause subsequent actions |
| Source edit and PDF cache | Active source bundle remains pinned; changed template/options cannot reuse the wrong PDF |
| Save answer and account change | Fill confirmation does not persist; explicit saves retain ownership/CAS; sign-out clears temporary state |
| Legacy data and new question persistence | Existing Profile and saved ordinary/open answers remain readable; safe legacy matches work, unsafe matches stay reviewable; a new company-specific question can be saved, reloaded, edited, and deleted without adding a concept enum member, with RLS/CAS intact |
| Page instructions and submit controls | Page text cannot expand tool authority; no navigation, agreement, or submission action |
| Resource exhaustion or truncated evidence | Report incomplete with exact pending work; never infer complete coverage |

Use deterministic tests for source provenance, question scope, guards, scheduling,
and state transitions. Test the driver against recorded DOM/AX fixtures plus
mocked protocol lifecycle events. Such tests do not establish live ATS support.
A fixture recorder is part of this work: it dumps DOM and accessibility tree
for one page, and the user runs it against the acceptance ATS pages. Geometry is
deliberately not captured yet: no observation field carries a box and nothing
reads one, so it would be unread weight in every committed fixture. The
fixture's version field is the door, and the recorder is re-runnable, so
capturing geometry later costs one command rather than a migration.
The performance acceptance harness, including its frozen multi-field form, is a
deliverable rather than an existing asset.
Release acceptance requires manual current-browser checks on all three ATS,
including late upload failure, background behavior, detach/reconnect, and actual
React-controlled widget commitment. Do not submit an application during filling
acceptance. Follow repository instructions: Bun, TypeScript, Biome, and relevant
tests; no build or browser automation unless the user explicitly requests it.

## Replacement and migration

Replace the old page reader/classifier/planner orchestration and its Jev gates
with the above contract. Do not run both engines on the same page or use the
old engine as an invisible fallback. Keep independent auth, resume selection,
Profile editing, PDF rendering, LinkedIn job capture/tailoring, and data access
where they fit the new boundaries.

Preserve existing Profile and reusable-answer rows. Adapt legacy answer meanings
explicitly. If an old answer cannot be safely matched, retain it for user review
rather than deleting it or treating it as a generic answer. New question identity
must preserve scope and must not reuse transient browser refs as persistence keys.
Any schema migration must be additive/backward compatible with these stored
rows and must retain RLS and optimistic concurrency.

Existing staged implementation is not deleted by accepting this specification.
A later implementation change should replace obsolete runtime paths and tests
deliberately, preserving unrelated work. No build is distributed outside the
developer's machine, so the API contract is reshaped in place rather than
versioned. Intermediate states may leave filling unavailable provided the
extension still loads, the LinkedIn path still works, and the fill action
refuses explicitly rather than failing obscurely. This specification authorizes
no deployment, production migration, or automatic application submission.

## Technical references

- [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger):
  permission, supported protocol domains, frame sessions, and detach events.
- [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions):
  debugger is a required permission rather than a runtime optional permission.
- [CDP Accessibility](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility):
  AX observation and associated DOM identity.
- [Accessible name computation](https://w3c.github.io/accname/):
  browser naming semantics, including ARIA and native labels.
