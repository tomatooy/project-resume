# Universal autofill, current-page v1

Status: implementation authorized by the October 13, 2026 design interview and
the subsequent `ask-matt implement what we have` request. This supersedes older
autofill specifications where they disagree with the decisions below.

## Product decisions

- One explicit Fill current page action handles the current document. The user
  navigates and submits. No Next, Back, Submit, signature, or CAPTCHA actions.
- Preserve existing values. Replacement requires a preview and explicit choice.
- Fill clear fields first. Collect ambiguous questions, missing information,
  conflicting answers, unverified operations, and drafts for review afterward.
- Retry a difficult control a bounded number of times, then continue elsewhere.
- A trusted user edit pauses automatic operations. Explicit Continue observes
  the page again before executing.
- Generate open-text drafts from confirmed facts. Review and confirmation are
  required before a draft can be filled. Confirmation to fill never implies
  permission to save an answer permanently.
- Profile wins when both Profile and the chosen resume provide the same fact.
  Missing Profile values may fall back to the chosen resume. Explicit No or
  decline-to-answer is a value, not missing data.
- Experience and education come only from the chosen resume and explicit
  supplements for this application. Do not merge other resumes or create a
  complete-history master profile. Autofill never writes to a resume.
- Match existing record groups before filling them. Add observed safe blank
  groups to accommodate relevant resume records. Never combine fields from
  different records or delete populated groups automatically.
- Pin readable source contents at the start of an application, including the
  resume used to render the attached PDF. Later Profile/resume edits affect
  new sessions, not a running application's source snapshot.
- In the same tab, confirmed application identity allows manual navigation to
  retain temporary answers and pinned sources. Each new document has fresh DOM
  references. Unknown or changed application identity starts fresh.
- Closing the application tab discards temporary application state. Reopening
  starts anew. Explicitly saved Profile facts and scoped answers remain.
- Contextual answers default to this application. Permanent saving and broader
  reuse require explicit choices. Reuse requires matching question meaning and
  known conditions, not merely similar words. Saved answers have no automatic
  expiry; users update them.
- Balance speed and coverage: deterministic common cases, batched model work,
  bounded local context reads, and limited exploration for complex widgets.

## Data and trust boundaries

The existing Resume and Autofill Profile remain independent. A scoped-answer
repository holds only explicitly confirmed reusable answers, with semantic
meaning, conditions, provenance, and optimistic concurrency. Existing Profile
structures remain authoritative for the facts they represent.

A tab-scoped application session owns source snapshots, temporary confirmed
answers, unconfirmed drafts, source-record bindings, and execution outcomes.
Store it only in extension session storage with trusted-context access. Content
scripts receive only page-specific observation/action data, never full Profile
or resume snapshots. Do not log applicant content, page text, or answers.

Caller-provided pinned material is validated as authenticated user input:
validate schemas and content hashes, check access to the referenced resume,
and do not represent a client hash as a server signature. Existing clients
without a pinned snapshot keep the existing source-change checks.

## Page observation and interpretation

Read live DOM properties and collect controls before assigning form semantics.
Maintain local Element references separately from the compact model view.
Keep explicit labels, descriptions, headings, root identity, and structural
relationships with evidence refs. Preserve unknown committed state; unknown
must not become empty. Exclude extension UI, passwords, tokens, and file bytes
from the model view. Ordinary filled values stay local by default.

Traverse accessible shadow roots and observe them independently. Read portals
through observed associations. Unavailable frames and opaque widgets remain
explicit coverage gaps. Budgets and truncation must never silently erase a
candidate from the coverage report.

The model interprets observed refs into questions and groups. It cannot invent
selectors, controls, options, or actions. Deterministic validation reconciles
all candidate refs, rejects unsupported evidence, and leaves unresolved items
visible. Jev handles ambiguous semantic, record, and option candidates. The
executor alone resolves live refs and verifies actual browser state.

## Execution and review

Re-observe after dependencies change, options open, a record is added, or the
user resumes. Invalidate stale nodes and guards. MutationObserver is a dirty
signal; live properties before/after actions establish state. Success means
verified page state, not remote-server persistence. Reports distinguish filled,
preserved, review needed, failed, unverified, and unobserved content.

Record creation is a distinct bounded interaction with an observed non-submit
button and current guard. It grants no navigation or arbitrary-click capability.
Open-text generation produces reviewable drafts with fact references. Neither
model output nor a saved draft is an execution authorization.

## Acceptance checks

1. Controls outside form elements and adjacent question text reach the model
   view; omitted refs remain accounted for.
2. Shadow roots, external labels, portals, contenteditable controls, and dynamic
   replacement retain correct references or report unknown/unsupported state.
3. Profile priority, resume fallback, explicit negatives, per-country meanings,
   scoped-answer conflicts, and source snapshots have deterministic tests.
4. Updating source records cannot change pinned plans or uploaded PDF contents.
5. Same-application manual navigation retains facts, never old DOM refs. Changed
   identities and closed tabs clear temporary data. No automatic navigation.
6. Existing values survive automatic runs. Drafts, replacements, and persistent
   saves require their respective explicit confirmations.
7. Add-record interactions cannot submit, navigate, duplicate a matched record,
   or combine independent records.
8. Failed controls do not stop unrelated fields; retries and model calls are
   bounded, and final counts include unresolved observations.
9. Persistent answer storage is user-scoped, uses CAS, and rejects unknown reuse
   conditions. Autofill has no resume mutation path.

## Verification constraints

Use Bun, Vitest, TypeScript, and Biome. Do not run build or browser automation.
Preserve the existing uncommitted autofill work. The starting source snapshot
is `/private/tmp/project-resume-autofill-baseline/source.tar.gz`. Its manifest
identifies this implementation's changes independently of the dirty Git tree.
Review standards and spec compliance separately before delivery. Database
migrations must be reported as unapplied unless actually verified in a local
test stack; do not deploy or alter production as part of implementation.
