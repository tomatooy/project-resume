import { vi } from "vitest"
import type {
  CdpMethod,
  CdpParams,
  CdpTransport,
} from "../../src/dom-agent/cdp"
import type { AxNode, DomNode } from "../../src/dom-agent/observation-payload"
import { DriverSession } from "../../src/dom-agent/session"
import { createDebuggerHarness } from "./chrome-debugger"

/**
 * A page, as the protocol would report it.
 *
 * The reader is written against protocol payloads, so testing it means
 * producing those payloads from markup a person can read. This builds the DOM
 * tree and the accessibility tree in one traversal, so both name the same
 * element with the same backend id, which is the join the reader depends on.
 *
 * Nothing here uses `instanceof`: jsdom gives an iframe its own realm, so frame
 * content is not an instance of the outer window's constructors. Structure is
 * read from the node instead.
 *
 * This is a stand-in until ticket 05 records real captures from the acceptance
 * sites. It models what the reader reads, not everything Chrome reports.
 */

const IMPLICIT_ROLES: Record<string, string> = {
  a: "link",
  article: "article",
  aside: "complementary",
  button: "button",
  fieldset: "group",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  header: "banner",
  label: "label",
  legend: "legend",
  li: "listitem",
  main: "main",
  nav: "navigation",
  ol: "list",
  option: "option",
  p: "paragraph",
  section: "region",
  select: "combobox",
  table: "table",
  td: "cell",
  textarea: "textbox",
  th: "columnheader",
  tr: "row",
  ul: "list",
}

const INPUT_ROLES: Record<string, string> = {
  checkbox: "checkbox",
  date: "date",
  email: "textbox",
  file: "button",
  month: "date",
  number: "spinbutton",
  radio: "radio",
  search: "searchbox",
  tel: "textbox",
  text: "textbox",
  url: "textbox",
}

type AxProperty = { name: string; value: { type: string; value: unknown } }

/** An element as this double needs it, without depending on its realm. */
type ElementLike = Node & {
  tagName: string
  attributes: NamedNodeMap
  shadowRoot: ShadowRoot | null
  getAttribute(name: string): string | null
  closest(selector: string): Element | null
}

function isElementLike(node: Node): node is ElementLike {
  return node.nodeType === 1 && "attributes" in node && "tagName" in node
}

function isTag(node: Node, tag: string): boolean {
  return node.nodeName.toLowerCase() === tag
}

function hasProperty<K extends string>(
  node: Node,
  name: K
): node is Node & Record<K, unknown> {
  return node.nodeType === 1 && name in node
}

function axValue(
  value: unknown,
  type = "string"
): { type: string; value: unknown } {
  return { type, value }
}

function booleanValue(value: boolean): { type: string; value: unknown } {
  return axValue(value, "boolean")
}

function textOf(node: Node): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim()
}

function attributesOf(element: ElementLike): Map<string, string> {
  const map = new Map<string, string>()
  for (const attribute of Array.from(element.attributes))
    map.set(attribute.name, attribute.value)
  return map
}

/** The subset of the accessible name computation the reader's tests need. */
function accessibleName(element: ElementLike, root: SelectorScope): string {
  const attributes = attributesOf(element)
  const tag = element.tagName.toLowerCase()
  const labelledBy = attributes.get("aria-labelledby")
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => root.querySelector(`#${CSS.escape(id)}`))
      .map((target) => (target ? textOf(target) : ""))
      .filter(Boolean)
    if (parts.length > 0) return parts.join(" ")
  }
  const ariaLabel = attributes.get("aria-label")
  if (ariaLabel) return ariaLabel

  const id = attributes.get("id")
  if (id) {
    const explicit = root.querySelector(`label[for="${CSS.escape(id)}"]`)
    if (explicit) {
      const text = textOf(explicit)
      if (text) return text
    }
  }
  const wrapping = element.closest("label")
  if (wrapping) {
    const text = textOf(wrapping)
    if (text) return text
  }
  if (
    [
      "button",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "option",
      "legend",
    ].includes(tag)
  ) {
    const text = textOf(element)
    if (text) return text
  }
  const placeholder = attributes.get("placeholder")
  if (placeholder) return placeholder
  return attributes.get("title") ?? ""
}

function roleOf(element: ElementLike): string {
  const tag = element.tagName.toLowerCase()
  const declared = element.getAttribute("role")
  if (declared) return declared
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase()
    if (type === "hidden" || type === "password") return "none"
    return INPUT_ROLES[type] ?? "textbox"
  }
  if (tag === "select")
    return hasProperty(element, "multiple") && element.multiple === true
      ? "listbox"
      : "combobox"
  return IMPLICIT_ROLES[tag] ?? "generic"
}

