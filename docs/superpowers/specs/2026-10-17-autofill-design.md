# Job application autofill

Date: 2026-10-17. Status: approved. Implemented for Greenhouse and Ashby;
Lever waits for DOM fixtures (2).

## 1. Goal

On supported applicant tracking system (ATS) pages, the extension fills the
application form from three sources: the selected resume, a new Profile edited
on the Autofill profile page, and per-user Notes that hold long-term facts. It
never submits a form or moves between steps. What it cannot fill becomes a
short list of questions in the panel; the user's answers fill the page and are
merged into Notes for later applications. Long written questions get a
**Write with AI** button.

This replaces the "Autofill is coming soon" placeholder from
`2026-10-17-extension-panel-states-design.md` (section 5, item 6) for
Greenhouse and Ashby, and later for Lever (2). The other vendors keep the
placeholder.

## 2. Scope

In v1:

- Greenhouse classic (`boards.greenhouse.io`, `boards.eu.greenhouse.io`) and
  new (`job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`), and Ashby
  (`jobs.ashbyhq.com`).
- Greenhouse and Ashby forms embedded in a frame on a company career site. A
  frame counts only by its own URL, as Chrome reports it (15.1).
- On those pages, standard HTML controls that the vendor adapter does not
  recognize go through a generic extractor.
- US applicants only. Generated text and all UI copy are in English.

Deferred: Lever (`jobs.lever.co`, `jobs.eu.lever.co`). Its adapter and rules
are written from DOM fixtures, which do not exist yet (19); until then Lever
pages keep the placeholder.

Not in v1:

- Workday, SmartRecruiters and iCIMS (they keep the placeholder).
- Cover letter file upload.
- Streaming generation.
- Learning from edits the user makes on the page.
- Quality telemetry. The user evaluates quality by testing.

Never: clicking Submit or Next, or moving the form to another step.

## 3. Data sources

| Source | Holds | Precedence |
|---|---|---|
| Selected resume | Experience, education, skills, `basics` | Wins for current company and title, school, degree, major, graduation date, years of experience and skills |
| Profile | Identity, contact, links, work authorization, preferences, EEO, other | Wins for identity, contact and links; an empty Profile field falls back to the resume's `basics` |
| Notes | One English text of long-term facts the Profile and resume do not cover | Answers what the two above do not |
| Job description | The selected resume's origin job target (`resume_job_targets.is_origin`) | Context for AI inference and generation, only when it matches the page (6.3) |

No vendor API is called, and the page's own job description is not read.

## 4. Flow

1. **Page load (free).** The autofill content script finds the application
   form and scans it into field descriptors (14.1). It also reads the company,
   job title and posting key from the page. While the panel is showing, the
   service worker sends the scan to `plan`, and again when the form changes.
   `plan` runs rules only. The page-load scan never opens widgets, so fields
   with `optionsPending` count as "may fill". The panel shows the field count,
   how many fields rules can fill, the chosen resume and its job description status, missing
   Profile answers, and an earlier fill of the same posting. The earlier fill
   is the one the first `start` found: `start` then writes this session's own
   record, so the service worker keeps the first answer in the session.
2. **Autofill (1 quota unit).** First, if the scan has closed widgets whose
   options are not in the DOM (`optionsPending`, for example Greenhouse's
   react-select), the content script reads them in one batch: it opens each
   menu, reads its options and closes it, one widget at a time, then sends the
   completed scan and the service worker reruns `plan` (free). Searchable
   widgets are not read this way; they are queried when written (5.4). Then
   the service worker calls `start` (14.4), and in parallel writes the rule
   values, has the panel render and attach the
   resume PDF, and calls `infer` for the fields rules left open. `infer` runs
   Jev and DeepSeek in parallel, then DeepSeek turns what is still open into
   the question list. The deadline is 15 seconds; on timeout `infer` returns
   what finished and the rest become plain questions.
3. **Results.** AI values are written and the panel groups every field (6.4).
4. **Answer (1 unit).** The user answers in the panel's text box and clicks
   **Save and fill again**. One request merges the text into Notes and fills
   the fields that are still empty: Jev picks the options of closed fields
   from the text (12.1), and DeepSeek writes text fields using the text, the
   question list and Notes.
5. **New fields (1 unit per AI pass).** After the first Autofill, a debounced
   `MutationObserver` rescans the form. New fields go through rules first;
   `infer` runs only when rules leave some open. At most 5 automatic passes per
   page, and each field gets one automatic attempt. Clicking **Autofill**
   again runs a manual pass (1 unit) over empty fields the user does not own.
6. **Write with AI (1 unit per draft).** Section 7.

## 5. Fill policy

### 5.1 Which fields

- Only visible, enabled fields are scanned and filled. Hidden fields, including
  honeypots, are ignored.
