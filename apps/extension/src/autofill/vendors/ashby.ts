import { normalizeText } from "@workspace/autofill/match"
import type { RecordField } from "@workspace/autofill/fields"
import { ariaComboParts } from "../combobox"
import {
  LIMITS,
  clip,
  fieldId,
  isShown,
  labelFor,
  labelText,
  ownLabel,
  textWithBreaks,
  uniqueIds,
} from "../dom"
import { hasValueNow } from "../drivers"
import { listed, scanGeneric } from "../generic"
import type {
  ComboParts,
  LiveField,
  PageInfo,
  ScannedField,
  VendorAdapter,
} from "../types"
import { pageInfo, siteName, TITLE_MAX, titleCompany } from "./page-info"

// Only `ashby-*` classes: the hashed ones change with Ashby deploys (Ashby 1).
const ENTRY = "[data-field-path]"
/** Ashby's own "Autofill from resume" upload, which is never touched. */
const IGNORE =
  ".ashby-application-form-autofill-pane, .ashby-application-form-autofill-uploader, [role=search]"
const TITLE = ".ashby-application-form-question-title"
const HELP = ".ashby-application-form-question-description"
const SECTION = ".ashby-application-form-section-container"
const CHECKBOXES = ".ashby-application-form-input-checkbox-group"
const YESNO = ".ashby-application-form-input-yesno"
const EDUCATION = ".ashby-application-form-input-education-entry"
const CONSENT = ".ashby-application-form-texting-consent-description"
/** A react-datepicker text input that shows and takes MM/DD/YYYY. */
const DATE = "input.ashby-application-form-input-date"
const HEADINGS = "h1, h2, h3, h4, h5, h6, legend"
const POSTING_PATH =
  /^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/application)?\/?$/i
const TITLE_PATTERNS = [
  /^(?<title>.+) @ (?<company>.+)$/,
  /^(?<company>.+?) \| (?<title>.+)$/,
]
const FILE_NAME = /\.(?:pdf|docx?|txt|rtf)$/i
const ID_MAX = 300
const LINK_MAX = 2000

/** The org and job of a posting path, as written, on either tab. */
function postingPath(
  url: URL
): { org: string; jobId: string; application: boolean } | null {
  const match = POSTING_PATH.exec(url.pathname)
  const org = match?.[1]
  const jobId = match?.[2]
  return org && jobId
    ? { org, jobId, application: match?.[3] !== undefined }
    : null
}

const pathOf = (entry: Element): string =>
  clip(entry.getAttribute("data-field-path") ?? "", ID_MAX)

const usable = (element: HTMLElement): boolean =>
  element.closest(IGNORE) === null &&
  !element.matches(':disabled, [aria-disabled="true"]') &&
  isShown(element)

/** Labels can describe a whole date pair or an unlabelled combobox. */
function titleFor(element: HTMLElement): Element | null {
  const wrapping = element.closest(TITLE)
  if (wrapping) return wrapping
  for (let node: Element | null = element; node; node = node.parentElement) {
    const title = [...node.children].find((child) => child.matches(TITLE))
    if (title) return title
    if (node.matches(ENTRY)) break
  }
  return null
}