export type BuiltPage = {
  dom: DomNode
  ax: AxNode[]
  /** Every element behind an id, for tests that assert on a specific one. */
  elements: Map<number, ElementLike>
}

/** The minimum a document, shadow root or element offers for a scoped lookup. */
type SelectorScope = { querySelector(selectors: string): Element | null }

function isSelectorScope(node: Node): node is Node & SelectorScope {
  return "querySelector" in node
}

function isDocumentLike(value: unknown): value is Document {
  return (
    typeof value === "object" &&
    value !== null &&
    "documentElement" in value &&
    "childNodes" in value
  )
}

/** The nearest root a selector should search: document, shadow root, or node. */
function scopeOf(node: Node): SelectorScope {
  return isSelectorScope(node) ? node : document
}

/**
 * Build the DOM and accessibility trees for a node. Ids are assigned in one
 * traversal and shared by both trees, which is what makes the join work.
 */
export function buildPageFrom(node: Node): BuiltPage {
  const ax: AxNode[] = []
  const elements = new Map<number, ElementLike>()
  let counter = 0

  const visit = (current: Node, scope: SelectorScope): DomNode => {
    counter += 1
    const id = counter

    if (current.nodeType === 3) {
      return {
        backendNodeId: id,
        nodeType: 3,
        nodeName: "#text",
        nodeValue: current.nodeValue ?? "",
      }
    }
    if (current.nodeType === 9 || current.nodeType === 11) {
      const inner = scopeOf(current)
      const children = Array.from(current.childNodes).map((child) =>
        visit(child, inner)
      )
      return {
        backendNodeId: id,
        nodeType: current.nodeType,
        nodeName: current.nodeType === 9 ? "#document" : "#document-fragment",
        childNodeCount: children.length,
        children,
      }
    }
    if (!isElementLike(current)) {
      return {
        backendNodeId: id,
        nodeType: current.nodeType,
        nodeName: current.nodeName,
      }
    }

    const element = current
    elements.set(id, element)
    const attributes = attributesOf(element)
    const children = Array.from(element.childNodes).map((child) =>
      visit(child, scope)
    )

    const shadowRoots: DomNode[] = []
    if (element.shadowRoot) {
      const shadow = element.shadowRoot
      const shadowChildren = Array.from(shadow.childNodes).map((child) =>
        visit(child, shadow)
      )
      counter += 1
      shadowRoots.push({
        backendNodeId: counter,
        nodeType: 11,
        nodeName: "#document-fragment",
        shadowRootType: "open",
        childNodeCount: shadowChildren.length,
        children: shadowChildren,
      })
    }

    let contentDocument: DomNode | undefined
    if (isTag(element, "iframe") && hasProperty(element, "contentDocument")) {
      const inner: unknown = element.contentDocument
      if (isDocumentLike(inner) && inner.documentElement) {
        contentDocument = visit(inner, scopeOf(inner))
        contentDocument.frameId = `frame-${id}`
      }
    }

    const properties: AxProperty[] = []
    const required =
      attributes.has("required") || attributes.get("aria-required") === "true"
    if (required)
      properties.push({ name: "required", value: booleanValue(true) })
    if (hasProperty(element, "checked") && element.checked === true)
      properties.push({ name: "checked", value: booleanValue(true) })
    if (hasProperty(element, "disabled") && element.disabled === true)
      properties.push({ name: "disabled", value: booleanValue(true) })
    if (hasProperty(element, "readOnly") && element.readOnly === true)
      properties.push({ name: "readonly", value: booleanValue(true) })
    if (
      isTag(element, "option") &&
      hasProperty(element, "selected") &&
      element.selected === true
    )
      properties.push({ name: "selected", value: booleanValue(true) })
    if (
      isTag(element, "select") &&
      hasProperty(element, "multiple") &&
      element.multiple === true
    )
      properties.push({ name: "multiselectable", value: booleanValue(true) })
    if (attributes.get("aria-expanded") === "true")
      properties.push({ name: "expanded", value: booleanValue(true) })
    if (attributes.get("aria-disabled") === "true")
      properties.push({ name: "disabled", value: booleanValue(true) })

    const describedBy = attributes.get("aria-describedby")
    const description = describedBy
      ? describedBy
          .split(/\s+/)
          .map((value) => {
            const target = scope.querySelector(`#${CSS.escape(value)}`)
            return target ? textOf(target) : ""
          })
          .filter(Boolean)
          .join(" ")
      : ""

    const tag = element.tagName.toLowerCase()
    const live =
      hasProperty(element, "value") &&
      (tag === "input" || tag === "textarea" || tag === "select")
        ? String(element.value ?? "")
        : ""

    ax.push({
      nodeId: `ax${id}`,
      backendDOMNodeId: id,
      role: axValue(roleOf(element), "role"),
      name: axValue(accessibleName(element, scope)),
      ...(description ? { description: axValue(description) } : {}),
      ...(live ? { value: axValue(live) } : {}),
      ...(properties.length > 0 ? { properties } : {}),
    })

    return {
      backendNodeId: id,
      nodeType: 1,
      nodeName: element.tagName.toUpperCase(),
      attributes: Array.from(element.attributes).flatMap((attribute) => [
        attribute.name,
        attribute.value,
      ]),
      childNodeCount: children.length,
      children,
      ...(shadowRoots.length > 0 ? { shadowRoots } : {}),
      ...(contentDocument ? { contentDocument } : {}),
    }
  }

  const dom = visit(node, scopeOf(node))
  return { dom, ax, elements }
}

