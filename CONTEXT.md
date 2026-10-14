# VS:Résumé

An AI resume builder. A user keeps structured resumes, edits them in a form
editor beside a live PDF preview, and asks an assistant to improve them by
accepting or rejecting proposed patches. A browser extension carries the same
account into third-party application forms.

## Language

### The resume

**Resume**: The structured document (`basics` plus sections) that the editor
writes and the preview renders.
_Avoid_: CV, document

**Patch**: One addressed, reversible edit to a resume. The only way any part of
the system, human or model, changes a resume.
_Avoid_: edit, change, update

**Version**: An immutable snapshot of a resume at a moment, created when a
suggestion is accepted, a version is saved, or a version is restored.
_Avoid_: revision, save

**Suggestion**: A proposed set of patches awaiting the user's accept or reject.
_Avoid_: proposal, recommendation

### The DOM agent

**Application**: One identifiable job application open in one browser tab,
which may span several pages that the user visits manually.
_Avoid_: form, session, page

**Page run**: One explicit user request to fill and verify the page currently on
screen.
_Avoid_: fill, autofill, scan

**Observation**: What the extension can currently see of a page: structure, live
control state, accessibility semantics, relationships, errors, and the regions it
could not reach.
_Avoid_: snapshot, scan, page view

**Question**: The prompt, description, choices, constraints, and record context
attached to an observed control or group, as the page itself presents it.
_Avoid_: field, control, concept

**Question key**: The stable identity of a question, used to attach a saved
answer to it later. Derived from the question's own text, kind, and scope, never
from anything about the browser session that observed it.
_Avoid_: semantic key, concept id, element id

**Scope**: The conditions an answer's meaning depends on: country, employer,
time, currency and period, or the record it belongs to. Unknown scope is not a
wildcard.
_Avoid_: context, conditions

**Fact**: One piece of applicant information, carrying where it came from and
the scope it is valid in. The absence of a fact is not a negative answer.
_Avoid_: value, data point, concept

**Source bundle**: The fixed set of sources an application is answered from,
resolved once and pinned for that application's lifetime.
_Avoid_: snapshot, source stamp

**Answer proposal**: A value for one specific question, derived from cited facts
or supplied by the user, together with the transformation that produced it.
_Avoid_: answer, suggestion, decision

**Temporary answer**: An answer that lives only for the current application in
the current tab, which is the default fate of every answer.
_Avoid_: draft, override, selection

**Saved answer**: An answer the user explicitly chose to keep for reuse, stored
with the scope it was saved under.
_Avoid_: scoped answer, stored answer, profile answer

**Profile**: The account-level applicant document, independent of any resume.
_Avoid_: account, user data

**Receipt**: What was observed to happen after an action, including whether the
control accepted it. Dispatching an action is not a receipt.
_Avoid_: result, success, fill count

**Page audit**: A fresh check of the whole page for completeness, consistency,
coverage, and validation, run before the user is told the page is ready.
_Avoid_: verification, report, validation

**Review queue**: The single list in which the user resolves missing required
answers and source conflicts.
_Avoid_: issues, blockers, todo