/** Ashby's required star is generated CSS on several widget types. */
function requiredTitle(title: Element | null): boolean {
  if (!title) return false
  if (title.matches('[required], [aria-required="true"]')) return true
  if (/[*✱]\s*$/.test(title.textContent ?? "")) return true
  const after = getComputedStyle(title, "::after").content
  return /^["']?[*✱]["']?$/.test(after.trim())
}

/** The heading of the entry's section, when it has one outside the entries. */
function sectionOf(entry: Element): string {
  const section = entry.closest(SECTION)
  if (!section) return ""
  for (const heading of section.querySelectorAll(HEADINGS)) {
    if (heading.closest(ENTRY)) continue
    const text = labelText(heading)
    if (text !== "") return text
  }
  return ""
}

/**
 * The name of the file the entry shows: its file input's file, else the
 * filename row Ashby may show after an upload (Ashby 5.2, unverified). The
 * question's title and description never count.
 */
function shownName(entry: Element): string | null {
  const input = entry.querySelector("input[type=file]")
  const picked =
    input instanceof HTMLInputElement ? input.files?.[0]?.name : undefined
  if (picked) return picked
  for (const node of entry.querySelectorAll("*")) {
    if (node.childElementCount > 0 || node.closest(`${TITLE}, ${HELP}`))
      continue
    const text = (node.textContent ?? "").trim()
    if (FILE_NAME.test(text)) return text
  }
  return null
}

/** Exactly two shown buttons reading Yes and No, in page order (Ashby 6). */
function yesNo(entry: Element): LiveField["choices"] | null {
  const buttons = [...entry.querySelectorAll("button")].filter((button) =>
    usable(button)
  )
  if (buttons.length !== 2) return null
  const choices = buttons.map((button) => ({
    element: button,
    label: clip(
      (button.textContent ?? "").replace(/\s+/g, " ").trim(),
      LIMITS.option
    ),
  }))
  const said = new Set(choices.map(({ label }) => normalizeText(label)))
  return said.has("yes") && said.has("no") ? choices : null
}

/** Ashby names each box after its option, so `scanGeneric` sees lone boxes. */
function checkboxGroup(group: HTMLElement): LiveField | null {
  const choices = [...group.querySelectorAll("input[type=checkbox]")].flatMap(
    (box) =>
      box instanceof HTMLInputElement && usable(box)
        ? [
            {
              element: box,
              label: clip(ownLabel(box) || box.name, LIMITS.option),
            },
          ]
        : []
  )
  return choices.length > 0
    ? { element: group, kind: "checkboxes", choices }
    : null
}

/** School results include country and domain, but commit only the name. */
function schoolComboParts(input: HTMLInputElement): ComboParts {
  const parts = ariaComboParts(input)
  const nameOf = (option: HTMLElement): Element | null =>
    option.querySelector(":scope > div > div > span")
  return {
    ...parts,
    optionLabel: (option) => {
      const name = nameOf(option)
      return name ? labelText(name) : ""
    },
    optionDescription: (option) =>
      [...option.querySelectorAll("span")]
        .filter((span) => span !== nameOf(option))
        .map(labelText)
        .filter(Boolean)
        .join(", "),
  }
}

function educationField(
  element: HTMLElement,
  title: Element | null,
  root: Element
): RecordField | undefined {
  const row = element.closest(EDUCATION)
  if (!row || !title) return undefined
  const label = normalizeText(labelText(title))
  const target = title.getAttribute("for") ?? ""
  const field =
    target.endsWith("-school") || label === "school"
      ? "school"
      : target.endsWith("-degree") || label === "degree"
        ? "degree"
        : target.endsWith("-major") || label === "field of study"
          ? "field"
          : target.endsWith("-startDate") || label === "start date"
            ? "start"
            : target.endsWith("-endDate") || label === "end date"
              ? "end"
              : target.endsWith("-isCurrent") || label === "still student"
                ? "current"
                : null
  if (!field) return undefined
  const scope = row.closest(ENTRY) ?? root
  const index = [...scope.querySelectorAll(EDUCATION)].indexOf(row)
  if (index < 0 || index >= LIMITS.fields) return undefined
  const values =
    element instanceof HTMLSelectElement
      ? [...element.options].filter((option) => option.value !== "")
      : []
  const part =
    (field === "start" || field === "end") && values.length > 0
      ? values.every((option) => /^\d{4}$/.test(option.value))
        ? "year"
        : values.every((option) => /^(?:0?[1-9]|1[0-2])$/.test(option.value))
          ? "month"
          : undefined
      : undefined
  return { kind: "education", index, field, ...(part ? { part } : {}) }
}

function describe(field: ScannedField, root: Element): ScannedField {
  const { element, descriptor } = field
  const entry = element.closest(ENTRY)
  const path = (entry && pathOf(entry)) || descriptor.id
  const title = titleFor(element)
  const consent = element.closest(CONSENT)
  const record = educationField(element, title, root)
  const helpNode =
    consent ?? title?.parentElement?.querySelector(`:scope > ${HELP}`)
  const help = helpNode
    ? clip(textWithBreaks(helpNode), LIMITS.help)
    : descriptor.help
  const section = record
    ? `Education ${record.index + 1}`
    : sectionOf(element) || descriptor.section
  const label = consent
    ? "Text message consent"
    : (title && labelText(title)) || descriptor.label
  const id = record
    ? `${path}:${record.index}:${record.field}${record.part ? `:${record.part}` : ""}`
    : consent
      ? `${path}:communicationConsent`
      : path
  const date = field.kind === "text" && element.matches(DATE)
  return {
    ...field,
    ...(date ? { dateFormat: "MM/DD/YYYY" } : {}),
    descriptor: {
      ...descriptor,
      id: clip(id, ID_MAX),
      label: record?.part ? `${label} (${record.part})` : label,
      ...(help ? { help } : {}),
      ...(section ? { section } : {}),
      ...(record ? { record } : {}),
      ...(date ? { control: "date" } : {}),
      required: descriptor.required || (!consent && requiredTitle(title)),
      hasValue:
        descriptor.hasValue ||
        (field.kind === "file" &&
          shownName(entry ?? element.parentElement ?? element) !== null),
    },
  }
}

function choiceField(live: LiveField, root: Element): ScannedField {
  return {
    ...live,
    descriptor: {
      id: fieldId(live.element, root),
      label: labelFor(live.element),
      control: live.kind === "buttons" ? "radio" : "checkboxes",
      ...listed(live.choices),
      required: live.choices.some(({ element }) =>
        element.matches('[required], [aria-required="true"]')
      ),
      hasValue: hasValueNow(live),
    },
  }
}

/** Controls are found across the page; question wrappers supply metadata only. */
function scan(root: Element): ScannedField[] {
  const widgets: ScannedField[] = []
  for (const node of root.querySelectorAll(`${YESNO}, ${ENTRY}`)) {
    if (!(node instanceof HTMLElement) || !usable(node)) continue
    if (!node.matches(YESNO) && node.querySelector(YESNO)) continue
    const choices = yesNo(node)
    if (choices)
      widgets.push(
        choiceField({ element: node, kind: "buttons", choices }, root)
      )
  }
  for (const node of root.querySelectorAll(CHECKBOXES)) {
    if (!(node instanceof HTMLElement) || !usable(node)) continue
    const group = checkboxGroup(node)
    if (group) widgets.push(choiceField(group, root))
  }
  const natives = scanGeneric(root, {
    ignore: (control) =>
      control.closest(IGNORE) !== null ||
      widgets.some(({ element }) => element.contains(control)),
  })
  for (const input of root.querySelectorAll("input[role=combobox]")) {
    if (!(input instanceof HTMLInputElement) || !usable(input)) continue
    const record = educationField(input, titleFor(input), root)
    const school = record?.field === "school"
    const entry = input.closest(ENTRY)
    const location = entry && pathOf(entry) === "_systemfield_location"
    const live: LiveField = {
      element: input,
      kind: "combo",
      choices: [],
      combo: school
        ? schoolComboParts(input)
        : { ...ariaComboParts(input), location: Boolean(location) },
    }
    widgets.push({
      ...live,
      descriptor: {
        id: fieldId(input, root),
        label: labelFor(input),
        control: "combobox",
        optionState: school || location ? "search" : "pending",
        searchable: !input.readOnly,
        required:
          input.required || input.getAttribute("aria-required") === "true",
        hasValue: hasValueNow(live),
      },
    })
  }
  const fields = [...natives, ...widgets]
    .map((field) => describe(field, root))
    .sort((a, b) => {
      if (a.element === b.element) return 0
      return a.element.compareDocumentPosition(b.element) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1
    })
    .slice(0, LIMITS.fields)
  const ids = uniqueIds(fields.map(({ descriptor }) => descriptor.id))
  return fields.map((field, i) => ({
    ...field,
    descriptor: { ...field.descriptor, id: ids[i] ?? field.descriptor.id },
  }))
}

function page(doc: Document, url: URL): PageInfo {
  const heading = doc.querySelector("h1.ashby-job-posting-heading")
  const embeddedTitle =
    url.searchParams.get("displayMode") === "application-form-only"
      ? TITLE_PATTERNS[0]?.exec(doc.title)?.groups?.title
      : null
  const title =
    (heading && clip(labelText(heading), TITLE_MAX)) ||
    (embeddedTitle && clip(embeddedTitle, TITLE_MAX)) ||
    null
  return pageInfo(
    siteName(doc, "Ashby") ?? titleCompany(doc, title, TITLE_PATTERNS),
    postingPath(url)?.org,
    title
  )
}

export const ashby: VendorAdapter = {
  vendor: "ashby",
  postingKey: (url) => {
    const path = postingPath(url)
    return path
      ? clip(
          `ashby:${path.org.toLowerCase()}:${path.jobId.toLowerCase()}`,
          ID_MAX
        )
      : null
  },
  // The Overview tab links to the Application tab (spec 6.5).
  formLink: (_doc, url) => {
    const path = postingPath(url)
    if (!path || path.application) return null
    const link = `${url.origin}/${path.org}/${path.jobId}/application`
    return link.length <= LINK_MAX ? link : null
  },
  scan,
  page,
  attachedName: (field) => {
    const entry = field.element.closest(ENTRY) ?? field.element.parentElement
    return entry ? shownName(entry) : null
  },
}
