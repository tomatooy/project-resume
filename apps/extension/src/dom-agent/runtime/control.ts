import { normalizeLabel, RUNTIME_SETTLE_POLL_MS } from "./protocol"

/**
 * Everything here runs in the page's main world against a control the worker
 * resolved from the current observation. Nothing in this file keeps a selector,
 * a cached element, or a document-wide lookup: a control arrives as a live
 * object and is checked for liveness before it is used.
 */

/** Both sides match labels, so the comparison lives in the shared protocol. */
export { normalizeLabel }

/**
 * The prototype accessor, not the instance property. Framework-controlled
 * inputs track the instance property to detect user edits, so writing through
 * the instance would update the DOM without the framework ever seeing a change.
 */
export function nativeSet(
  element: Element,
  property: "value" | "checked",
  value: string | boolean
): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    property
  )
  const setter = descriptor?.set
  if (!setter) return false
  setter.call(element, value)
  return true
}

/** One realm's constructor, so frames and iframes get their own classes. */
export function realmOf(element: Element): Window & typeof globalThis {
  const view = element.ownerDocument.defaultView
  if (!view) throw new Error("A detached document has no window")
  return view as Window & typeof globalThis
}

export function dispatchInputEvents(
  element: Element,
  types: readonly string[]
): void {
  const win = realmOf(element)
  for (const type of types) {
    const EventConstructor = type === "click" ? win.MouseEvent : win.Event
    element.dispatchEvent(
      new EventConstructor(type, { bubbles: true, cancelable: true })
    )
  }
}

export function isDisabled(element: Element): boolean {
  if (element.hasAttribute("disabled")) return true
  if (element.getAttribute("aria-disabled") === "true") return true
  // A disabled fieldset disables everything inside it, which no attribute on
  // the control itself reports.
  return element.closest("fieldset[disabled]") !== null
}

export function isReadOnly(element: Element): boolean {
  return element.hasAttribute("readonly") || element.hasAttribute("readOnly")
}

