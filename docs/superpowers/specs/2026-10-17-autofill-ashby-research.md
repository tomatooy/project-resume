# Ashby autofill research

Date: 2026-10-17. Status: research for `2026-10-17-autofill-design.md`
(sections 11, 15 and 19). Not implemented.

Sources:

- **Observed:** one DOM fixture of an Ashby application page
  (`jobs.ashbyhq.com/office-hours/664c0299-27c5-4550-91ec-30c4a058e19f/application`,
  "Software Engineer, Full Stack"). Facts marked observed come from it.
- **Unverified:** general knowledge of how Ashby forms behave. Each one needs a
  fixture or a manual check before the adapter relies on it.

## 1. Summary

- Ashby's form is easy to scan. Every question entry has a `data-field-path`
  that is stable per posting, and every label has a `for` that points at the
  input. Choice questions lack the `.ashby-application-form-field-entry`
  class, and each survey is a form of its own (13).
- The hashed CSS classes (`_input_80epu_28`, `_required_f7cvd_91`) change with
  Ashby deploys. The adapter uses only `ashby-*` classes, `data-field-path`,
  `id`, `name`, `type`, `required` and ARIA roles.
- System fields have fixed paths (`_systemfield_name`, `_systemfield_email`,
  `_systemfield_resume`); custom questions are `question_<number>` and go
  through the label dictionary.
- Inputs are React controlled. Writes must go through the native value setter
  plus a bubbling `input` event, or React drops them.
- The page has a second file input, Ashby's own **Autofill from resume** pane.
  The adapter must never touch it.
- Ashby renders some open questions as single-line `<input type="text">`
  (observed: "What interests you about the role?"). The spec now routes
  single-line inputs through Jev too, so they can get **Write with AI**. See
  9.1.
- The fixture covers only text, email and file. Phone, location, yes/no,
  select, multi-select, date, textarea and the EEO block still need fixtures.

## 2. URLs and posting key

Observed from the tab links:

| Page | Path |
|---|---|
| Overview | `/{org}/{jobId}` |
| Application | `/{org}/{jobId}/application` |

- `org` is the organization slug (`office-hours`); `jobId` is a UUID.
- Query strings such as `?utm_source=...` are ignored.
- Posting key: `ashby:{org}:{jobId}`, with `org` lowercased and `jobId`
  validated as a UUID. Anything else on `jobs.ashbyhq.com` (the org's job list
  at `/{org}`, `/{org}/embed`) has no posting key and shows "No application
  form detected".
- Overview and Application are tabs in one React app (`role="tablist"`,
  `aria-selected`). Unverified: switching tabs is a client-side
  `history.pushState`, so the form mounts without a page load. The content
  script must watch route changes (spec 15.1 already requires this) and rescan
  when `#form` appears.
- On the Overview page the panel links to `{posting}/application` (spec 6.5).

## 3. Page structure (observed)

```
.ashby-job-posting-heading (h1)                  job title
.ashby-job-posting-left-pane                     Location, Employment Type, Location Type, Department
.ashby-job-posting-right-pane
  nav[role=tablist]                              Overview / Application
  #form[role=tabpanel]
    .ashby-application-form-autofill-pane        Ashby's own "Autofill from resume" (IGNORE)
      input[type=file]                           no id, no name
    .ashby-application-form-container            the form
      .ashby-application-form-section-container  one per section
        .ashby-application-form-field-entry[data-field-path]
          label.ashby-application-form-question-title[for]
          .ashby-application-form-question-description   help text (optional)
          input | textarea | widget
  button.ashby-application-form-submit-button    NEVER click
```

Notes:

- There is no `<form>` element in the fixture. Form detection keys on
  `.ashby-application-form-container`, not on `form`.
- A posting with surveys, such as the US EEO one, has one more form container
  per survey, and the upload pane has another class (13).
- The left pane gives the location and location type for free. The spec does
  not read the job description, but the location type ("Hybrid") and city list
  could feed "Are you open to hybrid work" as page context. Not needed for v1.

## 4. Field scan

### 4.1 Field descriptor mapping

