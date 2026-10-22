import {
  LIMITS,
  clip,
  isShown,
  labelText,
  ownLabel,
  setNativeValue,
  textWithBreaks,
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

const POSTING_PATH =
  /^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/apply)?\/?$/i
const TITLE_PATTERNS = [/^(?<company>.+?) - (?<title>.+)$/]
const QUESTION = ".application-question"
const CUSTOM_PRONOUNS = "customPronounsTextField"
const KEY_MAX = 300
const LINK_MAX = 2000

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

// Lever names standard fields and custom card questions consistently.
const idOf = (control: HTMLElement): string | null =>
  control.id === CUSTOM_PRONOUNS ? control.id : control.getAttribute("name")

function locationParts(input: HTMLInputElement): ComboParts {
  const container = input.closest(".application-field")
  return {
    input,
    opener: input,
    setQuery: (value) => {
      setNativeValue(input, value, { blur: false })
      // Lever searches on keyup and ignores arrow keys.
      input.dispatchEvent(
        new KeyboardEvent("keyup", { key: "End", code: "End", bubbles: true })
      )
    },
    options: () =>
      [...(container?.querySelectorAll(".dropdown-location") ?? [])].filter(
        (option): option is HTMLElement =>
          option instanceof HTMLElement && isShown(option)
      ),
    values: () => {
      const value = input.value.trim()
      return value ? [value] : []
    },
    clearer: () => null,
  }
}

function pronouns(field: ScannedField, row: Element): ScannedField {
  if (field.descriptor.id !== "pronouns" || field.kind !== "checkboxes")
    return field
  const group = row.querySelector("#candidatePronounsCheckboxes")
  const custom = row.querySelector("#customPronounsOption")
  if (
    !(group instanceof HTMLElement) ||
    !(custom instanceof HTMLInputElement) ||
    custom.disabled ||
    custom.matches(":disabled") ||
    !isShown(custom)
  )
    return field
  // The Custom toggle has no name but belongs to the same question.
  const choices = [
    ...field.choices,
    { element: custom, label: clip(ownLabel(custom), LIMITS.option) },
  ]
  const live: LiveField = { element: group, kind: "checkboxes", choices }
  return {
    ...live,
    descriptor: {
      ...field.descriptor,
      ...listed(choices),
      hasValue: hasValueNow(live),
    },
  }
}

function adjusted(field: ScannedField): ScannedField {
  const source = field.choices[0]?.element ?? field.element
  const row = source.closest(QUESTION)
  if (!row) return field
  const label = row.querySelector(".application-label")
  const text = label
    ? labelText(label)
        .replace(/\s*[✱*]+\s*$/, "")
        .trim()
    : ""
  const helpNode = row.querySelector(".description")
  const help = helpNode && isShown(helpNode) ? textWithBreaks(helpNode) : ""
  const heading = row.closest(".section")?.querySelector("h4")
  const section = heading ? labelText(heading) : ""
  const native = pronouns(field, row)
  const { descriptor, element } = native
  const phone = element instanceof HTMLInputElement && element.name === "phone"
  const url =
    element instanceof HTMLInputElement && element.name.startsWith("urls[")
  const combo =
    element instanceof HTMLInputElement &&
    element.matches("#location-input.location-input")
      ? locationParts(element)
      : null
  return {
    ...native,
    ...(combo ? { kind: "combo", combo } : {}),
    descriptor: {
      ...descriptor,
      label:
        element.id === CUSTOM_PRONOUNS
          ? "Custom pronouns"
          : text || descriptor.label,
      ...(phone ? { control: "tel" } : url ? { control: "url" } : {}),
      ...(combo ? { control: "combobox", optionState: "search" } : {}),
      required:
        descriptor.required || label?.querySelector(".required") != null,
      ...(help ? { help: clip(help, LIMITS.help) } : {}),
      ...(section ? { section } : {}),
    },
  }
}

function scan(form: Element): ScannedField[] {
  return scanGeneric(form, { idOf })
    .filter(({ element }) => element.id !== "customPronounsOption")
    .map(adjusted)
}

function page(doc: Document, url: URL): PageInfo {
  const heading = doc.querySelector(".posting-header h2")
  const title = (heading && clip(labelText(heading), TITLE_MAX)) || null
  return pageInfo(
    siteName(doc, "Lever") ?? titleCompany(doc, title, TITLE_PATTERNS),
    postingPath(url)?.org,
    title
  )
}

export const lever: VendorAdapter = {
  vendor: "lever",
  postingKey: (url) => {
    const path = postingPath(url)
    return path
      ? clip(
          `lever:${path.org.toLowerCase()}:${path.jobId.toLowerCase()}`,
          KEY_MAX
        )
      : null
  },
  findForm: (doc) => doc.querySelector("form#application-form"),
  formLink: (_doc, url) => {
    const path = postingPath(url)
    if (!path || path.application) return null
    const link = `${url.origin}/${path.org}/${path.jobId}/apply`
    return link.length <= LINK_MAX ? link : null
  },
  scan,
  page,
  attachedName: ({ element }) =>
    element instanceof HTMLInputElement
      ? (element.files?.[0]?.name ?? null)
      : null,
}