- Only empty fields are filled. A field that already had a value is listed
  under **Already filled** with **Overwrite** when rules have a value for it.
- Every value the extension writes is recorded. A field becomes user-owned when
  a trusted `input` or `change` event reaches it after our write, or when the
  user clicks **Clear**. A field also becomes user-owned when a rescan finds a
  value we did not write, for example from the vendor's own resume autofill,
  which sets values without trusted events. User-owned fields are never
  written again, by later passes or after a reload.
- An optional field the Profile answers (route `skip`) is left empty when the
  Profile has no value for it: it goes neither to AI nor to the question list,
  and no panel group lists it. A required one goes through AI and the
  questions as usual. Resume facts and "How did you hear about us" never skip.

### 5.2 Tiers

| Tier | When | Result |
|---|---|---|
| Rules | A rule resolves the field from the Profile or resume | Filled; listed under **Filled** |
| AI, confident | Jev single-choice confidence ≥ 0.8 or multi-select yes probability ≥ 0.6, or DeepSeek returns an answer with evidence from the sources, and the field is outside the forbidden zone | Filled; listed under **AI filled, please check** |
| AI, unsure | Any other AI result | Becomes a question, except "How did you hear about us" (5.4) |
| Forbidden zone | 5.3 | Rules from the Profile only; otherwise **Fill these on the page** |

### 5.3 Forbidden zone

- Topics: legal attestations and consent, criminal history, salary,
  relatives at the company, signature, and ID numbers.
- Detected by rules: keyword lists in the field label.
- Salary comes only from the Profile, mapped to page options by
  rules, never through AI. The other topics have no Profile value
  and always go to **Fill these on the page**.
- If one slips past the rules, the AI may only answer "needs the applicant",
  which moves it to **Fill these on the page**.
- These fields never enter the question list.

### 5.4 Closed questions

- A closed answer must be one of the page's options; the server checks option
  IDs against the request.
- Searchable dropdowns (remote or very long option lists such as school or
  location): rules supply a query, the driver types it, waits for options and
  fuzzy-matches them against the target value. No match leaves the field open.
- Demographic questions use the same single-choice and multi-select Jev
  pipeline as other closed questions. Saved Profile answers are available as
  ordinary evidence. An uncertain result becomes a question.
- AI multi-select: an option is selected when Jev's yes probability is ≥ 0.6.
  Select supported options independently; uncertain options stay unselected
  and do not block the others. The field becomes a question only when no
  option qualifies or the model response is incomplete. These fills remain
  under **AI filled, please check**.
- "How did you hear about us": LinkedIn when the tab was opened from a LinkedIn
  job page (15.2); otherwise AI with Notes. A wrong answer here costs little,
  so an unsure AI answer is not asked: a single-select takes the option Jev
  found likeliest, and a multi-select takes its options at ≥ 0.6, else the
  likeliest one. It becomes a question only when Jev gives no usable answer.
- Widgets are driven only with synthetic DOM events from the content script
  (focus, `mousedown`, `click`, the native value setter with `input` and
  `change`, `Escape`). No `chrome.debugger` input and no visible cursor. The
  driver sends `Enter` only while a menu is open with an option focused.
  Writes are applied in a batch after all values are known, not one field per
  server round trip.

### 5.5 Formats

| Value | Written as |
|---|---|
| Full name in one box | "First Last" |
| Missing Profile name | Split from the resume's `basics.name` |
| Phone | Country code and number separately when the page has a country code control; otherwise "(415) 555-0100" |
| Salary | Text: "$150,000 - $180,000 per year" (or "per hour"); number: the minimum |
| Start date | Text: "March 1, 2027" or "2 weeks' notice"; date control: the date, or today plus the notice period |
| Location | "San Francisco, CA" |

## 6. Panel

### 6.1 Layout

```
Autofill · Greenhouse
Stripe · Software Engineer
Resume  [ SWE (Stripe) v ]
        Tailored for Stripe · Software Engineer
[ Autofill ]   32 fields, 22 filled

Questions for you (3)
  1. Are you comfortable joining an on-call rotation? (Yes / No)
  2. Are you open to hybrid or onsite work? Which cities?
     On this page: "Are you willing to work in our NYC office 3 days a week?"
  3. Have you applied to Stripe before?   Likely only for Stripe
  Answer only questions that apply to every application. Answer company-specific
  ones on the page. We add your answers to your notes for future autofill.
  [ large text box ]
                      [ Save and fill again ]
  Notes updated: 2 added    Review · Undo

Fill these on the page (2)   Signature ›  Relatives at Stripe ›
Write with AI (2)            Why Stripe? ›  Additional information ›
AI filled, please check (4) ›
Filled (22) ›
Already filled (1) ›
```