| Descriptor field | Source |
|---|---|
| `id` | `data-field-path` (`_systemfield_email`, `question_11916357008`) |
| `label` | text of `label.ashby-application-form-question-title` |
| `help` | `innerText` of `.ashby-application-form-question-description`, line breaks kept |
| `section` | heading of the enclosing `.ashby-application-form-section-container`, if it has one (none in the fixture) |
| `control` | from the input: `type=text` → `text`, `email` → `email`, `file` → `file`, `textarea` → `textarea`; widgets in 6 |
| `required` | the input's `required` attribute (the `_required_` class is hashed; do not use it) |
| `maxLength` | `maxlength` attribute when present (none in the fixture) |
| `hasValue` | `input.value !== ""`, or `input.files.length > 0` for files |

- The label is found by `label[for=<input id>]`. In the fixture the input
  `id` equals `data-field-path`, but the adapter should not assume that.
- Visibility: skip entries where the entry or input is not rendered
  (`offsetParent === null` on the entry, `hidden`, `aria-hidden`). File inputs
  are visually hidden on purpose (1px clip), so the file check uses the
  entry's visibility, not the input's.
- Ashby adds `data-field-entry-id` (`{formId}_{path}`). The prefix is the form
  definition ID and could detect a changed form, but `data-field-path` alone is
  enough for the field ID.

### 4.2 Canonical keys in this fixture

| Path | Label | Control | Canonical key / tier |
|---|---|---|---|
| `_systemfield_name` | Name | text | `name.full`, rules: "First Last" |
| `_systemfield_email` | Email | email | `contact.email`, rules |
| `_systemfield_resume` | Resume | file | `resume.file` |
| `question_11916356008` | LinkedIn (preferred), personal site, or GitHub | text | `links.linkedin`, falling back to website, then GitHub; label rules |
| `question_11916357008` | Do you have three or more years of production-level experience with our tech stack? | text | Open short text; AI with resume evidence (see 9.2) |
| `question_11916358008` | What interests you about the role? | text | Open written answer on a single-line input (see 9.1) |
| `question_11916361008` | How did you find us? | text | `source.how-heard`: "LinkedIn" when opened from LinkedIn (spec 15.2), else AI with Notes |

System field paths, known from the fixture plus unverified ones to confirm:

| Path | Status |
|---|---|
| `_systemfield_name`, `_systemfield_email`, `_systemfield_resume` | Observed |
| `_systemfield_phone`, `_systemfield_location`, `_systemfield_linkedin` (or similar) | Unverified |
| `_systemfield_eeoc_gender`, `_systemfield_eeoc_race`, `_systemfield_eeoc_veteran_status` | Observed on live postings; Ashby's US EEO survey (13) |
| `_systemfield_eeoc_disability_status` | Unverified; not on the sampled postings (13) |

The vendor key table in `packages/autofill` maps known system paths first;
everything else goes through the label dictionary. A system path that the
table does not know is treated like a custom question.

### 4.3 Combined-link fields

"LinkedIn (preferred), personal site, or GitHub" is one text box asking for
any of three links. The label dictionary needs a combined-link rule: match on
two or more of linkedin / github / website / portfolio / personal site in one
label, and write the first Profile link in the order the label names, with
"preferred" moving its link to the front. This pattern is common on Ashby, so
it belongs in the generic rules, not only the Ashby table.

## 5. Writing values

### 5.1 Text, email, textarea

React tracks the value on the element, so assigning `input.value` is
overwritten on the next render. The write is:

```ts
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  el.dispatchEvent(new FocusEvent("blur"))
}
```

- The blur triggers Ashby's per-field validation (unverified), so an invalid
  email shows up right away rather than on submit.
- Our events have `isTrusted === false`; the user's typing has
  `isTrusted === true`. That is the user-owned signal in spec 5.1, and it
  works on Ashby with no change.
- The content script runs in the isolated world, but the native setter and
  events act on the shared DOM, so React sees them. No main-world script is
  needed for text fields.

### 5.2 Resume file

- Target: `#_systemfield_resume`, found through the entry with
  `data-field-path="_systemfield_resume"` (label "Resume" in the fixture; the
  label rule from spec 10 also accepts "CV").
- Write: build a `File` named `${slug(name)}-resume.pdf` with type
  `application/pdf`, set `input.files` from a `DataTransfer`, and dispatch
  `input` and `change` (bubbling). The `accept` list includes `.pdf`.
- The dropzone looks like react-dropzone (hidden input, `role="presentation"`
  container, "or drag and drop here"). react-dropzone reads the input's
  `change` event, so the above should work. Unverified: after the upload,
  Ashby swaps the dropzone for a filename row with a remove control, and may
  re-create the `<input>`. The "file we attached" check in spec 6.2 must then
  look at the filename shown in the entry, not at the original input node.
