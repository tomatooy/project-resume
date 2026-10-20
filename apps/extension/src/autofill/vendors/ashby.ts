import { normalizeText } from "@workspace/autofill/match"
import { ariaComboParts } from "../combobox"
import {
  LIMITS,
  clip,
  isShown,
  labelFor,
  labelText,
  textWithBreaks,
  uniqueIds,
} from "../dom"
import { hasValueNow } from "../drivers"
import { scanGeneric } from "../generic"
import type { PageInfo, ScannedField, VendorAdapter } from "../types"
import { humanizeSlug, siteName, titleCompany } from "./page-info"

type Live = Omit<ScannedField, "descriptor">

// Only `ashby-*` classes: the hashed ones change with Ashby deploys (Ashby 1).
const FORM = ".ashby-application-form-container"
const ENTRY = ".ashby-application-form-field-entry[data-field-path]"
/** Ashby's own "Autofill from resume" pane, which is never touched. */
const IGNORE = ".ashby-application-form-autofill-pane"
const TITLE = ".ashby-application-form-question-title"
const HELP = ".ashby-application-form-question-description"
const SECTION = ".ashby-application-form-section-container"
const HEADINGS = "h1, h2, h3, h4, h5, h6, legend"
const POSTING_PATH =
  /^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/application)?\/?$/i
const TITLE_PATTERNS = [
  /^(?<title>.+) @ (?<company>.+)$/,
  /^(?<company>.+?) \| (?<title>.+)$/,
]
const FILE_NAME = /\.(?:pdf|docx?|txt|rtf)$/i
const ID_MAX = 300
const TITLE_MAX = 300
const COMPANY_MAX = 200
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

const requiredIn = (entry: Element): boolean =>
  entry.querySelector('[required], [aria-required="true"]') !== null

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
function yesNo(entry: Element): Live["choices"] | null {
  const buttons = [...entry.querySelectorAll("button")].filter((button) =>
    isShown(button)
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

/** One entry's field: a combobox, Yes and No buttons, else a native control. */
function entryField(entry: HTMLElement, path: string): ScannedField | null {
  const titleNode = entry.querySelector(TITLE)
  const title = titleNode ? labelText(titleNode) : ""
  const helpNode = entry.querySelector(HELP)
  const help = helpNode ? clip(textWithBreaks(helpNode), LIMITS.help) : ""
  const section = sectionOf(entry)
  const extras = {
    ...(help ? { help } : {}),
    ...(section ? { section } : {}),
  }

  const input = entry.querySelector("input[role=combobox]")
  if (input instanceof HTMLInputElement) {
    const live: Live = {
      element: input,
      kind: "combo",
      choices: [],
      combo: ariaComboParts(input),
    }
    return {
      ...live,
      descriptor: {
        id: path,
        label: title || labelFor(input),
        ...extras,
        control: "combobox",
        // Unverified: only the location searches remotely.
        ...(path === "_systemfield_location"
          ? { searchable: true }
          : { optionsPending: true }),
        required: requiredIn(entry),
        hasValue: hasValueNow(live),
      },
    }
  }

  const choices = yesNo(entry)
  if (choices) {
    const live: Live = { element: entry, kind: "buttons", choices }
    return {
      ...live,
      descriptor: {
        id: path,
        label: title,
        ...extras,
        control: "radio",
        options: choices.map(({ label }, i) => ({ id: `#${i + 1}`, label })),
        required: requiredIn(entry),
        hasValue: hasValueNow(live),
      },
    }
  }

  const [field] = scanGeneric(entry, { idOf: () => path })
  if (!field) return null
  const { help: _help, section: _section, ...descriptor } = field.descriptor
  // Ashby may replace the file input after an upload (Ashby 5.2).
  const hasValue =
    descriptor.hasValue || (field.kind === "file" && shownName(entry) !== null)
  return {
    ...field,
    descriptor: {
      ...descriptor,
      id: path,
      label: title || descriptor.label,
      ...extras,
      hasValue,
    },
  }
}

function scan(form: Element): ScannedField[] {
  const fields: ScannedField[] = []
  for (const entry of form.querySelectorAll(ENTRY)) {
    if (fields.length >= LIMITS.fields) break
    const path = pathOf(entry)
    if (
      !(entry instanceof HTMLElement) ||
      path === "" ||
      entry.closest(IGNORE) ||
      !isShown(entry)
    )
      continue
    const field = entryField(entry, path)
    if (field) fields.push(field)
  }
  const ids = uniqueIds(fields.map(({ descriptor }) => descriptor.id))
  return fields.map((field, i) => ({
    ...field,
    descriptor: { ...field.descriptor, id: ids[i] ?? field.descriptor.id },
  }))
}

/**
 * The company comes from the page when it names one; the org slug is a weak
 * guess, shown but not used to match the job (spec 6.3).
 */
function page(doc: Document, url: URL): PageInfo {
  const heading = doc.querySelector("h1.ashby-job-posting-heading")
  const title = (heading && clip(labelText(heading), TITLE_MAX)) || null
  const company =
    siteName(doc, "Ashby") ?? titleCompany(doc, title, TITLE_PATTERNS)
  if (company)
    return { company: clip(company, COMPANY_MAX), companyWeak: false, title }
  const org = postingPath(url)?.org
  const slug = org ? clip(humanizeSlug(org), COMPANY_MAX) : ""
  return { company: slug || null, companyWeak: slug !== "", title }
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
  // The page has no `form` element.
  findForm: (doc) => doc.querySelector(FORM),
  // The Overview tab links to the Application tab (spec 6.5).
  formLink: (_doc, url) => {
    const path = postingPath(url)
    if (!path || path.application) return null
    const link = `${url.origin}/${path.org}/${path.jobId}/application`
    return link.length <= LINK_MAX ? link : null
  },
  scan,
  page,
  // Compares attributes, since jsdom has no `CSS.escape`.
  attachedName: (field) => {
    const entry = [...field.element.ownerDocument.querySelectorAll(ENTRY)].find(
      (node) =>
        !node.closest(IGNORE) &&
        node.getAttribute("data-field-path") === field.descriptor.id
    )
    return entry ? shownName(entry) : null
  },
}