### 6.2 Resume choice

`plan` computes the default once, when the session starts. The service
worker keeps that first pick in the session and sends it with later plans, so
a rescan never switches resumes, and the panel still names the rule that chose
it:

1. The tab was opened from a LinkedIn job page: that job's tailored resume
   (the binding `jobs.lookup` already resolves).
2. Otherwise the newest tailored resume whose job description company matches
   the page company. Matching ignores case, punctuation and legal suffixes
   such as Inc, LLC, Ltd and Corp.
3. Otherwise the resume used for the last autofill.
4. Otherwise the most recently edited resume.

The picker lists resumes with "Tailored for {Company} · {Title}" or "No job
description" under each, so `ResumeSummarySchema` gains `job: { company,
title } | null` from the origin job target. The user can switch resumes at any
time. A switch applies to empty fields and later passes; filled fields are not
rewritten, and the resume file is replaced only if the field still holds the
file we attached. That check reads the filename the vendor shows in the field,
since some vendors (Ashby) replace the file input after an upload.

### 6.3 Job description match

- When the page company and the job description company are both known and
  differ, the panel shows "This resume was tailored for Stripe. This
  application is for Airbnb." with **Use anyway**. Until the user clicks it,
  `infer`, `answer` and `generate` get no job description and the application
  record stores no job target.
- When the page company is unknown, the job description is used without a
  warning.
- A base resume shows "No job description" and works without one.

### 6.4 Groups

In order:

1. **Questions for you.**
   - DeepSeek builds the list from open fields, leaving out forbidden-zone
     fields and fields that get **Write with AI**.
   - Each item is a reusable rephrasing, with the page's wording below it in
     small text ("On this page: …"). Duplicates are merged. Options follow as
     plain text, such as "(Yes / No)". Company-specific items carry "Likely
     only for {Company}" and sort last. The list is plain numbered text with no
     controls.
   - Below it: the instruction copy, a large text box and **Save and fill
     again**.
   - After the request the panel shows one of: "Notes updated: 2 added, 1
     changed" with **Review** (an inline line diff) and **Undo**; "Couldn't
     update your notes" with **Retry**; or "Your notes are full. Clean them up
     in Autofill profile ›". Facts that belong in the Profile add "This belongs
     in your Profile: {Field}. Set in Profile ›".
   - Unanswered items stay. An answer that matched no page option marks its
     item "Didn't match the options on the page". Filling a field on the page
     removes its item.
   - The draft text survives reloads (15.2) until a request succeeds.
2. **Fill these on the page.** Forbidden-zone fields rules could not fill, plus
   file inputs other than the resume. Profile-backed salary items carry
   **Set in Profile ›**.
3. **Write with AI.** Fields that need a written answer (7).
4. **AI filled, please check.** Each item has **Clear**, which empties the
   field and makes it user-owned.
5. **Filled.** A count that expands into the list.
6. **Already filled.** Fields that had a value before autofill, with
   **Overwrite** where rules have a value.

Clicking any item scrolls the page to its field and focuses it. Nothing is
marked on the page itself apart from the Write with AI buttons. Fields that
skip (5.1) appear in no group.

### 6.5 States

- **No form.** "No application form detected". On Ashby posting pages the
  panel links to the form (`/application`); Lever's `/apply` comes with its
  adapter (2).
- **Missing Profile answers.** "Your profile is missing 2 common answers. Set
  in Profile ›". It never blocks autofill. Common answers: legal first and last
  name, email, phone, city, state, and the three work authorization questions.
- **Earlier fill.** "You filled this on Oct 12 with SWE (Stripe)".
- **AI failure or timeout.** Rule values are still written. Open fields appear
  as the page's own questions without consolidation, and the panel says "AI
  couldn't finish. We filled what we could."
- **Quota exhausted.** Rules still fill and questions appear unconsolidated.
  **Save and fill again** and **Write with AI** are disabled and show "AI limit
  reached. Resets at 3:40 PM." The text box keeps its content.

## 7. Write with AI

- **Which fields.** Textareas and single-line text inputs. Some vendors render
  open questions as single-line inputs (Ashby: "What interests you about the
  role?").
  - Textareas: label rules settle obvious open questions (why, cover letter,
    tell us, describe). Jev decides the rest inside `infer`; uncertain counts
    as needing a written answer.
  - Single-line text inputs: every one that rules did not fill goes to Jev
    inside `infer`, which judges from the label and help text whether it is an
    open-ended question. Only a confident yes counts (12.1), so short factual
    fields do not get the button.
  - A field judged "no" is handled as ordinary short text. A field judged
    "yes" is never filled by the short-text pass: since both run in parallel,
    its short-text answer is dropped.
  - Drafts for single-line inputs are 1 to 3 sentences, within `maxlength`.
- **Where.** After the first Autofill, a button appears under each such field
  in our own closed shadow DOM overlay. The overlay root hangs off the
  document element, outside the vendor's form, and follows the field's
  position. The panel's **Write with AI** group lists the same fields.
- **Use.** The button calls `generate` and shows the draft in a popover with
  **Insert**, **Regenerate** and an optional instruction box. Nothing reaches
  the field until **Insert**, which reads **Replace** when the field already
  has text. No streaming.
- **Context.** The selected resume, Profile, Notes, the job description (when
  it matches or after **Use anyway**), the page company and title, the question
  and help text, and the length limit (`maxlength`, or a limit stated in the
  question such as "300 words"). The draft respects the limit.
- Drafts are not saved anywhere.
- Each Generate or Regenerate costs 1 unit. With no quota left the button is
  disabled and shows the reset time.
- Overlay buttons act only on trusted clicks.

## 8. Notes

### 8.1 Format

- One plain-text document per user, always in English; the merge translates
  other languages.
- Topic headings (for example `## Work style`, `## Logistics`, `## Experience
  details`, `## Companies`) and one self-contained fact per line (`- …`).
