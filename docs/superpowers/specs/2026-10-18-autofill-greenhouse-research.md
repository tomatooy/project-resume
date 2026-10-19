# Greenhouse autofill research

Date: 2026-10-18. Status: research for `2026-10-17-autofill-design.md`
(sections 11, 15 and 19). Not implemented. Companion to
`2026-10-17-autofill-ashby-research.md`.

Sources:

- **Observed:** one DOM fixture of a new Greenhouse board
  (`job-boards.greenhouse.io/vercel/jobs/5430088004`, "Software Engineer,
  Backend"). Facts marked observed come from it.
- **Unverified:** general knowledge of how Greenhouse forms behave. Each one
  needs a fixture or a manual check before the adapter relies on it.
- Classic boards (`boards.greenhouse.io`) are a different app. This fixture
  says nothing about them; see 11.

## 1. Summary

- The new board is a Remix app. Text inputs have stable `id`s
  (`first_name`, `email`, `question_<number>`), a `label[for]`, and
  `aria-required`. Scanning them is easy.
- Most custom questions are **react-select** dropdowns. Their options are not
  in the DOM until the menu opens, so a plain scan sees a select with no
  options. This is the main problem for Greenhouse; see 9.1.
- A react-select's `<input>` holds the search text, not the chosen value, so
  `hasValue` has to read the rendered value instead (4.3).
- Phone has two controls: a react-select "Country" (required) and an
  intl-tel-input phone box with its own flag picker.
- Location is an async react-select fed by a remote search, with a "Locate me"
  button that must never be clicked.
- The resume `<input type=file>` has the label "Attach". The real label
  "Resume/CV" comes from the group's `aria-labelledby`.
- Two selects in this fixture are attestations (privacy notice, "double-check
  all the information"). They belong in the forbidden zone, and the second
  one has none of the usual consent keywords (9.4).
- The form is a real `<form method="get">`. A synthetic Enter does not trigger
  the browser's implicit submission (untrusted events have no default action),
  but page key handlers still see it, so the driver never sends Enter outside
  an open react-select menu.

## 2. Noise to drop

Most of the fixture is markup the adapter never reads. Fixture files saved for
tests should strip it too, so they stay small and readable:

| Drop | Why |
|---|---|
| `<svg>` and its children | Icons |
| `style` attributes | Inline layout from react-select |
| `remix-css-*` classes | Emotion hashes; change on every Greenhouse deploy |
| `.iti__dropdown-content` (the 244 `li.iti__country` items and the search input) | intl-tel-input's flag picker; keep 3 items if a test needs the structure |
| `span[aria-live]`, `.remix-css-*-a11yText` | react-select live regions |
| `input[aria-hidden="true"][tabindex="-1"]` (`requiredInput`) | react-select's hidden validation input; never scanned (but see 4.3) |
| `.job__description`, `.job-alert` | Job description and job alert; the spec does not read the page's description |
| `autocapitalize`, `autocorrect`, `spellcheck`, `enterkeyhint`, `dir` | No meaning for autofill |

What the adapter does read: `id`, `for`, `type`, `role`, `aria-required`,
`aria-labelledby`, `aria-describedby`, `aria-expanded`, `maxlength`,
`autocomplete`, `accept`, and the classes `field-wrapper`, `select__*`,
`file-upload`, `phone-input`, `question-description`.

## 3. URLs, posting key and page data

- Form page: `/{board}/jobs/{jobId}` (observed in the form `action` and the
  back link `https://job-boards.greenhouse.io/vercel`). The description and the
  form are on the same page; the top **Apply** button only scrolls to the form.
- Posting key: `greenhouse:{board}:{jobId}`, with `board` lowercased and
  `jobId` all digits. `?gh_src=...` and other query strings are ignored.
- Title: `.job__title h1` (observed: "Software Engineer, Backend").
- Location shown for the job: `.job__location` (observed: "Remote - United
  States"). Not needed in v1.
- Company: not in a dedicated element. Candidates in order, to confirm on a
  live page:
  1. `meta[property="og:site_name"]` or `og:title`.
  2. `document.title`. Classic boards use "Job Application for {Title} at
     {Company}"; the new board likely keeps it (unverified). Accept the
     company part only when the title part matches the `h1`.
  3. The job alert copy "Interested in building your career at {Company}?"
     (observed: "Vercel"). Fragile copy; fallback only.
  4. The board slug (`vercel`), humanized. Weak: display only, and the company
     counts as unknown for the job description match (spec 6.3), as on Ashby.
- Unverified: Remix ships the loader data in an inline
  `window.__remixContext` script, which likely includes the job post, the
  company name and every question with its options. See 9.1.
- iframes: the back link has `target="_top"`, a sign the same page is served
  inside company career sites (`job-boards.greenhouse.io/embed/job_app?...`).
  Many Greenhouse applications happen there (for example
  `vercel.com/careers?gh_jid=...`), and v1 does not cover them (spec 2). This
  is a bigger gap for Greenhouse than for Ashby or Lever.

## 4. Field scan

### 4.1 Form and sections (observed)

```
form#application-form.application--form[method=get]
  .application--questions                 standard fields
    .field-wrapper  text input             first_name, last_name, email
    div > fieldset.phone-input             (not in a .field-wrapper)
      .phone-input__country  react-select  #country, label "Country"
      .phone-input__phone    iti + input   #phone[type=tel]
    .field-wrapper  react-select (async)   #candidate-location, "Locate me" button
    .field-wrapper  .file-upload[role=group][aria-labelledby=upload-label-resume]
                    input#resume[type=file].visually-hidden
                    buttons: Attach, Dropbox, Google Drive, Enter manually
  .application--questions                 custom questions, after an <hr>
    .field-wrapper  react-select | text input
  .application--submit  button[type=submit]   NEVER click
```

- Form detection: `form#application-form`.
- Sections: the two `.application--questions` blocks have no headings. The
  first is the standard block, the second the custom block. Unverified: an
  EEO block (`#eeoc` or similar) follows when the company enables it.
- The phone fieldset is not inside a `.field-wrapper`, so the scan walks
  controls (inputs with a label), not wrappers.

### 4.2 Field descriptor mapping

| Descriptor field | Source |
|---|---|
| `id` | the control's `id` (`first_name`, `question_12521590004`); for the resume group, the file input's `id` (`resume`) |
| `label` | see label order below; strip `span[aria-hidden]` (the `*`) and trim (one label ends in a newline) |
| `help` | text of the `aria-describedby` targets that exist and end in `-description` (`#question_12521590004-description`) |
| `section` | none in the fixture |
| `control` | text input: `text`, or `email` when `autocomplete="email"` or `id="email"` (the email box is `type="text"`); `type=tel`: `tel`; `role=combobox` inside `.select`: `combobox`; `type=file`: `file` |
| `options` | not in the DOM (9.1) |
| `searchable` | true for `#candidate-location` (no dropdown arrow; remote search); otherwise by option count |
| `required` | `aria-required="true"` on the control or on the `[role=group]` |
| `maxLength` | `maxlength` (255 on every text input in the fixture) |
| `hasValue` | 4.3 |

Label order: the control's `aria-labelledby` target, then the enclosing
`[role=group][aria-labelledby]` target, then `label[for=id]`, then
`aria-label`. The group step comes before `label[for]` because the resume
input's own label is "Attach".

`autocomplete` is a good hint for the generic extractor:
`given-name` → `name.first`, `family-name` → `name.last`, `email` →
`contact.email`. Greenhouse sets it on the standard fields (observed).

### 4.3 Value presence

- Text, tel: `input.value !== ""`.
- File: `input.files.length > 0`, or the group shows an attached filename
  (unverified markup).
- react-select: the `<input>` value is the search text and is empty after a
  choice. A value exists when the control contains `.select__single-value` or
  `.select__multi-value` (react-select's standard class names with the
  `select` prefix; unverified on this page). A second signal: react-select
  renders the hidden `requiredInput` only while it has no value (react-select
  5.6+ behavior, unverified here).

### 4.4 Canonical keys in this fixture

Standard fields:

| `id` | Label | Control | Canonical key / tier |
|---|---|---|---|
| `first_name` | First Name | text | `name.first`, rules |
| `last_name` | Last Name | text | `name.last`, rules |
| `email` | Email | text (email) | `contact.email`, rules |
| `country` | Country (in the phone fieldset) | combobox | `contact.phone.country`, rules: "United States" (5.3) |
| `phone` | Phone | tel | `contact.phone.national`, rules (5.3) |
| `candidate-location` | Location (City) | combobox, searchable | `address.city`, rules: query "San Francisco", target "San Francisco, CA" (5.4) |
| `resume` | Resume/CV | file | `resume.file` |

Custom questions:

| `id` | Label (short) | Control | Canonical key / tier |
|---|---|---|---|
| `question_12521589004` | Are you currently based in any of these countries? | combobox | AI (Jev choice) with Profile address; options unknown |
| `question_12521590004` | Will you require Visa Sponsorship now, or in the future? | combobox | `workAuth.sponsorship.any`, rules: Yes when either "now" or "future" is yes (9.5) |
| `question_14151266004` | Your authorization to work in the country where you live | combobox | `workAuth.status`, rules through option synonyms, else Jev choice |
| `question_12550683004` | Do you have experience implementing access control models (like OAuth) | combobox | AI (Jev choice) with resume |
| `question_12521592004` | LinkedIn Profile | text | `links.linkedin`, rules |
| `question_12521593004` | Twitter | text | `links.other` labeled Twitter or X, rules; optional, so left empty when absent |
| `question_12521594004` | Github | text | `links.github`, rules |
| `question_12521595004` | Website | text | `links.website`, falling back to portfolio |
| `question_12521596004` | I acknowledge ... Job Applicant Privacy Notice | combobox | Forbidden zone (consent) → **Fill these on the page** |
| `question_12521597004` | Please double-check all the information provided above | combobox | Forbidden zone (attestation) → **Fill these on the page** (9.4) |
| `question_17702872004` | Where did you first hear about this role? | combobox | `source.how-heard`: the "LinkedIn" option when opened from LinkedIn, else Jev choice with Notes |

Not scanned: the iti search input (`#iti-0__search-input`, inside the hidden
picker), the `requiredInput`s, and the Dropbox, Google Drive, Enter manually
and Locate me buttons.

Unverified standard paths on other postings: `cover_letter` (file, goes to
**Fill these on the page**), `school`, `degree`, `discipline` (education
react-selects, searchable), and the EEO ids `gender`, `hispanic_ethnicity`,
`race`, `veteran_status`, `disability_status`.

## 5. Writing values

### 5.1 Text and tel inputs

Same as Ashby: the native value setter, then bubbling `input` and `change`,
then `blur`. The content script's events have `isTrusted === false`, which
keeps the user-owned rule in spec 5.1 working.

### 5.2 react-select

react-select ignores value changes on its `<input>`; it has to be driven like
a user. The driver (unverified until tested live):

1. Focus the input, then open the menu with a `mousedown` on
   `.select__control` (react-select opens on mousedown, not click).
2. For a searchable select, write the query into the input with the native
   setter and an `input` event, then wait up to 5 s for options (async
   location search).
3. Read `[role="option"]` inside the menu (`.select__menu`), match the target
   (by label for rules, by the option ID from the scan for AI fills), and send
   `mousedown` plus `click` on it.
4. Confirm `.select__single-value` now shows the label. On no match, press
   `Escape`, clear the query and leave the field open.

Keyboard rule: never dispatch `Enter` unless the menu is open and an option is
focused. A synthetic Enter cannot trigger implicit form submission, but a
page `keydown` handler could act on it.

### 5.3 Phone

- `#country` is a react-select of country names (options unverified; likely
  "United States" or "United States +1"). Rules pick the option for the
  Profile's country code (+1 → United States), matching on name or dial code.
- `#phone` is wrapped by intl-tel-input (`.iti`, flag shows a globe until a
  country is set). Write the national number, "(415) 555-0100", per spec 5.5.
  Unverified: whether iti reformats on blur, and whether setting `#country`
  also updates the flag. If the flag stays on the globe, iti may read the
  number as invalid; then write "+1 415 555 0100" instead.
- Never open the iti flag picker.

### 5.4 Location

- `#candidate-location` searches a remote list; options look like "San
  Francisco, California, United States" (unverified).
- The query is the Profile city ("San Francisco"); the target is "San
  Francisco, CA". Option matching must expand the state abbreviation (CA →
  California) and ignore the country part. This belongs in the generic
  option matching in `packages/autofill`.
- "Locate me" asks for browser geolocation. Never click it.

### 5.5 Resume file

- Target: `input#resume` inside `.file-upload[aria-labelledby="upload-label-resume"]`.
- `data-allow-s3="false"` (observed) suggests the file is sent with the form,
  not uploaded at once. Setting `input.files` through `DataTransfer` and
  dispatching `change` should be enough.
- Unverified: after the attach, the buttons are replaced by a filename row
  with a remove control. The "file we attached" check reads that filename
  (spec 6.2, as decided for Ashby).
- Never click Dropbox, Google Drive or Enter manually. "Enter manually" swaps
  the file input for a `#resume_text` textarea; if a user picked it, the
  resume field is user-owned.

## 6. Form changes

- Conditional questions (unverified on new boards): watch
  `form#application-form` with a debounced `MutationObserver` (spec 4 step 5).
- Opening a react-select menu adds and removes `.select__menu` nodes. The
  rescan compares the set of control `id`s and ignores menu churn, so our own
  driver does not trigger extra passes.
- No SPA navigation between description and form; both are on one page.

## 7. Other widgets (unverified)

| Greenhouse type | Likely DOM on new boards | `control` |
|---|---|---|
| Short text | `input.input__single-line` | `text` |
| Long text | `textarea` | `textarea` |
| Single select | react-select | `combobox` |
| Multi select | react-select with `isMulti`, or a checkbox group | `combobox` + `multiple`, or `checkboxes` |
| Yes/No | react-select with Yes / No (all yes/no questions here are selects) | `combobox` |
| Checkbox (consent) | `input[type=checkbox]` | `checkbox`; usually forbidden zone |
| Date | text input | `text` |
| File | `.file-upload` group | `file` |

## 8. Generic extractor notes

Things this fixture shows that apply beyond Greenhouse:

- Label resolution must follow `aria-labelledby` on groups before `label[for]`.
- Strip `aria-hidden` children from label text.
- `autocomplete` tokens are strong canonical-key hints.
- `role="combobox"` inputs are widgets: their `value` is not the field value.
- Inputs that are `aria-hidden="true"` with `tabindex="-1"` are never fields.

## 9. Spec impacts and decisions

### 9.1 Options for react-select fields (decided)

Decision: choice 2 below, applied to the main spec (sections 4, 5.4, 14.1 and
15.1). Widgets are driven only with synthetic DOM events. On the Autofill
click the content script opens each pending select, reads its options and
closes it, in one batch; then rules and AI run and all values are written.
The page-load scan never opens menus. Choice 1 (Remix data) stays a possible
later optimization once a fixture shows the inline data; choice 3 is out
(spec 3).

The scan sends options for closed fields (spec 14.1), and rules and Jev need
them. On Greenhouse the options do not exist in the DOM until the menu opens.
Choices:

1. **Read the page's own data.** Parse the inline Remix loader script for the
   question list and options. No network call and no UI flicker, and it also
   gives the company name. The format is internal and may change, so the
   adapter checks that each parsed question matches a scanned `id` and falls
   back to 2 when it does not.
2. **Open each menu during the scan.** Mousedown, read options, Escape, for
   every select. It works on any react-select page, but the menus flash open
   on page load, and it touches the form before the user asks for anything.
   Acceptable only on the **Autofill** click, not in `plan` on page load.
3. **Call Greenhouse's public Job Board API**
   (`boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true`),
   which returns every question with its options. Reliable, but spec 3 says
   "No vendor API is called", and it adds a network request from the
   extension.

`plan` on page load counts unresolved selects as "may fill" rather than
giving an exact rule count.

### 9.2 `hasValue` for widgets

Spec 15.1 says the content script "checks only whether a field has a value".
For react-select that check reads the rendered single value (4.3), which is
the chosen label. The content script still sends only a boolean. No spec
change, but the adapter test must cover it.

### 9.3 Location matching

Spec 5.5 writes locations as "San Francisco, CA". Greenhouse options spell out
the state and add the country. Option matching (spec 11, semantic rules)
expands US state abbreviations and ignores a trailing country. Small addition
to the spec's option matching.

### 9.4 Forbidden-zone keywords

"Please double-check all the information provided above. Ensuring accuracy is
crucial..." is an attestation without "consent", "certify" or "agree". Add
"acknowledge", "privacy notice", "double-check", "accuracy", "accurate",
"attest" and "certify" to the forbidden-zone keyword list (spec 5.3). The AI
fallback ("needs the applicant") stays as the safety net.

### 9.5 Combined sponsorship question

"Will you require Visa Sponsorship now, or in the future?" combines two
Profile answers. Rule: Yes when either "needs sponsorship now" or "needs
sponsorship in the future" is yes; No only when both are no; open when either
is unset. Common across vendors, so it goes in the generic rules.

## 10. Fixture tests from this page

1. Scan finds 18 fields: 7 standard and 11 custom. It skips the iti search
   input, the `requiredInput`s and every button.
2. The resume field's label is "Resume/CV", not "Attach".
3. Labels have no `*` and no trailing newline.
4. `email` is classed `email` although its `type` is `text`.
5. `question_12521590004` keeps its help text ("Please mark 'YES' ...").
6. `question_12521596004` and `question_12521597004` are forbidden zone.
7. Posting key: `greenhouse:vercel:5430088004`; `gh_src` is ignored.
8. Title "Software Engineer, Backend".
9. With no `.select__single-value`, every select reports `hasValue: false`.
10. Rules fill first name, last name, email, phone, LinkedIn, GitHub and
    Website from a sample Profile; Twitter stays empty when the Profile has
    none.

## 11. Fixtures still needed

- A new-board posting with the selects **open** (one short list, the location
  search with results, the phone country list), and after a choice (to see
  `.select__single-value`).
- The `<head>` and inline scripts of a new-board page (for 3 and 9.1).
- A posting with textarea questions, a cover letter field, education fields,
  a checkbox consent and the EEO block.
- The resume field after a file is attached.
- A classic board (`boards.greenhouse.io/{board}/jobs/{id}`), which is a
  separate adapter.
- Optional: the embed URL, for when iframes come into scope.
