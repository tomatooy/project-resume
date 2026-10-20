import type { LIMITS as SHARED_LIMITS } from "@workspace/autofill/fields"

/**
 * The request limits the content script trims to, copied because `fields.ts`
 * loads Zod. `satisfies` keeps every value equal to the shared one.
 */
export const LIMITS = {
  fields: 200,
  label: 500,
  help: 2000,
  options: 300,
  option: 200,
} as const satisfies Pick<
  typeof SHARED_LIMITS,
  "fields" | "label" | "help" | "options" | "option"
>

const ID_MAX = 300

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const code = text.charCodeAt(max - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max)
}

const SKIPPED = new Set([
  "svg",
  "style",
  "script",
  "noscript",
  "template",
  "select",
  "textarea",
  "datalist",
])
const BLOCKS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tr",
  "ul",
])

function collect(node: Node, out: string[], top: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.nodeValue ?? "").replace(/\s+/g, " "))
    return
  }
  if (!(node instanceof Element)) return
  // A node named by aria-labelledby counts even when hidden; its hidden
  // children do not.
  if (
    !top &&
    (SKIPPED.has(node.localName) ||
      node.hasAttribute("hidden") ||
      node.getAttribute("aria-hidden") === "true")
  )
    return
  if (node.localName === "br") {
    out.push("\n")
    return
  }
  const block = BLOCKS.has(node.localName)
  if (block) out.push("\n")
  for (const child of node.childNodes) collect(child, out, false)
  if (block) out.push("\n")
}

/** Visible text with `<br>` and block elements as line breaks. */
export function textWithBreaks(node: Node): string {
  const out: string[] = []
  collect(node, out, true)
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")
}

/** jsdom has no layout, so this reads styles and attributes only. */
export function isShown(element: Element): boolean {
  if (
    element.getAttribute("aria-hidden") === "true" &&
    element.getAttribute("tabindex") === "-1"
  )
    return false
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden")) return false
    if (getComputedStyle(node).display === "none") return false
  }
  // Computed visibility is inherited, and a child may turn it back on.
  return getComputedStyle(element).visibility !== "hidden"
}

const tidy = (text: string): string =>
  clip(
    text
      .replace(/\s+/g, " ")
      .replace(/\s*\*+\s*$/, "")
      .trim(),
    LIMITS.label
  )

/** One line of label text without a trailing required marker. */
export function labelText(node: Element): string {
  return tidy(textWithBreaks(node).split("\n").join(" "))
}

function byIds(node: Element, ids: string | null): Element[] {
  if (!ids) return []
  const root = node.getRootNode()
  const scope =
    root instanceof Document || root instanceof ShadowRoot
      ? root
      : node.ownerDocument
  return ids.split(/\s+/).flatMap((id) => {
    const target = id ? scope.getElementById(id) : null
    return target ? [target] : []
  })
}

const labelsOf = (node: Element, attribute: string): string =>
  byIds(node, node.getAttribute(attribute))
    .map(labelText)
    .filter((text) => text !== "")
    .join(" ")

/** A `label[for]` names only the first element with that id. */
function forLabel(control: HTMLElement): HTMLLabelElement | null {
  const { id } = control
  if (!id || control.ownerDocument.getElementById(id) !== control) return null
  for (const label of control.ownerDocument.getElementsByTagName("label"))
    if (label.htmlFor === id) return label
  return null
}

/**
 * The label of a radio or checkbox group: the nearest `[role=group]` or
 * `[role=radiogroup]` with `aria-labelledby`, or `fieldset` with a `legend`.
 */
export function groupLabel(control: HTMLElement): string {
  for (let node = control.parentElement; node; node = node.parentElement) {
    const role = node.getAttribute("role")
    if (
      (role === "group" || role === "radiogroup") &&
      node.hasAttribute("aria-labelledby")
    )
      return labelsOf(node, "aria-labelledby")
    if (node.localName === "fieldset") {
      const legend = [...node.children].find(
        (child) => child.localName === "legend"
      )
      if (legend) return labelText(legend)
    }
  }
  return ""
}

/** `label[for]`, a wrapping `label`, then `aria-label`; how a choice is named. */
export function ownLabel(control: HTMLElement): string {
  const label = forLabel(control)
  const wrapping = control.closest("label")
  return (
    (label ? labelText(label) : "") ||
    (wrapping ? labelText(wrapping) : "") ||
    tidy(control.getAttribute("aria-label") ?? "")
  )
}

/**
 * The group label comes after the control's own labels: a fieldset's legend
 * would otherwise label every input inside it.
 */
export function labelFor(control: HTMLElement): string {
  return (
    labelsOf(control, "aria-labelledby") ||
    ownLabel(control) ||
    groupLabel(control) ||
    tidy(control.getAttribute("placeholder") ?? "")
  )
}

/** `aria-describedby` text, leaving out error messages. */
export function helpFor(control: HTMLElement): string | undefined {
  const ids = (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter((id) => id !== "" && !id.toLowerCase().includes("error"))
  const text = byIds(control, ids.join(" "))
    .map(textWithBreaks)
    .filter((part) => part !== "")
    .join("\n")
  return text ? clip(text, LIMITS.help) : undefined
}

/**
 * Sets the value through the prototype's setter, so a framework that wraps
 * the instance's `value` still sees the change, then fires the events a
 * person's edit would.
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  if (setter) setter.call(element, value)
  else element.value = value
  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  element.dispatchEvent(new FocusEvent("blur"))
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
}

/** `id`, else `name`, else the element's path from `root`. */
export function fieldId(control: HTMLElement, root: Element): string {
  if (control.id) return clip(control.id, ID_MAX)
  const name = control.getAttribute("name")
  if (name) return clip(name, ID_MAX)
  const path: string[] = []
  for (
    let node: Element | null = control;
    node && node !== root;
    node = node.parentElement
  ) {
    let n = 1
    for (
      let sibling = node.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    )
      if (sibling.localName === node.localName) n += 1
    path.unshift(`${node.localName}:nth-of-type(${n})`)
  }
  return clip(path.join(" > "), ID_MAX)
}

/** Later copies of an id get `~2`, `~3`, ..., still within 300 characters. */
export function uniqueIds(ids: string[]): string[] {
  const used = new Set<string>()
  const copies = new Map<string, number>()
  return ids.map((id) => {
    if (!used.has(id)) {
      used.add(id)
      return id
    }
    let n = copies.get(id) ?? 1
    let next = id
    while (used.has(next)) {
      n += 1
      const suffix = `~${n}`
      next = clip(id, ID_MAX - suffix.length) + suffix
    }
    copies.set(id, n)
    used.add(next)
    return next
  })
}

/** Polls `read` every 50 ms until it gives a value or the time runs out. */
export function waitFor<T>(
  read: () => T | null,
  timeoutMs: number
): Promise<T | null> {
  const end = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = () => {
      const value = read()
      if (value !== null) resolve(value)
      else if (Date.now() >= end) resolve(null)
      else setTimeout(tick, 50)
    }
    tick()
  })
}