- Unverified: Ashby uploads the file as soon as it is chosen and shows a
  spinner. The adapter waits for the entry to show the filename (timeout
  15 s) before reporting success; on timeout the panel says "Couldn't attach
  your resume."

### 5.3 Ashby's own "Autofill from resume"

- The pane's file input (`.ashby-application-form-autofill-pane input[type=file]`)
  sends the file to Ashby's parser and then writes Name, Email and other
  fields itself.
- The adapter excludes everything under `.ashby-application-form-autofill-pane`
  from the scan and never writes to it. A file input with no `id` and no
  field entry is never the resume field.
- If the user runs Ashby's autofill after ours, Ashby sets React state with no
  trusted DOM events, so those fields do not become user-owned. Since we fill
  only empty fields and Ashby fills them first or overwrites ours, the next
  rescan sees values it did not write. Rule: a field whose value presence
  changed without our write and without a trusted event is marked user-owned
  too. Spec 5.1 now says so.

## 6. Widgets not in the fixture

Ashby question types and their likely rendering (all unverified):

| Ashby type | Likely DOM | `control` | Driver |
|---|---|---|---|
| Short text | `input[type=text]` | `text` | 5.1 |
| Long text | `textarea` | `textarea` | 5.1; Write with AI |
| Email / Phone / Number | `input[type=email|tel|number]` | as typed | 5.1; phone as "(415) 555-0100" unless a country code control exists |
| Date | `input[type=date]` or a text input with a date picker | `date` | 5.1 with `YYYY-MM-DD`, else typed text |
| Yes/No (boolean) | two buttons "Yes" / "No" with a hidden checkbox | `radio` (options Yes, No) | click the button; check `aria-pressed` or the selected class after |
| Single select, few options | radio list | `radio` | click the `input[type=radio]` or its label |
| Single select, many options | combobox ("Start typing...") with `role=listbox` popup | `combobox`, `searchable` when long | type, wait for `role=option`, click the match (spec 5.4) |
| Multi select | checkbox list | `checkboxes` | click each target checkbox |
| Location | combobox with remote suggestions | `combobox`, `searchable` | query "San Francisco, CA", pick the best match |
| File (other) | dropzone like the resume | `file` | none; goes to **Fill these on the page** |
| EEO block | its own section at the end, select or radio per question | per question | Profile-only rules (spec 5.3) |

For each one the fixture set needs the field closed and, for comboboxes, open
with options showing, since Ashby renders options only while the popup is open.

Click-based widgets: React listens for `click` on the root, and a synthetic
`el.click()` reaches it. Comboboxes may need `focus`, `input` events with the
query, then `keydown` ArrowDown/Enter, or a click on the option. Test each live
by hand (spec 17: jsdom does not run Ashby's React).

## 7. Company and job title

- Title: `h1.ashby-job-posting-heading` (observed).
- Company: not in the fixture's form markup. Candidates in order, to confirm on
  a live page:
  1. `meta[property="og:site_name"]` or `og:title`.
  2. `document.title`, which on Ashby boards is likely "{Title} @ {Company}"
     or "{Company} | {Title}"; parse both, and accept the company part only
     when the title part matches the `h1`.
  3. The header logo's `img[alt]`.
  4. The org slug, humanized (`office-hours` → "Office Hours"). Mark this
     source as weak: use it for display, but treat the company as unknown for
     the job description match (spec 6.3), so a slug never triggers the
     "tailored for a different company" warning.
- Unverified: Ashby boards ship server data in an inline script
  (`window.__appData`) with the organization name and posting title. The
  isolated world cannot read page globals, but it can parse the script's text.
  It is a fallback only; the format is internal and may change.

## 8. Form changes and limits

- Conditional questions: Ashby can show follow-up questions after an answer
  (unverified). The debounced `MutationObserver` in spec 4 step 5 watches
  `.ashby-application-form-container` (subtree, childList) and rescans.
- Rescans must ignore our own writes: value changes do not alter the entry
  list, so a rescan triggered by attributes alone (React re-rendering classes)
  compares the set of `data-field-path` values and does nothing when it is
  unchanged.
- Submit: `.ashby-application-form-submit-button` is never clicked, focused or
  triggered by Enter. Writes do not dispatch `keydown` Enter on text inputs,
  since that could submit.
- iframes: Ashby's embed (`jobs.ashbyhq.com/{org}/embed`, loaded inside a
  company career site) is out of scope for v1 (spec 2).

