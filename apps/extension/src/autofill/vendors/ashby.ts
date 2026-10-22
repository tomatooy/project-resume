import { normalizeText } from "@workspace/autofill/match"
import { ariaComboParts } from "../combobox"
import {
  LIMITS,
  clip,
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
// Each survey, such as the US EEO one, is a form of its own (Ashby 13).
const FORM = ".ashby-application-form-container"
// Choice questions lack `.ashby-application-form-field-entry` (Ashby 13).
const ENTRY = "[data-field-path]"
/** Ashby's own "Autofill from resume" upload, which is never touched. */
const IGNORE =
  ".ashby-application-form-autofill-pane, .ashby-application-form-autofill-uploader"
const TITLE = ".ashby-application-form-question-title"
const HELP = ".ashby-application-form-question-description"
const SECTION = ".ashby-application-form-section-container"
const CHECKBOXES = ".ashby-application-form-input-checkbox-group"
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

/** The page has no `form` element; this holds every form container. */
function findForm(doc: Document): Element | null {
  const forms = [...doc.querySelectorAll(FORM)]
  const holdsAll = (node: Element): boolean =>
    forms.every((form) => node.contains(form))
  for (let node = forms[0] ?? null; node; node = node.parentElement)
    if (holdsAll(node)) return node
  return null
}

/** The question entries of every form under `root`, in page order. */
const entriesIn = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll(ENTRY)].filter(
    (entry): entry is HTMLElement =>
      entry instanceof HTMLElement &&
      entry.closest(FORM) !== null &&
      entry.closest(IGNORE) === null
  )

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
function yesNo(entry: Element): LiveField["choices"] | null {
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

/** Ashby names each box after its option, so `scanGeneric` sees lone boxes. */
function checkboxGroup(entry: Element): LiveField | null {
  const group = entry.querySelector(CHECKBOXES)
  if (!(group instanceof HTMLElement)) return null
  const choices = [...group.querySelectorAll("input[type=checkbox]")].flatMap(
    (box) =>
      box instanceof HTMLInputElement
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
  return {
    ...parts,
    optionLabel: (option) => {
      // First span in the name/country row, before the domain (Ashby 14).
      const name = option.querySelector(":scope > div > div > span")
      return name ? labelText(name) : ""
    },
    matchSearch: (target, labels) => {
      const wanted = normalizeText(target)
      if (!wanted) return null
      const matches = labels.flatMap((label, i) =>
        normalizeText(label) === wanted ? [i] : []
      )
      return matches.length === 1 ? (matches[0] ?? null) : null
    },
  }
}

/**
 * One entry's field: a combobox, Yes and No buttons, a checkbox list, else a
 * native control.
 */
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
    const school = path === "_systemfield_education_history"
    const live: LiveField = {
      element: input,
      kind: "combo",
      choices: [],
      combo: school ? schoolComboParts(input) : ariaComboParts(input),
    }
    return {
      ...live,
      descriptor: {
        id: path,
        label: title || labelFor(input),
        ...extras,
        control: "combobox",
        optionState:
          school || path === "_systemfield_location" ? "search" : "pending",
        required: requiredIn(entry),
        hasValue: hasValueNow(live),
      },
    }
  }

  const choices = yesNo(entry)
  if (choices) {
    const live: LiveField = { element: entry, kind: "buttons", choices }
    return {
      ...live,
      descriptor: {
        id: path,
        label: title,
        ...extras,
        control: "radio",
        optionState: "ready",
        options: choices.map(({ label }, i) => ({ id: `#${i + 1}`, label })),
        required: requiredIn(entry),
        hasValue: hasValueNow(live),
      },
    }
  }

  const group = checkboxGroup(entry)
  if (group)
    return {
      ...group,
      descriptor: {
        id: path,
        label: title,
        ...extras,
        control: "checkboxes",
        ...listed(group.choices),
        required: requiredIn(entry),
        hasValue: hasValueNow(group),
      },
    }

  const [field] = scanGeneric(entry, { idOf: () => path })
  if (!field) return null
  const { help: _help, section: _section, ...descriptor } = field.descriptor
  // Ashby may replace the file input after an upload (Ashby 5.2).
  const hasValue =
    descriptor.hasValue || (field.kind === "file" && shownName(entry) !== null)
  // Reported as a date, so the server sends YYYY-MM-DD for the driver to retype.
  const date = field.kind === "text" && field.element.matches(DATE)
  return {
    ...field,
    ...(date ? { dateFormat: "MM/DD/YYYY" as const } : {}),
    descriptor: {
      ...descriptor,
      id: path,
      label: title || descriptor.label,
      ...(date ? { control: "date" as const } : {}),
      ...extras,
      hasValue,
    },
  }
}

function scan(root: Element): ScannedField[] {
  const fields: ScannedField[] = []
  for (const entry of entriesIn(root)) {
    if (fields.length >= LIMITS.fields) break
    const path = pathOf(entry)
    if (path === "" || !isShown(entry)) continue
    const field = entryField(entry, path)
    if (field) fields.push(field)
  }
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
  findForm,
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
    const entry = entriesIn(field.element.ownerDocument).find(
      (node) => node.getAttribute("data-field-path") === field.descriptor.id
    )
    return entry ? shownName(entry) : null
  },
}
