# Create a resume from a job posting

Date: 2026-09-09. Status: design, not yet implemented.

## 1. Goal

A user pastes or fetches a LinkedIn job posting, picks one of their existing
resumes, and gets a new resume tailored to that posting. The new resume is a
deep copy of the chosen one, rewritten against the posting by a model.

Non-goals: mining several resumes for the best content, ATS scoring, page-fit
checking, non-LinkedIn job boards, application status tracking, per-node
marking of AI-written content.

## 2. Decisions

| Topic | Decision |
|---|---|
| Base document | Deep copy of exactly one chosen resume, via `create({ fromResumeId })` |
| Who writes | The model writes the whole document; no patches, no suggestion review |
| Output shape | Existing id-free `ParsedResumeSchema`; `assembleResume` mints ids |
| Job input | LinkedIn URLs only, normalised to `/jobs/view/<id>/`; paste is the fallback |
| Fetch confirmation | Fetched text lands in the textarea; the user reads it before generating |
| Job storage | Standalone `job_targets`, many-to-many via `resume_job_targets` |
| Link UI | None this release; the creation flow is the only writer |
| LLM calls | Two: parse the posting, then write the document |
| Length | No page or length target at all |
| Pruning | Items prunable; experience items never dropped; empty sections dropped in code |
| Additions | Allowed anywhere, including bullets, summary and headline |
| Review prompt | One line in the Job tab telling the user to review the result |
| Versions | Exactly one, `created_by: system`; only the label varies |
| Failure and cancel | Keep the plain duplicate, snapshot it, say tailoring did not run |
| Naming | `<company> - <job title>`, a plain string set once at creation |
| Run row | Reserved `skill_id` `tailor_from_job`, outside the `SKILLS` registry |
| Run input | `{ jobTargetId, sourceResumeId }` only; never the posting text |
| Rate limit | The existing hourly `agent_runs` counter |
| Placement | `TailorService` in `resume-core`; prompts and model calls in `agent` |
| Selector default | The resume in context; empty with Generate disabled otherwise |
| Grounding | Rule 10 (`UNGROUNDED_NUMBER`) deleted product-wide, same release |

## 3. Flow

```
user picks a source resume, pastes or fetches a posting
  |
  v
call 1  parse posting -> { title, company, location, requirements }
  |
  v
insert job_targets row
  |
  v
create({ fromResumeId, title, subtitle })      <- valid Resume exists from here on
  |
  v
insert resume_job_targets row (is_origin = true)
  |
  v
open conversation, open agent_runs row
  |
  v
call 2  source document + posting -> ParsedResume
  |
  +-- failure, timeout or cancel --> snapshot "Assembled from <source>", done
  |
  v
assembleResume -> enforceTailorRules -> ResumeSchema.safeParse
  |
  v
update head, snapshot "Tailored for <title> at <company>"
```

The resume row exists before call 2, which is what makes every failure mode
land on one path: the user always gets a resume, and the degraded one is a
plain duplicate rather than nothing.

## 4. Data

New tables, both owner-scoped by RLS and granted only to `authenticated`,
matching every existing table.

`job_targets`: `id`, `user_id`, `source_url`, `raw_text`, `title`, `company`,
`requirements` jsonb, `created_at`. Owner policy on `user_id`.

`resume_job_targets`: `resume_id`, `job_target_id`, `is_origin`, `created_at`,
primary key on the pair. Owner policy joins back to `resumes`, like every other
child table.

A `job_target` with no link row is a saved posting, not garbage: a user who
fetches a posting and closes the dialog leaves one behind, and that is fine.

`is_origin` is written but not yet read. Nothing else can create a link row, so
every resume has exactly one. It is recorded because which posting a resume was
generated from is unrecoverable if not captured at creation.

## 5. Tailoring rules

The prompt asks for rewriting and pruning against the posting. Two rules are
enforced in code afterwards rather than trusted to the prompt:

- Every experience item in the source survives into the output. An irrelevant
  old role may shrink to one bullet, but dropping it would show as an
  employment gap, which reads as a fact about the candidate rather than an
  editing choice.
- A section left with zero items is removed, because react-pdf renders it as a
  bare heading.

There is no length target. The server cannot measure pages (`check_fit` runs in
the browser), and a computed bullet budget would be a guess about six different
templates.

## 6. What this gives up, deliberately

Rule 10 is deleted, additions are permitted inside experience bullets, there is
no suggestion review, and nothing marks which words the model wrote. The line
in the Job tab is the only safeguard, and the user reads it before the content
exists. This is a chosen trade, recorded here so it is not mistaken for an
oversight.

## 7. Divergence from `docs/specs/`

The target specs need four corrections in the same release:

- `over-all-design.md:13` states "The AI never edits the resume directly: it
  returns validated patches". Call 2 writes a whole document. Import already
  bends this; the spec never said so.
- `back-end.md:588` states that clearing `agent_runs.input` means "job
  descriptions are not retained beyond the run". They are now retained in
  `job_targets`. Storing only ids in `agent_runs.input` keeps that sentence
  true while inverting its intent.
- `back-end.md:542` documents `groundingText`, which no longer exists.
- `back-end.md:730` types `skill_id` as a closed union of the seven skill ids.
  `tailor_from_job` is deliberately outside the registry.

`over-all-design.md:79` already lists "Job-description ingestion (store JDs per
resume, reuse across requests)" as a phase 2 item. This implements it, as
many-to-many rather than per resume.