- Company-specific facts name the company: "- Has not applied to Stripe
  before."
- Facts that belong in the Profile or resume are not written to Notes; the
  panel points to the Profile instead. The current page still uses the user's
  text.
- Limit 10,000 characters, with no automatic condensing. From 9,000 characters
  the Notes editor shows a warning to clean up. A merge whose result would pass
  10,000 is not saved and the panel reports the notes are full; the current
  page still uses the text.

### 8.2 Merge

- Runs inside **Save and fill again**, and again on **Retry**.
- Model input: Notes with line numbers, the page's question list, the user's
  text and the page company. The numbered list lets terse answers such as "1.
  yes" expand into full facts.
- The prompt makes appending the default. A line is replaced only when the new
  text directly contradicts it, and deleted only when the user explicitly says
  it no longer holds.
- The model returns line operations, not a rewritten document: add a line under
  a heading (creating the heading if needed), replace line N, delete line N,
  plus Profile hints. Lines not named stay byte-identical. The server checks
  line numbers and applies the operations itself.
- The result is saved at once, with no confirmation step. The panel reports the
  counts with **Review** and **Undo**.
- If the merge fails while the fill succeeds, the panel offers **Retry**
  (`notes.merge`, 1 unit).
- Saves check `revision`. If Notes changed during the merge (an edit in the
  app), the merge reruns once on the latest text; a second conflict reports a
  failure with **Retry**.

### 8.3 Snapshots

- The previous text is stored as a snapshot before every AI merge, before every
  restore, and before the first save of each manual editing session (the first
  autosave after the editor opens, or after 30 minutes without a save).
- A snapshot identical to the latest one is skipped.
- The latest 20 snapshots per user are kept.
- Panel **Undo** restores the snapshot taken before that merge. If Notes
  changed since, it refuses with "Notes changed since this update. Use History
  in Autofill profile."
- **History** in the app lists snapshots with time and reason, previews one,
  and restores it.

### 8.4 Use

The whole Notes text goes to every AI pass and every generation.

## 9. Autofill profile page

- **Entry.** The user menu gains "Autofill profile" between Skills and Sign
  out; Skills stays.
- **Route.** `/autofill`, opened as a workspace tab: `TabTargetSchema` gains
  `{ kind: "autofill" }` with tab key `autofill`. It is a document surface like
  the skill pages, and the rail lists the sections.
- **Sections.** Personal, Contact, Links, Work authorization, Preferences, EEO,
  Other, Notes. Each has an anchor (`#personal`, `#contact`, `#links`,
  `#work-authorization`, `#preferences`, `#eeo`, `#other`, `#notes`) that
  the extension's **Set in Profile ›** links open.
- **First open.** With no saved Profile the page offers **Import from resume**,
  which copies a chosen resume's `basics` into empty fields, or starting blank.
- **Saving.** Autosave with an 800 ms debounce and a `revision` check; no Save
  button. A conflict reloads the latest data and shows a notice.
- **Notes.** A plain text editor with a character count ("1,234 / 10,000") and
  **History**, saved the same way.

Fields (US only):

