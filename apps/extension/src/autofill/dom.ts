export type PageRoot = Document | ShadowRoot
export const valueContentSelector =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"]'

export function parentOf(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

export function closestInPage(
  element: Element,
  selector: string
): HTMLElement | null {
  let current: Element | null = element
  while (current) {
    if (current instanceof HTMLElement && current.matches(selector))
      return current
    current = parentOf(current)
  }
  return null
}

export function referenced(element: Element, attribute: string): HTMLElement[] {
  const root = element.getRootNode()
  if (!(root instanceof Document || root instanceof ShadowRoot)) return []
  return (element.getAttribute(attribute) ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((id) => {
      const target =
        root.getElementById(id) ?? element.ownerDocument.getElementById(id)
      return target instanceof HTMLElement ? [target] : []
    })
}

export function isTextEditor(element: HTMLElement): boolean {
  return ["", "true", "plaintext-only"].includes(
    element.getAttribute("contenteditable") ?? "false"
  )
}

export function pageElements(
  root: Document | ShadowRoot | HTMLElement,
  selector = "*"
): HTMLElement[] {
  const result: HTMLElement[] = []
  const seen = new Set<Element>()
  const visit = (element: Element) => {
    if (
      seen.has(element) ||
      element.matches("[data-vs-autofill],script,style,noscript,template")
    )
      return
    seen.add(element)
    if (element instanceof HTMLElement && element.matches(selector))
      result.push(element)
    if (element.shadowRoot)
      for (const child of element.shadowRoot.children) visit(child)
    if (element instanceof HTMLSlotElement)
      for (const child of element.assignedElements({ flatten: true }))
        visit(child)
    for (const child of element.children) visit(child)
  }
  for (const child of root.children) visit(child)
  return result
}

export function contextText(element: Element): string {
  if (
    element.matches(valueContentSelector) ||
    element.matches("[data-vs-autofill],script,style,noscript,template")
  )
    return ""
  const parts: string[] = []
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? "")
    else if (child instanceof Element) parts.push(contextText(child))
  }
  return parts.join(" ").replace(/\s+/g, " ").trim()
}
