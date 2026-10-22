import { reactSelectParts } from "../combobox"
import {
  LIMITS,
  clip,
  fieldId,
  groupLabel,
  helpFor,
  isShown,
  labelFor,
  labelText,
  uniqueIds,
} from "../dom"
import { hasValueNow } from "../drivers"
import { scanGeneric } from "../generic"
import { greenhousePosting } from "../posting-url"
import type { LiveField, PageInfo, ScannedField, VendorAdapter } from "../types"
import { pageInfo, siteName, TITLE_MAX, titleCompany } from "./page-info"

const CLASSIC_ID = "application_form"
/** The phone box's country flag picker, which has its own search box. */
const FLAG_PICKER = ".iti__dropdown-content"
const TITLE_PATTERNS = [/^Job Application for (?<title>.+) at (?<company>.+)$/]
const JOB_ALERT = /Interested in building your career at (.+?)\?/
const KEY_MAX = 300

/** react-select also points `aria-describedby` at its placeholder. */
const isDescription = (id: string): boolean => id.endsWith("-description")

/** The control a field's help and group hang on: a group's first box. */
const sourceOf = (field: ScannedField): HTMLElement =>
  field.kind === "radio" || field.kind === "checkboxes"
    ? (field.choices[0]?.element ?? field.element)
    : field.element

const inFlagPicker = (field: ScannedField): boolean =>
  [field.element, ...field.choices.map(({ element }) => element)].some(
    (element) => element.closest(FLAG_PICKER) !== null
  )

/** Corrects what the generic scan reads differently on the new board. */
function adjusted(field: ScannedField): ScannedField {
  const { element } = field
  const { help: _generic, ...descriptor } = field.descriptor
  const source = sourceOf(field)
  const help = helpFor(source, isDescription)
  // The email box is `type="text"`.
  const email =
    element instanceof HTMLInputElement &&
    element.type === "text" &&
    (element.getAttribute("autocomplete")?.trim().toLowerCase() === "email" ||
      element.id === "email")
  // The resume input's own label reads "Attach"; its group names it.
  const upload =
    element instanceof HTMLInputElement &&
    element.type === "file" &&
    element.closest(".file-upload[role=group]") !== null
  return {
    ...field,
    descriptor: {
      ...descriptor,
      label: (upload && groupLabel(element)) || descriptor.label,
      ...(email ? { control: "email" } : {}),
      required:
        descriptor.required ||
        source.closest("[role=group]")?.getAttribute("aria-required") ===
          "true",
      ...(help ? { help } : {}),
    },
  }
}

/** The react-selects, which the generic scan leaves out as widgets. */
function reactSelects(form: Element): ScannedField[] {
  const found: ScannedField[] = []
  for (const input of form.querySelectorAll("input[role=combobox]")) {
    if (
      !(input instanceof HTMLInputElement) ||
      input.disabled ||
      input.matches(":disabled") ||
      input.closest(FLAG_PICKER) !== null ||
      !isShown(input)
    )
      continue
    const combo = reactSelectParts(input)
    if (!combo) continue
    const live: LiveField = {
      element: input,
      kind: "combo",
      choices: [],
      combo,
    }
    const help = helpFor(input, isDescription)
    found.push({
      ...live,
      descriptor: {
        id: fieldId(input, form),
        label: labelFor(input),
        control: "combobox",
        optionState: input.id === "candidate-location" ? "search" : "pending",
        // Unverified.
        ...(combo.opener.querySelector(".select__value-container--is-multi")
          ? { multiple: true }
          : {}),
        required: input.getAttribute("aria-required") === "true",
        hasValue: hasValueNow(live),
        ...(help ? { help } : {}),
      },
    })
  }
  return found
}

const inPageOrder = (a: ScannedField, b: ScannedField): number => {
  const first = sourceOf(a)
  const second = sourceOf(b)
  if (first === second) return 0
  return first.compareDocumentPosition(second) &
    Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1
}

/**
 * A classic form is plain HTML. The new board merges the native controls
 * with its react-selects, in page order.
 */
function scan(form: Element): ScannedField[] {
  if (form.id === CLASSIC_ID) return scanGeneric(form)
  const fields = [
    ...scanGeneric(form)
      .filter((field) => !inFlagPicker(field))
      .map(adjusted),
    ...reactSelects(form),
  ]
    .sort(inPageOrder)
    .slice(0, LIMITS.fields)
  const ids = uniqueIds(fields.map(({ descriptor }) => descriptor.id))
  return fields.map((field, i) => ({
    ...field,
    descriptor: { ...field.descriptor, id: ids[i] ?? field.descriptor.id },
  }))
}

function titleOf(doc: Document): string | null {
  const text = [doc.querySelector(".job__title h1"), doc.querySelector("h1")]
    .map((heading) => (heading ? clip(labelText(heading), TITLE_MAX) : ""))
    .find((heading) => heading !== "")
  return text ?? null
}

/** "Interested in building your career at {Company}?" Fragile copy. */
function alertCompany(doc: Document): string | null {
  const text = doc.querySelector(".job-alert")?.textContent ?? ""
  const company = JOB_ALERT.exec(text.replace(/\s+/g, " "))?.[1]?.trim()
  return company || null
}

function page(doc: Document, url: URL): PageInfo {
  const posting = greenhousePosting(url)
  // Form-only embeds omit the job heading.
  const embeddedTitle = posting?.embedded
    ? TITLE_PATTERNS[0]?.exec(doc.title.trim())?.groups?.title
    : null
  const title =
    titleOf(doc) || (embeddedTitle && clip(embeddedTitle, TITLE_MAX)) || null
  return pageInfo(
    siteName(doc, "Greenhouse") ??
      titleCompany(doc, title, TITLE_PATTERNS) ??
      alertCompany(doc),
    posting?.board,
    title
  )
}

export const greenhouse: VendorAdapter = {
  vendor: "greenhouse",
  postingKey: (url) => {
    const path = greenhousePosting(url)
    return path
      ? clip(`greenhouse:${path.board.toLowerCase()}:${path.jobId}`, KEY_MAX)
      : null
  },
  findForm: (doc) =>
    doc.querySelector("form#application-form") ??
    doc.querySelector(`form#${CLASSIC_ID}`),
  // The form is on the posting page.
  formLink: () => null,
  scan,
  page,
  // Unverified: the filename row an attach shows (GH 5.5).
  attachedName: ({ element }) =>
    element instanceof HTMLInputElement
      ? (element.files?.[0]?.name ?? null)
      : null,
}