| Section | Fields and format |
|---|---|
| Personal | Legal first, middle (optional) and last name; preferred first name (optional); pronouns (she/her, he/him, they/them, or custom) |
| Contact | Email (imported from the resume); phone (country code, default +1, stored as E.164); address (street and apartment optional; city, state, ZIP; country defaults to United States) |
| Links | LinkedIn, GitHub, portfolio, website, plus an "other" list of label and URL |
| Work authorization | Authorized to work in the US (yes/no); needs sponsorship now (yes/no); needs sponsorship in the future (yes/no); status (Citizen, Permanent resident, H-1B, F-1 OPT, F-1 STEM OPT, or Other with text); status expiry (optional) |
| Preferences | Salary (minimum, optional maximum, currency default USD, per year or per hour); start (a date or a notice period in weeks); open to relocation (yes/no); work mode (remote, hybrid, onsite; multi-select); preferred cities |
| EEO | Gender (Male, Female, Non-binary, Decline); Hispanic or Latino (Yes, No, Decline); race (the five EEO-1 categories, multi-select, or Decline); veteran (Protected, Not protected, Decline); disability (Yes, No, Decline). Every EEO field defaults to Decline; Jev reads these answers as ordinary Profile evidence |
| Other | 18 or older, willing to undergo a background check, driver's license (yes/no each); languages, each with a level (native, fluent, professional, basic) |

- From the resume instead: current company and title, school, degree, major,
  graduation date, years of experience, skills.
- Not collected: criminal history, SSN, or any ID number.

## 10. Resume file

- The panel (an extension page) renders the PDF with `@workspace/resume-render`
  using the resume's current template and options, so it matches the app's
  download. The renderer loads lazily so the panel stays light.
- The content comes from the version `start` returns, so the attached file
  matches the recorded snapshot.
- Filename `${slug(basics.name)}-resume.pdf`, as in the app.
- The service worker passes the bytes (base64) to the content script, which
  sets the resume input's files through `DataTransfer` and dispatches `input`
  and `change`.
- Vendor rules identify the resume input (label "Resume" or "CV"). Cover letter
  and other file inputs go to **Fill these on the page**.
- The CSP becomes `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`
  for react-pdf's Yoga WebAssembly.
- Fonts are bundled through Vite, since `resume-render` imports them with
  `?url`; the CJK fallback still loads from jsDelivr.
- If rendering fails or the panel closes mid-render, the panel says "Couldn't
  attach your resume." and the field goes to **Fill these on the page**.

## 11. Rules

| Layer | Lives in | Does | Ships with |
|---|---|---|---|
| Vendor adapter | `apps/extension/src/autofill/vendors/` | Finds the form, reads fields, page company, title and posting key, writes values, drives custom widgets | Extension release |
| Semantic rules | `packages/autofill` | Maps fields to canonical keys (vendor field keys, label dictionary), option synonyms, forbidden-zone detection, value formatting | Worker deploy |

- Rules are TypeScript data and functions, tested against fixtures saved from
  real ATS pages.
- Canonical keys cover names, contact, address, links, work authorization,
  preferences, other Profile fields, resume-derived facts (current
  company and title, school, degree, major, graduation date, years of
  experience), the resume file, and "how did you hear".
- Posting keys come from the URL: Greenhouse board and job ID, Lever company
  and posting ID, Ashby organization and job ID.
- Vendor rules are written once the DOM fixtures arrive.

## 12. AI

### 12.1 Jev

Through `@workspace/typesafe` (`systemOne`):

- One `choice` per closed field. Criteria keys are `o1`, `o2`, and so on,
  described by the page's option labels, plus `insufficient`. The field is
  filled when the chosen key is an option and `confidence` is ≥ 0.8. "How did
  you hear about us" also uses each option's probability (5.4).
- One `noul` per option of a multi-select (5.4), with the full option list so
  an ordered Notes preference can select its first available match.
  Direct Notes answers count independently, even when another named answer
  is absent from the options or a general resume skills list differs.
  Explicit Profile answers retain priority. Job requirements are never
  evidence of the applicant's experience.
- One `noul` per textarea that label rules did not settle, and per single-line
  text input that rules did not fill: "is this an open-ended question that
  needs a written answer?", judged from the label and help text. For a
  textarea, a yes probability above 0.2 counts as yes; for a single-line
  input, 0.8 or above.
- All questions go in one request, split into parallel requests if testing
  finds a size limit. The `state` is the applicant context as JSON; page text
  appears only in question instructions and criteria descriptions.
- Retries are cut to fit the deadline (`maxRetries: 1`, short backoff, no long
  `Retry-After` waits), and requests abort at the `infer` deadline.
- Instructions say the Profile wins over Notes and Notes over the resume, and
  that no personal trait (pronouns, gender, age, race and the like) is ever
  inferred from a name or another indirect clue. Empty Profile values fall
  through to Notes. Explicit answers remain ahead of fallback preferences.