## 9. Spec impacts and decisions

All four are decided and applied to `2026-10-17-autofill-design.md`.

### 9.1 Open questions on single-line inputs

"What interests you about the role?" is an `input type="text"`, so the old
spec 7 ("Textareas only") gave it no **Write with AI**; it would have gone to
the question list as company specific.

Decision (spec 7 and 12.1): in the `infer` pass, Jev judges every single-line
text input that rules did not fill, from its label and help text: "is this an
open-ended question that needs a written answer?" A yes probability of 0.8 or
above routes it to **Write with AI**; anything lower is ordinary short text.
The bar is higher than for textareas (above 0.2) so short factual fields do
not get the button. A field routed to Write with AI drops its parallel
short-text answer. Drafts for single-line inputs are 1 to 3 sentences.

Fixture expectation for this page: `question_11916358008` ("What interests
you about the role?") gets the button; Name, the link field, "How did you
find us?" and the tech-stack question do not.

### 9.2 Yes/no questions as free text

"Do you have three or more years of production-level experience with our tech
stack?" is a free-text box, with the stack in the help text. The AI short-text
pass can answer it from the resume (evidence: resume), with values such as
"Yes: 4 years with Node.js, TypeScript, React and AWS." The help text must go
to the AI, so `help` stays in the descriptor up to the 2,000 character limit.
No spec change; just a case for the fixture tests.

### 9.3 Value presence changed by the page

Decision (spec 5.1): a rescan that finds a value we did not write marks the
field user-owned (section 5.3).

### 9.4 Resume field after upload

Decision (spec 6.2): the "file we attached" check reads the filename in the
entry, since the input node may be replaced (section 5.2).

## 10. Adapter outline

```ts
// apps/extension/src/autofill/vendors/ashby.ts
const FORM = ".ashby-application-form-container"
const ENTRY = ".ashby-application-form-field-entry[data-field-path]"
const IGNORE = ".ashby-application-form-autofill-pane"

export const ashby: VendorAdapter = {
  vendor: "ashby",
  postingKey(url) {
    const m = new URL(url).pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})(\/application)?\/?$/i)
    return m ? `ashby:${m[1].toLowerCase()}:${m[2].toLowerCase()}` : null
  },
  findForm: (doc) => doc.querySelector(FORM),
  formLink: (url) => /* posting overview → `${posting}/application` */,
  scan(form) {
    return [...form.querySelectorAll<HTMLElement>(ENTRY)]
      .filter((entry) => !entry.closest(IGNORE) && isRendered(entry))
      .map(describeEntry) // 4.1; widgets by 6
  },
  page(doc) {
    return { title: text(doc, "h1.ashby-job-posting-heading"), company: company(doc) } // 7
  },
  write, // 5.1, 5.2, widget drivers
}
```

## 11. Fixture tests from this page

1. Scan finds 7 fields with IDs equal to the `data-field-path` values, all
   required, and none from the autofill pane.
2. `question_11916357008` keeps its help text with line breaks.
3. Posting key: `ashby:office-hours:664c0299-27c5-4550-91ec-30c4a058e19f`;
   `utm_source` is ignored; the overview URL gives the same key.
4. Rules fill Name ("First Last"), Email and the combined link field
   (LinkedIn first). The resume field is classed `resume-file`.
5. "How did you find us?" maps to `source.how-heard`.
6. A write through `setNativeValue` updates `value` and fires `input` with
   `isTrusted === false`; a simulated user edit marks the field user-owned.
7. File attach sets `#_systemfield_resume.files[0].name` and leaves the
   autofill pane input empty.
8. With the form removed (overview fixture), `findForm` returns null and
   `formLink` returns the `/application` URL.

## 12. Fixtures still needed

Ashby postings that, between them, include:

- Phone (with and without a country code control) and location.
- Yes/No, single select (short and long list), multi select, date, textarea.
- The EEO block, with each dropdown both closed and open.
- A conditional question that appears after an answer.
- The resume field after a file is attached.
- The overview page, and `document.title` / `<head>` meta tags (for 7).

## 13. Surveys and choice questions

Checked on 2026-10-20 against Ashby's production bundle (React 18.3.1) and
the posting data of live OpenAI, Notion, Replit and Vanta postings. Sampled
postings from Linear, Plaid, PostHog and Ramp had no survey. There is no DOM
fixture yet, so the drivers below still need a manual check (12).

### 13.1 Forms on the page

- Each form is its own `.ashby-application-form-container`: the application
  form, then one per survey inside `.ashby-survey-form-container`. The US EEO
  survey is one of these, so a scan of the first container alone missed it.
- With surveys, Ashby's own resume upload is
  `.ashby-application-form-autofill-uploader`; without them it is
  `.ashby-application-form-autofill-pane`. Both sit outside the form
  containers.
- `findForm` returns the lowest element holding every form container, so the
  scan and the user-edit listener cover the surveys too. The scan keeps only
  entries inside a form container and outside both upload panes.

### 13.2 Choice questions

- Single select (`ValueSelect`) and multi select (`MultiValueSelect`) entries
  are a bare `div[data-field-path][data-field-entry-id]`, without the
  `.ashby-application-form-field-entry` class. The title and description sit
  inside the entry's fieldset. The adapter finds entries by
  `data-field-path` alone. Before this, it missed every choice question,
  including ones on the application form such as pronouns or "How did you
  hear about us?".
- A single select with 8 options or fewer is a radio group:
  `fieldset.ashby-application-form-input-radio-group`, radios
  `#{entryId}-labeled-radio-{n}` sharing `name={entryId}`, each with a
  `label[for]`. The radios are transparent but laid out, so they count as
  shown. Clicking a checked radio unchecks it.
- A single select with more than 8 options is an autocomplete: an input with
  `role=combobox` and `aria-expanded`, and `aria-controls` only while open.
  It opens on an `ArrowDown` keydown; `mousedown` and focus do not open it.
  Options are `div[role=option]` in a portal. A click on one selects it, and
  the input then shows its label. Typing filters the list (match-sorter), so
  the option order can change after a search.
- A multi select is a checkbox group:
  `fieldset.ashby-application-form-input-checkbox-group`, boxes
  `#{entryId}-labeled-checkbox-{n}`, each with a `label[for]` and named after
  its own option. The adapter reads the group itself, since the generic scan
  takes differently named boxes for separate yes or no fields. React 18
  commits each click before the next, so clicking the boxes back to back is
  safe.
- Choice inputs have no `required` attribute. Only the hashed `_required_`
  class on the title marks a required question, so `required` is false for
  them.

### 13.3 The US EEO survey

The same on all four postings. Its two sections have no title; the heading
("U.S. EQUAL EMPLOYMENT OPPORTUNITY INFORMATION", "SELF-IDENTIFICATION OF
VETERAN STATUS") is bold text in the section description, so these fields
have no `section`. Every question is optional, and none asks about
disability.

| Path | Title | Options, in order | Rendered as |
|---|---|---|---|
| `_systemfield_eeoc_gender` | Gender | Male; Female; Decline to self-identify | radio |
| `_systemfield_eeoc_race` | Race | Hispanic or Latino; White (Not Hispanic or Latino); Black or African American (Not Hispanic or Latino); Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino); Asian (Not Hispanic or Latino); American Indian or Alaska Native (Not Hispanic or Latino); Two or More Races (Not Hispanic or Latino); Decline to self-identify | radio (exactly 8 options) |
| `_systemfield_eeoc_veteran_status` | Veteran Status | I identify as one or more of the classifications of protected veteran listed above; I am not a protected veteran; I decline to self-identify for protected veteran status | radio |

Race is the combined EEO-1 question, so its answer also says whether the
applicant is Hispanic or Latino. The rules in `packages/autofill/src/eeo.ts`:

- A Hispanic answer of "yes" picks "Hispanic or Latino" on a single choice,
  whatever the race. On a multi-select it is checked beside each race.
- An option that says "Not Hispanic or Latino" is picked only when the
  Profile's Hispanic answer is "no". Otherwise the race question goes to
  **Fill these on the page**. Two or more races pick "Two or More Races (Not
  Hispanic or Latino)" under the same rule.
- Decline picks "Decline to self-identify". The veteran decline is found by
  its start, "I decline to self-identify".

With the default Profile, where every EEO answer is "decline", all three
questions fill.
