import type {
  FieldSnapshot,
  OptionSnapshot,
} from "@workspace/resume-core/contracts"
import { buttonChoice, canClickChoice } from "./button-choice"
import {
  closestInPage,
  contextText,
  isTextEditor,
  referenced,
  type PageRoot,
} from "./dom"

export type Control =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | HTMLElement
export type Entry = {
  id: string
  element: HTMLElement
  elements: HTMLElement[]
  revision: number
  fingerprint: string
  guard: string
  before: string
  commitKnown?: boolean
  edits: number
  snapshot: FieldSnapshot
  group: HTMLElement | null
  bindingRef?: OptionSnapshot["bindingRef"]
  optionRevision: number
  optionFingerprint: string
  options: Map<
    string,
    { element: HTMLElement; value: string; fingerprint: string }
  >
  queryRevision: number
  query: string
  ready: boolean
  dirty: boolean
  invalidatedOptions?: string
}
export type RecordEntrypoint = {
  entryRef: string
  entryRevision: number
  kind: "experience" | "education"
  label: string
  element: HTMLButtonElement
  fingerprint: string
}
export function textOf(el: Element): string {
  return (el.getAttribute("aria-label") ?? el.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
}
export function visible(el: HTMLElement): boolean {
  if (!el.isConnected || closestInPage(el, "[hidden],[inert]")) return false
  const style = getComputedStyle(el)
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    el.getClientRects().length > 0
  )
}
export function editable(el: HTMLElement): boolean {
  return (
    !el.matches(":disabled") &&
    !closestInPage(el, '[inert],[aria-disabled="true"]') &&
    !el.hasAttribute("disabled") &&
    !el.hasAttribute("readonly") &&
    el.getAttribute("aria-readonly") !== "true"
  )
}
export function availableControl(el: HTMLElement): boolean {
  if (visible(el)) return true
  if (
    !(el instanceof HTMLInputElement) ||
    el.type !== "file" ||
    !el.isConnected ||
    (el.parentElement && closestInPage(el.parentElement, "[hidden],[inert]"))
  )
    return false
  return [...(el.labels ?? [])].some(visible)
}
export function nameOf(el: HTMLElement): string {
  const labelled = referenced(el, "aria-labelledby")
    .map(contextText)
    .join(" ")
    .trim()
  if (labelled) return labelled
  const aria = el.getAttribute("aria-label")
  if (aria) return aria
  const choice = buttonChoice(el)
  if (choice) return textOf(choice.label)
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    const labels = [...(el.labels ?? [])]
      .map((label) => {
        return contextText(label)
      })
      .join(" ")
    if (labels) return labels
  }
  if (["checkbox", "radio", "switch"].includes(el.getAttribute("role") ?? ""))
    return contextText(el)
  return ""
}
export function commitState(
  entry: Pick<Entry, "element" | "elements">
): "known" | "unknown" {
  const el = entry.element
  if (el instanceof HTMLSelectElement) return "known"
  if (
    ["textbox", "searchbox"].includes(el.getAttribute("role") ?? "") &&
    !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    !isTextEditor(el)
  )
    return "unknown"
  if (el.getAttribute("role") === "combobox") {
    if (el.hasAttribute("data-value") || el.hasAttribute("aria-valuetext"))
      return "known"
    const selected = referenced(el, "aria-controls")
      .concat(referenced(el, "aria-owns"))
      .some((container) =>
        container.querySelector('[role="option"][aria-selected="true"]')
      )
    return selected ? "known" : "unknown"
  }
  if (["checkbox", "radio", "switch"].includes(el.getAttribute("role") ?? ""))
    return ["true", "false"].includes(el.getAttribute("aria-checked") ?? "")
      ? "known"
      : "unknown"
  return "known"
}
export function committed(entry: Pick<Entry, "element" | "elements">): string {
  const el = entry.element
  const choice = buttonChoice(el)
  if (choice)
    return JSON.stringify(
      choice.buttons
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.getAttribute("data-option"))
    )
  if (el instanceof HTMLInputElement && el.type === "file")
    return JSON.stringify(
      [...(el.files ?? [])].map((file) => [
        file.name,
        file.size,
        file.type,
        file.lastModified,
      ])
    )
  if (el instanceof HTMLSelectElement)
    return JSON.stringify(
      [...el.selectedOptions].map((o) => o.value).filter(Boolean)
    )
  if (
    el instanceof HTMLInputElement &&
    (el.type === "radio" || el.type === "checkbox")
  )
    return JSON.stringify(
      entry.elements
        .filter((e) => e instanceof HTMLInputElement && e.checked)
        .map((e) => (e instanceof HTMLInputElement ? e.value : ""))
    )
  if (el.getAttribute("role") === "listbox")
    return JSON.stringify(
      [
        ...el.querySelectorAll<HTMLElement>(
          '[role="option"][aria-selected="true"]'
        ),
      ].map((e) => e.getAttribute("data-value") ?? textOf(e))
    )
  if (el.getAttribute("role") === "combobox")
    return (
      el.getAttribute("data-value") ??
      el.getAttribute("aria-valuetext") ??
      referenced(el, "aria-controls")
        .concat(referenced(el, "aria-owns"))
        .flatMap((container) => [
          ...container.querySelectorAll<HTMLElement>(
            '[role="option"][aria-selected="true"]'
          ),
        ])
        .map((option) => option.getAttribute("data-value") ?? textOf(option))
        .join(", ")
    )
  if (el.getAttribute("role") === "radiogroup")
    return JSON.stringify(
      entry.elements
        .filter((element) => element.getAttribute("aria-checked") === "true")
        .map(
          (element) =>
            element.getAttribute("data-value") ??
            (element.id || textOf(element))
        )
    )
  if (["checkbox", "radio", "switch"].includes(el.getAttribute("role") ?? ""))
    return el.getAttribute("aria-checked") === "true"
      ? '["true"]'
      : el.getAttribute("aria-checked") === "false"
        ? "[]"
        : ""
  if (isTextEditor(el)) return el.textContent ?? ""
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.value
    : ""
}
export function previewValue(entry: Entry): string {
  if (entry.element instanceof HTMLSelectElement)
    return [...entry.element.selectedOptions].map((o) => o.label).join(", ")
  if (
    entry.element instanceof HTMLInputElement &&
    ["checkbox", "radio"].includes(entry.element.type)
  ) {
    if (entry.elements.length === 1)
      return entry.element.checked ? "Checked" : "Unchecked"
    return (
      entry.elements
        .filter((e) => e instanceof HTMLInputElement && e.checked)
        .map(nameOf)
        .join(", ") || "No selection"
    )
  }
  return committed(entry)
}
export function emptyValue(value: string): boolean {
  return value.trim() === "" || value === "[]"
}
export function validationState(
  element: HTMLElement
): FieldSnapshot["state"]["validationState"] {
  if (
    ["true", "grammar", "spelling"].includes(
      element.getAttribute("aria-invalid") ?? ""
    ) ||
    referenced(element, "aria-errormessage").some(
      (error) => visible(error) && Boolean(contextText(error))
    )
  )
    return "invalid"
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  )
    return element.validity.valid ? "valid" : "invalid"
  return element.getAttribute("aria-invalid") === "false" ? "valid" : "unknown"
}
export function optionContainer(entry: Entry): HTMLElement | null {
  if (entry.element.getAttribute("role") === "listbox")
    return visible(entry.element) ? entry.element : null
  const matches = [
    ...new Set(
      referenced(entry.element, "aria-controls").concat(
        referenced(entry.element, "aria-owns")
      )
    ),
  ].filter((e) => e.getAttribute("role") === "listbox" && visible(e))
  return matches.length === 1 ? (matches[0] ?? null) : null
}
export function readOptions(entry: Entry): OptionSnapshot {
  const el = entry.element
  const choice = buttonChoice(el)
  const native = el instanceof HTMLSelectElement
  const grouped =
    (el instanceof HTMLInputElement &&
      (el.type === "radio" || el.type === "checkbox")) ||
    el.getAttribute("role") === "radiogroup"
  const container = optionContainer(entry)
  const items: HTMLElement[] = choice
    ? choice.buttons
    : native
      ? [...el.options]
      : grouped
        ? entry.elements
        : container
          ? [
              ...container.querySelectorAll<HTMLElement>('[role="option"]'),
            ].filter(visible)
          : []
  const prior = entry.options
  const next: Entry["options"] = new Map()
  const options = items.slice(0, 200).map((element) => {
    const value = choice
      ? (element.getAttribute("data-option") ?? "")
      : element instanceof HTMLOptionElement ||
          element instanceof HTMLInputElement
        ? element.value
        : (element.getAttribute("data-value") ??
          (element.id || textOf(element)))
    const label =
      element instanceof HTMLInputElement ? nameOf(element) : textOf(element)
    const fingerprint = `${value}:${label}:${element.getAttribute("aria-disabled") ?? ""}`
    const existing = [...prior].find(
      ([, o]) => o.element === element && o.fingerprint === fingerprint
    )
    const optionId = existing?.[0] ?? crypto.randomUUID()
    next.set(optionId, { element, value, fingerprint })
    return {
      optionId,
      label: label.slice(0, 1000),
      description: "",
      disabled:
        ("disabled" in element && element.disabled === true) ||
        Boolean(
          choice &&
            element instanceof HTMLButtonElement &&
            (!canClickChoice(element) ||
              !visible(element) ||
              choice.input.disabled ||
              element.matches(":disabled"))
        ) ||
        !editable(element),
      placeholder: !value,
      selected:
        element instanceof HTMLOptionElement
          ? element.selected
          : element instanceof HTMLInputElement
            ? element.checked
            : element.getAttribute(
                choice
                  ? "aria-pressed"
                  : el.getAttribute("role") === "radiogroup"
                    ? "aria-checked"
                    : "aria-selected"
              ) === "true",
    }
  })
  const fingerprint = JSON.stringify(options)
  if (fingerprint !== entry.optionFingerprint) {
    entry.optionRevision++
    entry.optionFingerprint = fingerprint
  }
  entry.options = next
  if (entry.invalidatedOptions && entry.invalidatedOptions !== fingerprint)
    entry.invalidatedOptions = undefined
  const known = native || grouped || Boolean(choice)
  return {
    bindingRef: entry.bindingRef,
    fieldId: entry.id,
    fieldRevision: entry.revision,
    optionsRevision: entry.optionRevision,
    queryRevision: entry.queryRevision,
    query: entry.query,
    loadState: entry.invalidatedOptions
      ? "loading"
      : known ||
          (container &&
            entry.ready &&
            (!(el instanceof HTMLInputElement) ||
              (el.value === entry.query &&
                (!container.hasAttribute("data-query") ||
                  container.getAttribute("data-query") === entry.query))))
        ? "ready"
        : container?.getAttribute("aria-busy") === "true"
          ? "loading"
          : "idle",
    coverage: known && items.length <= 200 ? "complete" : "partial",
    hasMore: known ? items.length > 200 : null,
    canSearch: !known && el instanceof HTMLInputElement,
    canScroll: Boolean(
      container && container.scrollHeight > container.clientHeight
    ),
    options,
  }
}
export class Registry {
  readonly entries = new Map<string, Entry>()
  readonly ids = new WeakMap<HTMLElement, string>()
  readonly nodes = new Map<string, HTMLElement>()
  readonly publishedRefs = new Set<string>()
  readonly recordEntrypoints = new Map<string, RecordEntrypoint>()
  private nextId = 1
  documentEpoch = 1
  formRevision = 0
  formId = ""
  form: HTMLElement | null = null
  validStructure: () => boolean = () => true
  private structure = ""
  private readonly observers = new Map<PageRoot, MutationObserver>()
  onIntervention: () => void = () => undefined
  constructor(readonly doc: Document) {
    this.observeRoot(doc)
    for (const event of ["input", "change", "pointerdown", "keydown"])
      doc.addEventListener(event, this.userEvent, true)
  }
  idFor(element: HTMLElement): string {
    const existing = this.ids.get(element)
    if (existing) {
      this.nodes.set(existing, element)
      return existing
    }
    const id = `node_${this.nextId++}`
    this.ids.set(element, id)
    this.nodes.set(id, element)
    return id
  }
  observeRoot(root: PageRoot) {
    if (this.observers.has(root)) return
    const observer = new MutationObserver((records) => this.invalidate(records))
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    this.observers.set(root, observer)
  }
  private invalidate(records: MutationRecord[]) {
    if (!records.length) return
    // Referenced labels and portals can live outside a field's subtree.
    for (const entry of this.entries.values()) entry.dirty = true
  }
  flushMutations() {
    for (const [root, observer] of this.observers) {
      this.invalidate(observer.takeRecords())
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        observer.disconnect()
        this.observers.delete(root)
      }
    }
  }
  private userEvent = (event: Event) => {
    if (!event.isTrusted) return
    for (const entry of this.entries.values())
      if (
        event
          .composedPath()
          .some(
            (node) =>
              node === entry.element ||
              entry.elements.some((element) => node === element) ||
              [...entry.options.values()].some(
                (option) => node === option.element
              )
          )
      ) {
        entry.edits++
        entry.guard = crypto.randomUUID()
        this.onIntervention()
        break
      }
  }
  reviseStructure(value: string) {
    if (value !== this.structure) {
      this.structure = value
      this.formRevision++
    }
  }
  release() {
    for (const observer of this.observers.values()) observer.disconnect()
    this.observers.clear()
    for (const event of ["input", "change", "pointerdown", "keydown"])
      this.doc.removeEventListener(event, this.userEvent, true)
    this.entries.clear()
    this.nodes.clear()
    this.publishedRefs.clear()
    this.recordEntrypoints.clear()
  }
}