- Notes written with `fallback order` or `preference order` and an arrow chain
  (`A -> B -> C`) get a resolved candidate before judging. Code takes the
  first available exact or unambiguous whole-phrase match and preserves the
  original note. Two independent `noul` questions in the same request check
  whether an explicit answer exists and whether the note applies to this field.
  Use the candidate only when the probability of no explicit answer and of
  applicability are both at least 0.8. A supported preference comes after a
  confident factual answer and before a how-heard guess. Original choice
  probabilities are preserved; Notes support is reported separately. Later
  fallback entries are alternatives, including on multi-selects. Conflicting
  notes and ambiguous earlier matches produce no resolved preference.
  Reply mode does not resolve saved preferences, and applicant-only choices
  stay on the page.
- **Save and fill again** sends the closed fields its questions name in a
  second request. The `state` is the user's text with the applicant context
  beside it, each instruction names the numbered question the field was asked
  as, and the text decides. Criteria are the options, `insufficient` (the text
  does not answer) and `none` (it answers with something no option says,
  which marks the question unmatched). A multi-select adds one `noul`: does
  the text answer it at all?
- `TYPESAFE_API_KEY` becomes required (env example, Wrangler notes, README). A
  missing key logs a fixed configuration error class. `infer` then runs
  DeepSeek alone: the fields Jev would decide, and the text fields it would
  check for open questions, are asked. Follow-up answers leave closed fields
  empty.

### 12.2 DeepSeek

Through `packages/agent` (`deepseek-v4-flash`), single calls with structured
output, no agent loop and no tools:

- **Short text.** One call for all open short fields. Each answer is a value or
  null, with evidence naming its source (resume, Profile or Notes). An answer
  without evidence counts as null. Values are checked against the field
  (length, email, URL and number formats).
- **Question list.** Consolidates open fields into the list (6.4).
- **Notes merge.** Section 8.2.
- **Generation.** Section 7.

### 12.3 Context and untrusted text

- Profile, resume and Notes data may go to DeepSeek and TypeSafe, including
  saved demographic answers. Salary stays out of AI context because only
  rules use it.
- Page text (labels, help text, options, company and title) is untrusted.
  Prompts place it in delimited data blocks and tell the model to treat it as
  data. Closed answers must be page options.

## 13. Quota

- `agent_runs.kind` is `chat` or `autofill`, default `chat`; existing rows
  become `chat`.
- `conversation_id` becomes nullable with `check (kind = 'autofill' or
  conversation_id is not null)`.
- `reserve_agent_quota()` counts per kind: 60 per hour each, same error (P0429,
  RATE_LIMITED with `retryAfterSeconds`). `agent_usage_since` and
  `RunService.assertWithinHourlyLimit` take the kind.
- One run row per AI request: `infer` (including automatic passes), `answer`,
  `notes.merge` and `generate`. `skill_id` names the procedure
  (`autofill.infer`, and so on), `model` is the DeepSeek model ID, `input`
  stays empty, and token counts sum Jev and DeepSeek usage. `plan`, `start`
  and `notes.undo` are free.
- `plan` returns the remaining units and the reset time so the panel can
  disable controls up front.
- Chat and tailoring stay in `chat` with their current limit.

## 14. Backend

### 14.1 Extension API

oRPC procedures under `/api/v1`, plain request and response:

| Procedure | Route | Quota | Does |
|---|---|---|---|
| `autofill.plan` | `POST /autofill/plan` | Free | Rule fills, field classes (forbidden, write, resume file), default resume, job description match, earlier fill, missing Profile answers, quota status |
| `autofill.start` | `POST /autofill/start` | Free | Snapshots the resume, upserts the application record, returns the resume document for the PDF |
| `autofill.infer` | `POST /autofill/infer` | 1 | AI pass over open fields, open-question routing (textareas and single-line inputs), question list |
| `autofill.answer` | `POST /autofill/answer` | 1 | **Save and fill again**: Notes merge and fill in parallel |
| `autofill.generate` | `POST /autofill/generate` | 1 | A draft for one textarea |
| `autofill.notes.merge` | `POST /autofill/notes/merge` | 1 | Retries a failed merge |
| `autofill.notes.undo` | `POST /autofill/notes/undo` | Free | Restores the snapshot taken before a merge |

- The server keeps no session state; the service worker sends the page,
  fields, resume choice, job description flag and question list each time.
- `plan` is a POST because the scan is large.
- Limits per request (initial): 200 fields; label 500 characters; help text
  2,000; 300 options per field, each 200 characters (longer lists are treated
  as searchable); answer text 4,000; instruction 500.
- Deadlines: `infer` 15 s; in `answer` the fill has 15 s and the merge 20 s;
  `generate` 30 s.

Shapes, in outline:

```ts
type FieldDescriptor = {
  id: string // stable for the posting: vendor key, else name or id, else a structural path
  label: string
  help?: string
  section?: string
  control:
    | "text" | "email" | "tel" | "url" | "number" | "date" | "textarea"
    | "select" | "combobox" | "radio" | "checkbox" | "checkboxes" | "file"
  options?: { id: string; label: string }[]
  optionsPending?: boolean // options exist only while the widget is open; read on Autofill (4)
  searchable?: boolean
  multiple?: boolean
  required: boolean
  maxLength?: number
  hasValue: boolean
}

type Fill = { fieldId: string; source: "rule" | "ai" } & (
  | { kind: "text"; value: string }
  | { kind: "options"; optionIds: string[] }
  | { kind: "search"; query: string; target: string }
  | { kind: "check"; checked: boolean }
  | { kind: "resume-file" }
)

type Question = {
  id: string
  text: string
  original: { fieldId: string; label: string }[]
  options?: string[]
  companySpecific: boolean
}
```

The app's Profile and Notes page uses server functions in
`apps/web/src/server/fns/autofill.ts`: get and save the Profile, get and save
Notes, and list, preview and restore snapshots.

### 14.2 Packages and services

- **`packages/autofill`** (new, pure; depends on `zod` and
  `@workspace/resume-schema` only): field descriptor and fill schemas,
  canonical keys, the Profile schema and missing-answer check,
  `profileFromResume`, semantic rules, option matching, value formatting,
  company name normalization, and Notes line operations (parse, apply, diff).
- **`packages/resume-core`**: `AutofillService` (plan, start, infer, answer,
  generate), `AutofillProfileService` and `AutofillNotesService`; ports for
  Profile, Notes and application repositories and for the autofill models,
  each with an in-memory double.
- **`packages/agent`**: prompts and structured calls for short answers, the
  question list, the Notes merge and generation, plus the Jev question
  builders. The Jev client is created in `apps/web` and injected.
- **`apps/web`**: Supabase adapters, the `autofill.*` handlers, server
  functions, and the `/autofill` route.

### 14.3 Tables

All with RLS (owner only, through `user_id = auth.uid()`), granted to
`authenticated`:

| Table | Columns |
|---|---|
| `autofill_profiles` | `user_id` (primary key), `data` jsonb (validated by the Profile schema), `schema_version`, `revision` (bumped by trigger when `data` changes), `updated_at` |
| `autofill_notes` | `user_id` (primary key), `content` (at most 10,000 characters), `revision`, `updated_at` |
| `autofill_note_versions` | `id`, `user_id`, `content`, `reason` (`merge`, `edit`, `restore`), `created_at` |
| `autofill_applications` | `id`, `user_id`, `vendor`, `posting_key`, `org_slug`, `url`, `company`, `title`, `resume_id`, `resume_version_id`, `job_target_id` (nullable), `counts` jsonb, `created_at`, `updated_at`; unique `(user_id, vendor, posting_key)` |

`save_autofill_notes` checks the expected revision, optionally snapshots the
previous text, writes, and prunes snapshots to 20 in one transaction.
`restore_autofill_note_version` snapshots the current text with reason
`restore` before writing. Both are `security invoker`.

### 14.4 Application record and resume snapshot

- `start` runs on the first Autofill of a session and again after a resume
  switch. It upserts the record by `(user, vendor, posting key)` with the URL,
  company, title, resume, snapshot version and, only when the job description
  is used, the job target. Later requests carry the session's counts (fields,
  filled by rules, filled by AI, asked, drafted) and update `counts` and
  `updated_at`. The record means "filled", never "submitted".
- `plan` reads the record for the earlier-fill line and for default resume
  rule 3.
- The snapshot goes through `VersionService.snapshot` with `createdBy:
  'system'` and label "Autofill: {Company} · {Title}", deduplicated by content
  hash against the current version. `create_resume_version` gains an optional
  expected revision so the snapshot cannot write an older head over a
  concurrent autosave; on conflict the snapshot rereads once. The snapshot
  writes identical content, which leaves the resume's revision unchanged, so
  an open editor sees no conflict.

## 15. Extension

### 15.1 Content script

- A new classic content script, `autofill.js`, on the Greenhouse and Ashby
  hosts, in every frame, so it also runs in their forms embedded on company
  career sites. The service worker picks one frame per tab from
  `webNavigation.getAllFrames`: the top frame first, then the session's
  current document, then a single embed. Several new embeds never take over a
  session, and messages and writes target the picked frame's `documentId`.
  Its match list derives from
  `pages.ts`, and the manifest test checks it as it does the widget host's. It
  is injected into open tabs on install and update like the widget host.
- The widget host is unchanged and still hosts the panel and widget frames.
- Duties: find the form through the vendor adapter (or report that none
  exists), scan fields, read the page company, title and posting key, observe
  DOM and SPA route changes, read pending widget options (4), write values
  with synthetic events (5.4), attach the resume file, detect
  trusted user edits and value presence, scroll to and focus a field, and
  render the Write with AI overlay.