/** The nearest label text an option or control is presented with. */
export function accessibleName(element: Element): string {
  const aria = element.getAttribute("aria-label")
  if (aria) return normalizeLabel(aria)
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const doc = element.ownerDocument
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => normalizeLabel(doc.getElementById(id)?.textContent))
      .filter((part) => part.length > 0)
    if (parts.length > 0) return parts.join(" ")
  }
  const id = element.getAttribute("id")
  if (id) {
    const escaped = id.replace(/["\\]/g, "\\$&")
    const explicit = element.ownerDocument.querySelector(
      `label[for="${escaped}"]`
    )
    const explicitText = normalizeLabel(explicit?.textContent)
    if (explicitText) return explicitText
  }
  const wrapping = element.closest("label")
  const wrappingText = normalizeLabel(wrapping?.textContent)
  if (wrappingText) return wrappingText
  const placeholder = element.getAttribute("placeholder")
  if (placeholder) return normalizeLabel(placeholder)
  const value = (element as HTMLInputElement).value
  if (typeof value === "string" && value) return normalizeLabel(value)
  return normalizeLabel(element.textContent)
}

export type OptionEntry = {
  element: Element
  label: string
  value: string | null
  selected: boolean
  disabled: boolean
}

/**
 * The options a control currently offers, in document order. A select owns its
 * options; radio and checkbox groups are their same-named peers; a listbox owns
 * role=option descendants, plus the container it names with aria-controls,
 * because a combobox portal usually lives outside the control subtree.
 */
export function optionEntries(control: Element): OptionEntry[] {
  const tag = control.tagName.toLowerCase()
  if (tag === "select") {
    return [...control.querySelectorAll("option")].map((option) => ({
      element: option,
      label:
        normalizeLabel(option.textContent) ||
        option.getAttribute("value") ||
        "",
      value: option.getAttribute("value"),
      selected: (option as HTMLOptionElement).selected,
      disabled: isDisabled(option),
    }))
  }
  const role = control.getAttribute("role")
  if (role === "listbox" || role === "combobox") {
    const doc = control.ownerDocument
    const owns = (control.getAttribute("aria-controls") ?? "")
      .split(/\s+/)
      .filter((id) => id.length > 0)
      .map((id) => doc.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    const roots = [control, ...owns]
    return roots.flatMap((root) =>
      [
        ...root.querySelectorAll(
          '[role="option"],[role="radio"],[role="checkbox"],[role="menuitemradio"]'
        ),
      ].map((option) => ({
        element: option,
        label: accessibleName(option),
        value: option.getAttribute("data-value"),
        selected:
          option.getAttribute("aria-selected") === "true" ||
          option.getAttribute("aria-checked") === "true",
        disabled: isDisabled(option),
      }))
    )
  }
  const type = (control as HTMLInputElement).type
  if (type === "radio" || type === "checkbox") {
    const name = control.getAttribute("name")
    if (!name) {
      return [
        {
          element: control,
          label: accessibleName(control),
          value: (control as HTMLInputElement).value || null,
          selected: (control as HTMLInputElement).checked,
          disabled: isDisabled(control),
        },
      ]
    }
    const scope = control.closest("form") ?? control.ownerDocument
    const escaped = name.replace(/["\\]/g, "\\$&")
    return [...scope.querySelectorAll(`input[name="${escaped}"]`)].map(
      (input) => ({
        element: input,
        label: accessibleName(input),
        value: (input as HTMLInputElement).value || null,
        selected: (input as HTMLInputElement).checked,
        disabled: isDisabled(input),
      })
    )
  }
  return []
}

/**
 * A control that submits the form is never one this engine clicks. An untyped
 * button defaults to submit, so it is refused too: the missing attribute is not
 * evidence that it is safe. So is anything that navigates, because changing the
 * page is the user's to do, and so is a button whose own wording is one of the
 * words that ends an application.
 */
const BLOCKED_WORDING =
  /^(submit|submit application|apply|apply now|send|send application|continue|next|next step|finish|save and continue|review and submit|log in|sign in|create account)$/i

/** Roles that act when they are activated, whatever tag carries them. */
const ACTIVATABLE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemradio",
  "tab",
])

/** Tags that act when they are activated, whatever role they claim. */
const ACTIVATABLE_TAGS = new Set(["a", "button", "input", "summary"])

export function looksLikeSubmit(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute("role")
  // An address means the element goes somewhere, and a link role is the same
  // claim in another tag. A record container does not navigate.
  if (element.hasAttribute("href") || role === "link") return true
  if (tag === "input") {
    const type = (element as HTMLInputElement).type
    if (type === "submit" || type === "image") return true
    // A button input does not submit by default, but its wording is the same
    // promise as a button's, so it is read the same way.
    if (type === "button") return BLOCKED_WORDING.test(accessibleName(element))
    return false
  }
  if (tag === "button") {
    const type = element.getAttribute("type")
    if (type !== "button") return true
    return BLOCKED_WORDING.test(accessibleName(element))
  }
  if (
    ACTIVATABLE_TAGS.has(tag) ||
    (role !== null && ACTIVATABLE_ROLES.has(role))
  )
    return BLOCKED_WORDING.test(accessibleName(element))
  return false
}

/** Live value or checked state, from the widget rather than from markup. */
export function readValue(element: Element): string | null {
  const field = element as HTMLInputElement
  if (typeof field.value === "string") return field.value
  const aria = element.getAttribute("aria-valuetext")
  if (aria !== null) return aria
  const text = element.textContent
  return text === null ? null : normalizeLabel(text)
}

export function readChecked(element: Element): boolean | null {
  const field = element as HTMLInputElement
  if (typeof field.checked === "boolean") return field.checked
  const aria = element.getAttribute("aria-checked")
  if (aria === "true") return true
  if (aria === "false") return false
  return null
}

/** Children of the container this control names, if it names one. */
export function controlledChildCount(control: Element): number | null {
  const ids = (control.getAttribute("aria-controls") ?? "")
    .split(/\s+/)
    .filter((id) => id.length > 0)
  if (ids.length === 0) return null
  const doc = control.ownerDocument
  let total = 0
  for (const id of ids) {
    const container = doc.getElementById(id)
    if (!container) return null
    total += container.children.length
  }
  return total
}

/**
 * Wait for the control to reach the state the write asked for, without a fixed
 * delay for every field: read once, then poll until the condition holds or the
 * budget is spent. The budget is what stops a widget that never settles.
 */
export async function settle<T>(
  read: () => T,
  done: (value: T) => boolean,
  budgetMs: number
): Promise<T> {
  const first = read()
  if (done(first) || budgetMs <= 0) return first
  const started = Date.now()
  let latest = first
  while (Date.now() - started < budgetMs) {
    await new Promise((resolve) => setTimeout(resolve, RUNTIME_SETTLE_POLL_MS))
    latest = read()
    if (done(latest)) return latest
  }
  return latest
}

/**
 * How far above a control the site's own attachment state is looked for. A
 * chip or an error is rendered near the field it belongs to, so searching
 * further would start reading another field's state.
 */
const ATTACHMENT_SCOPE_DEPTH = 3
/** Elements examined per scope, so a large form cannot turn this into a scan. */
const ATTACHMENT_SCAN_LIMIT = 400

/**
 * The state the site itself exposes for an attachment, or null when it shows
 * none. The file list is a local handoff and is never evidence: a label the
 * site renders, or an error it marks on the field, is state the page owns.
 *
 * Scopes are read innermost first and the first one with a signal decides, so
 * a form-level error cannot be read as this field's, and a chip cannot be read
 * from another field's wrapper.
 */
export function attachmentStateNear(
  element: Element,
  fileName: string
): "accepted" | "rejected" | null {
  const wanted = normalizeLabel(fileName)
  if (!wanted) return null
  if (element.getAttribute("aria-invalid") === "true") return "rejected"
  let scope: Element | null = element.parentElement
  for (let depth = 1; depth <= ATTACHMENT_SCOPE_DEPTH && scope; depth += 1) {
    const state = attachmentStateIn(scope, element, wanted)
    if (state) return state
    scope = scope.parentElement
  }
  return null
}

function attachmentStateIn(
  scope: Element,
  control: Element,
  wanted: string
): "accepted" | "rejected" | null {
  let labelled = false
  const found = scope.querySelectorAll("*")
  const limit = Math.min(found.length, ATTACHMENT_SCAN_LIMIT)
  for (let index = 0; index < limit; index += 1) {
    const candidate = found[index]
    if (!candidate) continue
    // The control and its ancestors carry the field itself, not its state.
    if (candidate === control || candidate.contains(control)) continue
    if (candidate.hasAttribute("hidden")) continue
    if (candidate.getAttribute("aria-hidden") === "true") continue
    if (isErrorMarker(candidate)) return "rejected"
    if (names(candidate, wanted)) labelled = true
  }
  return labelled ? "accepted" : null
}

/**
 * Whether the field's own surroundings already show a file. The input can be
 * empty while the site still holds one, which is ordinary: a site takes the
 * file, keeps it on its own side, and clears the input. The name cannot be
 * compared here, because the name is exactly what is missing, so the shape of
 * a file name stands in for it.
 */
export function attachmentPresentNear(element: Element): boolean {
  let scope: Element | null = element.parentElement
  for (let depth = 1; depth <= ATTACHMENT_SCOPE_DEPTH && scope; depth += 1) {
    if (scopeShowsFile(scope, element)) return true
    scope = scope.parentElement
  }
  return false
}

/**
 * A file name as a site renders one: a single token ending in an extension,
 * with an optional size in brackets after it. Deliberately strict, because a
 * format hint is the cheap way to be wrong: "PDF, DOCX" and "Accepted: .pdf,
 * .docx" both fail on their separators, and reading a hint as a held file would
 * refuse a first upload the applicant is entitled to make.
 */
const ATTACHMENT_NAME_SHAPE = /^[^\s/\\]{2,}\.[a-z0-9]{2,5}$/i

function looksLikeFileName(text: string): boolean {
  const bare = text.replace(/\s*[([].*$/, "").trim()
  return ATTACHMENT_NAME_SHAPE.test(bare)
}

function scopeShowsFile(scope: Element, control: Element): boolean {
  const found = scope.querySelectorAll("*")
  const limit = Math.min(found.length, ATTACHMENT_SCAN_LIMIT)
  for (let index = 0; index < limit; index += 1) {
    const candidate = found[index]
    if (!candidate) continue
    // The control and its ancestors carry the field itself, not its state.
    if (candidate === control || candidate.contains(control)) continue
    if (candidate.hasAttribute("hidden")) continue
    if (candidate.getAttribute("aria-hidden") === "true") continue
    if (looksLikeFileName(ownText(candidate))) return true
    const aria = normalizeLabel(candidate.getAttribute("aria-label"))
    if (looksLikeFileName(aria)) return true
  }
  return false
}

/**
 * An error the site marked on this field. `aria-live` alone is not one: sites
 * announce progress and success through the same region, and reading that as a
 * failure would be wrong more often than right.
 */
function isErrorMarker(element: Element): boolean {
  const alert = element.getAttribute("role") === "alert"
  const invalid = element.getAttribute("aria-invalid") === "true"
  if (!alert && !invalid) return false
  return ownText(element) !== "" || invalid
}

/** The element's own text, never its subtree: a container says nothing itself. */
function ownText(element: Element): string {
  let text = ""
  for (const node of element.childNodes)
    if (node.nodeType === 3) text += node.nodeValue ?? ""
  return normalizeLabel(text)
}

function names(element: Element, wanted: string): boolean {
  if (normalizeLabel(element.getAttribute("aria-label")) === wanted) return true
  return ownText(element) === wanted
}

/**
 * The local handoff for an upload: bytes in, a FileList on the input. This is
 * not evidence the site accepted anything, only that the page was handed the
 * file, which is why the caller reports it as unresolved.
 */
export function buildFile(
  element: Element,
  file: { name: string; type: string; sizeBytes: number; base64: string }
): File | null {
  const win = realmOf(element)
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const binary = win.atob(file.base64)
    bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index)
  } catch {
    return null
  }
  if (bytes.length !== file.sizeBytes) return null
  if (file.type !== "application/pdf") return null
  // A PDF that does not start with %PDF- is not the file that was rendered,
  // whatever its length claims.
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]
  if (magic.some((byte, index) => bytes[index] !== byte)) return null
  return new win.File([bytes], file.name, { type: file.type })
}

export function applyFiles(element: Element, files: File[]): boolean {
  const win = realmOf(element)
  const input = element as HTMLInputElement
  const DataTransferConstructor = (
    win as Window & { DataTransfer?: typeof DataTransfer }
  ).DataTransfer
  if (typeof DataTransferConstructor === "function") {
    try {
      const transfer = new DataTransferConstructor()
      for (const file of files) transfer.items.add(file)
      input.files = transfer.files
      if (currentFiles(element).length === files.length) return true
    } catch {
      // Fall through: the property is defined instead.
    }
  }
  try {
    // Defined rather than assigned, so a property a framework made non-writable
    // does not silently drop the file, and configurable so a later upload can
    // replace it.
    Object.defineProperty(input, "files", {
      value: asFileList(files),
      configurable: true,
    })
  } catch {
    return false
  }
  return currentFiles(element).length === files.length
}

/** Reads as a FileList does: length plus item, which is all currentFiles uses. */
function asFileList(files: File[]): {
  length: number
  item(index: number): File | null
} {
  return {
    length: files.length,
    item: (index) => files[index] ?? null,
  }
}

export function currentFiles(element: Element): File[] {
  const files = (element as HTMLInputElement).files
  if (!files) return []
  const list: File[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files.item(index)
    if (file) list.push(file)
  }
  return list
}