/**
 * Markup in a detached container, for the common case. Frames and shadow roots
 * need the live document, so those tests build their own node and pass it here.
 */
export function buildPage(html: string): BuiltPage {
  const host = document.createElement("div")
  host.innerHTML = html
  return buildPageFrom(host)
}

export type PageCommand = {
  sessionId: string | null
  method: CdpMethod
  params: CdpParams
}

export type PageTransport = {
  transport: CdpTransport
  commands: PageCommand[]
  /** Serve a document to one session: null is the tab's own document. */
  setDocument(sessionId: string | null, page: BuiltPage): void
  removeDocument(sessionId: string | null): void
  setAx(sessionId: string | null, nodes: AxNode[]): void
  /** Serve a `DOM.describeNode` result, addressed by browser id. */
  setDescribe(backendNodeId: number, node: DomNode): void
  fail(method: CdpMethod, message?: string, sessionId?: string | null): void
  methods(): string[]
}

/**
 * The reading half of the protocol, addressed by session. A missing document is
 * how an unreachable frame behaves, so it throws rather than returning empty.
 */
export function createPageTransport(): PageTransport {
  const commands: PageCommand[] = []
  const documents = new Map<string, BuiltPage>()
  const axTrees = new Map<string, AxNode[]>()
  const describes = new Map<number, DomNode>()
  const failures = new Map<string, string>()

  const keyOf = (sessionId: string | null): string => sessionId ?? "root"

  const transport: CdpTransport = {
    async send(
      sessionId: string | null,
      method: CdpMethod,
      params?: CdpParams
    ): Promise<unknown> {
      commands.push({ sessionId, method, params: params ?? {} })
      const key = keyOf(sessionId)
      const failure =
        failures.get(`${key}|${method}`) ?? failures.get(`*|${method}`)
      if (failure) throw new Error(failure)
      if (method === "DOM.getDocument") {
        const page = documents.get(key)
        if (!page) throw new Error(`No document for ${key}`)
        return { root: page.dom }
      }
      if (method === "Accessibility.getFullAXTree")
        return { nodes: axTrees.get(key) ?? documents.get(key)?.ax ?? [] }
      if (method === "DOM.describeNode") {
        const id = Number(params?.backendNodeId)
        const node = describes.get(id)
        if (!node) throw new Error(`No node ${id}`)
        return { node }
      }
      return {}
    },
  }

  return {
    transport,
    commands,
    setDocument: (sessionId, page) => {
      documents.set(keyOf(sessionId), page)
    },
    removeDocument: (sessionId) => {
      documents.delete(keyOf(sessionId))
    },
    setAx: (sessionId, nodes) => {
      axTrees.set(keyOf(sessionId), nodes)
    },
    setDescribe: (backendNodeId, node) => {
      describes.set(backendNodeId, node)
    },
    fail: (method, message = `${method} failed`, sessionId = null) => {
      failures.set(`${keyOf(sessionId)}|${method}`, message)
    },
    methods: () => commands.map((command) => command.method),
  }
}

/**
 * An attached session reading a scripted page. Chrome itself is the shared
 * debugger harness, so the session's own lifecycle handling is real.
 */
export async function attachPage(input?: {
  tabId?: number
  runId?: string
  transport?: PageTransport
}): Promise<{
  session: DriverSession
  page: PageTransport
  harness: ReturnType<typeof createDebuggerHarness>
}> {
  const tabId = input?.tabId ?? 1
  const page = input?.transport ?? createPageTransport()
  const harness = createDebuggerHarness(tabId)
  vi.stubGlobal("chrome", harness.chrome)
  const session = await DriverSession.attach({
    tabId,
    runId: input?.runId ?? "run-1",
    transport: page.transport,
  })
  return { session, page, harness }
}