- It checks only whether a field has a value, never reads the value, and sends
  no values anywhere. It receives only values to write and drafts. It holds no
  token and makes no network requests.

### 15.2 Service worker session

- One autofill session per tab in `chrome.storage.session` under
  `autofill:<tabId>`, tied to the posting key. It holds the resume choice, the
  **Use anyway** flag, the application ID, per-field state (signature, source,
  written value, user-owned), the pass count, the question list, the draft
  answer text, and the last Notes result with its undo target.
- After a reload the session is restored: written values go back into fields
  that are empty and not user-owned, with no new AI pass. A different posting
  starts a new session. Tab replacement moves the session, and closing the tab
  deletes it.
- LinkedIn origin: `webNavigation.onCreatedNavigationTarget` gives the source
  tab. If that tab is on a LinkedIn job page with a job ID, the new tab records
  `{ platform: "linkedin", externalJobId }`, which applies to the first
  application session in that tab. It drives default resume rule 1 and "How
  did you hear about us".
- All API calls stay in the service worker.

### 15.3 Messages and trust

- Content script messages are validated with Zod and accepted only from the
  frame the service worker picked for the tab they describe (15.1), matched on
  the sender's `frameId` and `documentId`, which Chrome supplies and the page
  cannot forge. They can report scans and field events,
  and ask for a draft for a field in the Write with AI list; nothing else.
- Panel messages keep the existing `trustedPanel` check. The panel snapshot
  gains an `autofill` view for application pages.
- `open-app` gains an optional path from an allowlist (`/autofill` with a
  section anchor) for **Set in Profile ›** links.

### 15.4 Manifest and docs

- The new content script entry and the CSP change (10). No new permissions.
- `docs/extension/README.md` "Behavior and boundaries" is rewritten: the content
  script now reads form structure and writes values.

## 16. Privacy and security

- Never logged: Notes, the user's answers, field labels, options and values,
  drafts, and Profile data. Server logs keep the existing request line
  (procedure and latency) and fixed error classes. Run rows store no input. The
  extension logs no field data.
- One exception, for local debugging: a step-by-step trace prints labels,
  options, values, Notes and answers to the console of an unpacked extension
  build (never a Web Store install) and to the web dev server's terminal (only
  under `vite dev`, never a build). It prints errors as their class only.
- What the page can see: the values we write, and the draft and optional
  instruction inside the overlay; the draft is written for that page anyway.
  The Profile, Notes and tokens never enter the page.
- Only visible fields are filled, closed answers must be page options, and the
  extension never submits.
- Before release, the privacy policy and the Chrome Web Store data disclosures
  describe reading application form fields and sending application data to
  VS:Résumé and its AI providers (DeepSeek, TypeSafe).

## 17. Testing

- `packages/autofill`: unit tests for rules, option matching, formatting,
  company normalization, Notes operations and missing answers, plus fixture
  tests that run saved vendor pages through the rules.
- Extension: adapter tests on saved pages in jsdom (extraction, writes, file
  attach, edit detection), session tests (passes, user-owned fields, reload),
  and panel component tests. Saved pages do not run the vendors' React code,
  so the user checks live widget behavior by hand.
- `resume-core`: service tests with in-memory doubles (resume choice, tiers,
  forbidden zone, quota, Notes conflicts).
- Database: pgTAP for quota per kind, the conversation check, Notes revision,
  snapshots and pruning, and RLS on the new tables.
- API: contract and router tests like the existing ones.
- AI quality: the user's manual testing; no telemetry.

## 18. Build order

1. Data layer: migrations and pgTAP.
2. `packages/autofill`: schemas, canonical keys, Profile, generic rules,
   formatting.
3. Autofill profile page: menu item, `/autofill` tab, sections, Notes with
   History.
4. Backend: services, ports, adapters, AI calls, `autofill.*` procedures.
5. Extension: content script with the generic extractor, session, panel, PDF
   attach, overlay.
6. Vendor adapters and rules from the DOM fixtures: Greenhouse and Ashby.
   Lever follows once its fixtures exist (19).
7. Docs and release: README, env docs, privacy policy, store disclosures.

Steps 1 to 5 do not depend on the fixtures.

## 19. Open items

- DOM fixtures: Greenhouse classic, Greenhouse new and Ashby are coming from
  the user. Lever is still needed, and Lever support waits for it (2).
- Jev size limits and latency are undocumented; measure them and tune the
  15-second deadline and batching.
- Custom widgets on Greenhouse new and Ashby may need per-widget drivers;
  confirm from the fixtures, including expanded dropdowns.
- The renderer's size in the extension bundle; lazy loading keeps the first
  panel load small.
