import {
  type Constraints,
  type CoverageGap,
  DOM_AGENT_LIMITS,
  type Observation,
  type ObservationContext,
  type ObservationNode,
  type ObservationRegion,
  type ObservedControl,
  type ObservedOption,
  observationCoverage,
  type Requiredness,
} from "@workspace/resume-core/dom-agent"
import type { DriverSession } from "./session"
import {
  attributeMap,
  AxTreeSchema,
  axBoolean,
  type AxNode,
  axText,
  DomDocumentSchema,
  type DomNode,
  DomNodeResultSchema,
} from "./observation-payload"

/**
 * The page reader.
 *
 * Everything here is a read. It walks the DOM tree and the accessibility tree,
 * joins them by browser node identity, and reports what it could not read as an
 * explicit gap. It never falls back to a second reader, so a page it could not
 * read completely says so, and the audit refuses `ready`.
 *
 * Two passes on purpose. The first decides what is worth keeping and stops at
 * context boundaries. The second assigns references top-down, so a reference
 * always belongs to a context and a parent reference never dangles.
 */

const CONTROL_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "spinbutton",
  "radio",
  "checkbox",
  "switch",
])

const GROUP_ROLES = new Set([
  "radiogroup",
  "group",
  "listbox",
  "tabpanel",
  "form",
  "region",
])

const REGION_TAGS = new Set(["form", "fieldset", "main", "section"])

const ERROR_ROLES = new Set(["alert", "alertdialog", "status"])

const REQUIRED_INSTRUCTION = /\brequired\b|\bmandatory\b/i
const OPTIONAL_INSTRUCTION = /\boptional\b/i

/** Never read, and counted as a gap, so the completeness number stays honest. */
const CREDENTIAL_AUTOCOMPLETE =
  /^(?:current-password|new-password|one-time-code|cc-.+|webauthn)$/i
const CREDENTIAL_NAME =
  /pass(?:word|code)|otp|one.?time|token|secret|captcha|recaptcha|cvv|cvc|card.?number|credit.?card|security.?code/i

const MAX_TEXT = 2000
const MAX_LABEL = 400
const MAX_OPTIONS = 200
const MAX_PLAN_DEPTH = 40
/** How deep a frame or open shadow root is followed before it is reported. */
const MAX_ROOT_DEPTH = 10
/** How deep an option list is walked before the rest is reported unread. */
const MAX_OPTION_DEPTH = 6
/** How far from a choice element its group container is looked for. */
const CHOICE_CONTAINER_DEPTH = 3
/** How deep under a choices container the field it submits is looked for. */
const HIDDEN_FIELD_DEPTH = 3

/** Derived, so the evidence vocabulary stays owned by the shared schema. */
type RequirednessEvidence = Requiredness["evidence"][number]

/**
 * Where an observation-local reference points in the browser. Kept beside the
 * observation because it must never be serialized into it: a node reference is
 * valid only for the generation that produced it.
 */
export type NodeIdentity = {
  contextId: string
  sessionId: string | null
  backendNodeId: number
  frameId: string | null
}

/** Reference to browser identity, both ways. */
export class NodeIndex {
  private readonly byRef = new Map<string, NodeIdentity>()
  private readonly byIdentity = new Map<string, string>()

  add(ref: string, identity: NodeIdentity): void {
    this.byRef.set(ref, identity)
    this.byIdentity.set(`${identity.contextId}|${identity.backendNodeId}`, ref)
  }

  resolve(ref: string): NodeIdentity | undefined {
    return this.byRef.get(ref)
  }

  /** The reference a browser identity was given in this observation, if any. */
  refFor(contextId: string, backendNodeId: number): string | undefined {
    return this.byIdentity.get(`${contextId}|${backendNodeId}`)
  }
}

/** What the shared observation shape cannot carry about a control. */
export type ControlEvidence = {
  requiredness: Requiredness
  /** Original wording as authored, before any computed name. */
  labelText: string
  description: string | null
  /** What the page states about the shape of an answer to this control. */
  constraints: Constraints
  /** The option list lives outside this subtree and must be read on request. */
  portal: boolean
}

export type PageRead = {
  observation: Observation
  index: NodeIndex
  /** nodeRef to evidence. Requiredness is decided here and carried by 06. */
  evidence: Map<string, ControlEvidence>
  /** nodeRef to the repeated-record container it belongs to. */
  records: Map<string, string>
  /** nodeRef to the region that contains it. */
  regions: Map<string, string>
}

export type PageFragment = {
  nodes: ObservationNode[]
  regions: ObservationRegion[]
  coverage: Observation["coverage"]
  index: NodeIndex
  evidence: Map<string, ControlEvidence>
}

/** A context the run reaches, with the session context its reads go through. */
type Context = {
  id: string
  kind: "document" | "frame" | "shadow_root"
  sessionId: string | null
  frameId: string | null
  url: string | null
  generation: string
}

/** One DOM read, indexed once so label lookups never rescan the tree. */
type Source = {
  ids: Map<string, DomNode>
  labelsFor: Map<string, DomNode[]>
  byBackendId: Map<number, DomNode>
  ax: Map<number, AxNode>
  describedIds: Set<string>
  /** Elements another control names as holding its options. */
  portalIds: Set<string>
}

type Root = { context: Context; node: DomNode; source: Source }

type Grouped = {
  anchor: DomNode
  members: DomNode[]
  kind: "radio_group" | "checkbox_group" | "button_choice"
  container: DomNode | null
  /**
   * The field a button group submits through, when the page keeps a hidden one
   * inside the choices. It carries the value rather than wording, so it is never
   * a question of its own.
   */
  field: DomNode | null
}

type GroupTables = {
  /** Every member of a grouped set, so a member is never its own question. */
  members: Set<number>
  anchors: Map<number, Grouped>
  byMember: Map<number, Grouped>
  /** The hidden fields the groups submit through, never questions themselves. */
  fields: Set<number>
}

/** What the first pass decides to keep. */
type Plan = {
  dom: DomNode
  context: Context
  kind: ObservationNode["kind"]
  tag: string
  role: string | null
  name: string | null
  text: string | null
  control: ObservedControl | null
  /**
   * The DOM node behind each of `control.options`, in the same order. Carried
   * so the second pass can give every option a reference: an option with no
   * reference could never be chosen, and the staleness check would have nothing
   * to compare.
   */
  optionNodes: DomNode[]
  evidence: ControlEvidence | null
  region: boolean
  regionLabel: string | null
  record: boolean
  children: Plan[]
  kinds: string[]
}

/** Only what a first pass needs to carry down a subtree. */
type PlanFlags = {
  source: Source
  groups: GroupTables
  keepText: boolean
  groupText: string
  groupRequired: boolean
  /** Counted, because an excluded field is a fact the user should see. */
  excludedCredentials: { count: number }
  /** Counted, because a subtree dropped at the depth ceiling is a gap. */
  depthCapped: { count: number }
  /** Counted, because a subtree the read itself cut short is a gap. */
  truncated: { count: number }
  /** Counted, because an option nobody can choose is a gap in the list. */
  optionIdentity: { count: number }
}

type BuildState = {
  nodes: ObservationNode[]
  evidence: Map<string, ControlEvidence>
  index: NodeIndex
  gaps: CoverageGap[]
  records: Map<string, string>
  regions: Map<string, string>
  regionLabels: Map<string, string>
  regionMembers: Map<string, string[]>
  refCounter: number
  recordCounter: number
}

function clamp(
  value: string | null | undefined,
  max = MAX_TEXT
): string | null {
  if (value === null || value === undefined) return null
  const collapsed = value.replace(/\s+/g, " ").trim()
  if (!collapsed) return null
  return collapsed.length > max ? collapsed.slice(0, max) : collapsed
}

function tagOf(node: DomNode): string {
  return node.nodeName.toLowerCase()
}

function isElement(node: DomNode): boolean {
  return node.nodeType === 1
}

function isTextNode(node: DomNode): boolean {
  return node.nodeType === 3
}

/**
 * True when the read returned fewer children than the node declares. The read is
 * bounded, so a node at the bound arrives with its count and no children, and
 * that count is the only evidence anything under it exists at all.
 */
function childrenCut(node: DomNode): boolean {
  return (node.childNodeCount ?? 0) > (node.children ?? []).length
}

function attributeOrNull(
  attributes: Map<string, string>,
  name: string
): string | null {
  return attributes.get(name) ?? null
}

/** Our own widget host hides in a closed shadow root, so it is cut by its mark. */
function isExtensionUi(attributes: Map<string, string>): boolean {
  return attributes.has("data-vs-autofill")
}

function isExtensionUrl(url: string | null): boolean {
  return url?.startsWith("chrome-extension://") === true
}

/**
 * Fields this engine must never read or fill. Excluded and counted, never
 * silently dropped: the user should see that something was left alone.
 */
function isCredential(tag: string, attributes: Map<string, string>): boolean {
  if (
    tag === "input" &&
    (attributes.get("type") ?? "").toLowerCase() === "password"
  )
    return true
  const autocomplete = attributes.get("autocomplete")
  if (autocomplete && CREDENTIAL_AUTOCOMPLETE.test(autocomplete.trim()))
    return true
  return CREDENTIAL_NAME.test(
    `${attributes.get("name") ?? ""} ${attributes.get("id") ?? ""}`
  )
}

function textOf(node: DomNode, depth = 0): string {
  if (depth > 16) return ""
  if (isTextNode(node)) return node.nodeValue ?? ""
  const tag = isElement(node) ? tagOf(node) : ""
  if (tag === "script" || tag === "style" || tag === "noscript") return ""
  const parts: string[] = []
  for (const child of node.children ?? []) parts.push(textOf(child, depth + 1))
  return parts.join(" ")
}

/**
 * Pseudo-element text, where a CSS required marker usually lives. A `*` painted
 * by `::before` is real evidence even though the node is not a node.
 */
function markerText(node: DomNode): string {
  const parts: string[] = []
  for (const child of node.children ?? [])
    if (child.pseudoType !== undefined) parts.push(child.nodeValue ?? "")
  return parts.join(" ")
}

function controlKindFor(
  tag: string,
  attributes: Map<string, string>,
  role: string | null
): ObservedControl["kind"] {
  const type = (attributes.get("type") ?? "").toLowerCase()
  if (tag === "textarea") return "long_text"
  if (tag === "select")
    return attributes.has("multiple") ? "checkbox_group" : "select"
  if (tag === "input") {
    switch (type) {
      case "email":
        return "email"
      case "tel":
        return "tel"
      case "url":
        return "url"
      case "number":
        return "number"
      case "date":
        return "date"
      case "month":
        return "month"
      case "file":
        return "file"
      case "checkbox":
        return "checkbox"
      case "radio":
        return "radio_group"
      case "hidden":
        return "unknown"
      default:
        return "text"
    }
  }
  // A custom widget has no native kind, so the accessibility role is the only
  // honest signal left.
  switch (role) {
    case "combobox":
      return "combobox"
    case "listbox":
      return "select"
    case "spinbutton":
      return "number"
    case "radio":
      return "radio_group"
    case "checkbox":
    case "switch":
      return "checkbox"
    case "textbox":
    case "searchbox":
      return "text"
    default:
      return "unknown"
  }
}

function isControlNode(
  tag: string,
  attributes: Map<string, string>,
  role: string | null
): boolean {
  if (tag === "textarea" || tag === "select") return true
  if (tag === "input") {
    const type = (attributes.get("type") ?? "text").toLowerCase()
    return !["hidden", "submit", "button", "reset", "image"].includes(type)
  }
  if (attributes.has("contenteditable")) return true
  const declared = attributes.get("role")
  if (declared !== undefined && CONTROL_ROLES.has(declared)) return true
  return role !== null && CONTROL_ROLES.has(role)
}

function isRegionNode(
  tag: string,
  attributes: Map<string, string>,
  role: string | null
): boolean {
  if (tag === "fieldset" || tag === "form") return true
  if (role !== null && GROUP_ROLES.has(role)) return true
  return REGION_TAGS.has(tag) && attributes.has("aria-label")
}

/**
 * The nearest label the page authors for a control. ARIA wins over native
 * markup, the order the accessible name computation uses.
 */
function labelTextFor(
  node: DomNode,
  source: Source,
  attributes: Map<string, string>
): string {
  const labelledBy = attributes.get("aria-labelledby")
  if (labelledBy) {
    const parts: string[] = []
    for (const id of labelledBy.split(/\s+/)) {
      const target = source.ids.get(id)
      if (target) parts.push(textOf(target))
    }
    const text = clamp(parts.join(" "), MAX_LABEL)
    if (text) return text
  }
  const ariaLabel = clamp(attributeOrNull(attributes, "aria-label"), MAX_LABEL)
  if (ariaLabel) return ariaLabel

  const id = attributes.get("id")
  if (id) {
    const explicit = source.labelsFor.get(id) ?? []
    const text = clamp(
      explicit.map((label) => textOf(label)).join(" "),
      MAX_LABEL
    )
    if (text) return text
  }
  const wrapped = wrappingLabel(node, 0)
  if (wrapped) {
    const text = clamp(textOf(wrapped), MAX_LABEL)
    if (text) return text
  }
  // A placeholder and a title are wording the page authored, so this reader may
  // use them. They come after the label sources, because a real label is what a
  // person reads for the field; both are page text, unlike the computed name.
  const placeholder = clamp(
    attributeOrNull(attributes, "placeholder"),
    MAX_LABEL
  )
  if (placeholder) return placeholder
  return clamp(attributeOrNull(attributes, "title"), MAX_LABEL) ?? ""
}

/** A label that wraps the control is the other native way to author one. */
function wrappingLabel(node: DomNode, depth: number): DomNode | null {
  if (depth > 8 || !node.children) return null
  for (const child of node.children) {
    if (!isElement(child)) continue
    if (tagOf(child) === "label") return child
    const nested = wrappingLabel(child, depth + 1)
    if (nested) return nested
  }
  return null
}

function describedText(
  attributes: Map<string, string>,
  source: Source,
  ax: AxNode | undefined
): string | null {
  const describedBy = attributes.get("aria-describedby")
  if (describedBy) {
    const parts: string[] = []
    for (const id of describedBy.split(/\s+/)) {
      const target = source.ids.get(id)
      if (target) parts.push(textOf(target))
    }
    const text = clamp(parts.join(" "), MAX_LABEL)
    if (text) return text
  }
  return clamp(axText(ax?.description), MAX_LABEL)
}

/**
 * What the page states about an acceptable answer. Read from the control's own
 * attributes, so a value the page would refuse is knowable before a write
 * rather than discovered by the page rejecting it.
 */
function constraintsOf(attributes: Map<string, string>): Constraints {
  const declared = Number.parseInt(attributes.get("maxlength") ?? "", 10)
  return {
    maxLength: Number.isFinite(declared) && declared > 0 ? declared : null,
    pattern: clamp(attributeOrNull(attributes, "pattern"), 500),
    // As authored: numeric for a number input, ISO for a date or month input.
    min: clamp(attributeOrNull(attributes, "min"), 100),
    max: clamp(attributeOrNull(attributes, "max"), 100),
    inputMode: clamp(attributeOrNull(attributes, "inputmode"), 40),
  }
}

/**
 * Requiredness with its evidence. Only an explicit declaration makes a control
 * optional: an absent attribute leaves it `unknown`, which is a real answer.
 */
function requirednessFor(input: {
  attributes: Map<string, string>
  ax: AxNode | undefined
  labelText: string
  description: string | null
  markers: string
  groupText: string
  groupRequired: boolean
}): Requiredness {
  const required: RequirednessEvidence[] = []
  const native = input.attributes.has("required")
  const aria = input.attributes.get("aria-required")
  const ariaTrue = aria === "true"
  const ariaFalse = aria === "false"
  const axRequired = input.ax ? axBoolean(input.ax, "required") : null

  const prose = `${input.labelText} ${input.description ?? ""} ${input.groupText} ${input.markers}`
  const marked = input.markers.includes("*") || input.labelText.includes("*")
  const instructionRequired = REQUIRED_INSTRUCTION.test(prose)
  const instructionOptional = OPTIONAL_INSTRUCTION.test(prose)

  if (native) required.push("native_attribute")
  if (ariaTrue || (axRequired === true && !native))
    required.push("aria_attribute")
  if (marked) required.push("visible_marker")
  if (instructionRequired) required.push("instruction_text")
  if (input.groupRequired) required.push("group_requirement")
  if (required.length > 0)
    return { state: "required", evidence: [...new Set(required)] }

  const optional: RequirednessEvidence[] = []
  if (ariaFalse) optional.push("aria_attribute")
  if (instructionOptional) optional.push("instruction_text")
  if (optional.length > 0) return { state: "optional", evidence: optional }

  return { state: "unknown", evidence: [] }
}

/** Resolves option state from the accessibility tree, falling back to markup. */
function selectedState(
  ax: AxNode | undefined,
  attributes: Map<string, string>
): boolean {
  if (ax) {
    if (axBoolean(ax, "selected") === true) return true
    if (axBoolean(ax, "checked") === true) return true
    // A toggle button reports its state as pressed, which is what a button
    // choice commits and what the staleness check has to compare.
    if (axBoolean(ax, "pressed") === true) return true
  }
  return (
    attributes.has("selected") ||
    attributes.get("aria-selected") === "true" ||
    attributes.get("aria-pressed") === "true"
  )
}

function indexSource(root: DomNode, axNodes: AxNode[]): Source {
  const ids = new Map<string, DomNode>()
  const labelsFor = new Map<string, DomNode[]>()
  const byBackendId = new Map<number, DomNode>()
  const ax = new Map<number, AxNode>()
  const describedIds = new Set<string>()
  const portalIds = new Set<string>()

  const visit = (node: DomNode): void => {
    if (node.backendNodeId !== undefined)
      byBackendId.set(node.backendNodeId, node)
    if (isElement(node)) {
      const attributes = attributeMap(node)
      const id = attributes.get("id")
      if (id) ids.set(id, node)
      if (tagOf(node) === "label") {
        const target = attributes.get("for")
        if (target) {
          const list = labelsFor.get(target) ?? []
          list.push(node)
          labelsFor.set(target, list)
        }
      }
      for (const name of ["aria-describedby", "aria-labelledby"] as const) {
        const value = attributes.get(name)
        if (!value) continue
        for (const value2 of value.split(/\s+/))
          if (value2) describedIds.add(value2)
      }
      // A control that names the element holding its options has no second
      // question there: the list belongs to the control.
      const owns =
        attributes.get("aria-controls") ?? attributes.get("aria-owns")
      if (
        owns &&
        (attributes.has("aria-haspopup") ||
          attributes.get("role") === "combobox")
      )
        for (const owned of owns.split(/\s+/)) if (owned) portalIds.add(owned)
    }
    // Detail roots are their own contexts, but their ids still resolve.
    for (const child of node.children ?? []) visit(child)
    for (const shadow of node.shadowRoots ?? []) visit(shadow)
    if (node.contentDocument) visit(node.contentDocument)
  }
  visit(root)
  for (const node of axNodes)
    if (node.backendDOMNodeId !== undefined) ax.set(node.backendDOMNodeId, node)

  return { ids, labelsFor, byBackendId, ax, describedIds, portalIds }
}

/**
 * Radio and checkbox sets that submit as one field are one question, the way a
 * `select` is. Grouping uses a native signal, a shared `name` within a form, so
 * it never guesses from wording.
 */
function findGroups(root: DomNode): GroupTables {
  const members = new Set<number>()
  const anchors = new Map<number, Grouped>()
  const byMember = new Map<number, Grouped>()
  const fields = new Set<number>()
  const byName = new Map<string, DomNode[]>()
  const containers = new Map<string, DomNode | undefined>()

  const visit = (
    node: DomNode,
    formKey: string,
    groupContainer: DomNode | undefined
  ): void => {
    if (!isElement(node)) {
      for (const child of node.children ?? [])
        visit(child, formKey, groupContainer)
      return
    }
    const tag = tagOf(node)
    const attributes = attributeMap(node)
    const form = tag === "form" ? `f${node.backendNodeId ?? 0}` : formKey
    const declaredRole = attributes.get("role")
    const isContainer =
      tag === "fieldset" ||
      declaredRole === "radiogroup" ||
      declaredRole === "group" ||
      declaredRole === "listbox"
    const container = isContainer ? node : groupContainer
    if (tag === "input") {
      const type = (attributes.get("type") ?? "text").toLowerCase()
      const name = attributes.get("name")
      if (name && (type === "radio" || type === "checkbox")) {
        const key = `${form}|${type}|${name}`
        const list = byName.get(key) ?? []
        if (list.length === 0) containers.set(key, container)
        list.push(node)
        byName.set(key, list)
      }
    }
    for (const child of node.children ?? []) visit(child, form, container)
    for (const shadow of node.shadowRoots ?? []) visit(shadow, form, container)
    if (node.contentDocument) visit(node.contentDocument, form, container)
  }
  visit(root, "f0", undefined)

  for (const [key, list] of byName) {
    if (list.length < 2) continue
    const first = list[0]
    if (!first) continue
    const kind =
      (attributeMap(first).get("type") ?? "").toLowerCase() === "radio"
        ? "radio_group"
        : "checkbox_group"
    // Prefer a member the page itself labelled as a group.
    const anchor =
      list.find((node) => {
        const role = attributeMap(node).get("role")
        return role === "radiogroup" || role === "group" || role === "listbox"
      }) ?? first
    const group: Grouped = {
      anchor,
      members: list,
      kind,
      container: containers.get(key) ?? null,
      field: null,
    }
    anchors.set(anchor.backendNodeId ?? -1, group)
    for (const member of list) {
      const id = member.backendNodeId ?? -1
      members.add(id)
      byMember.set(id, group)
    }
  }
  addButtonGroups(root, { members, anchors, byMember, fields })
  return { members, anchors, byMember, fields }
}

/** A button the page says is a stateful choice rather than an action. */
function isToggleButton(node: DomNode): boolean {
  if (!isElement(node)) return false
  const attributes = attributeMap(node)
  if (!attributes.has("aria-pressed")) return false
  return tagOf(node) === "button" || attributes.get("role") === "button"
}

/** `role="radio"` members of a declared radiogroup, never a nested group's. */
function collectRadios(
  container: DomNode,
  found: DomNode[],
  depth: number
): void {
  if (depth > CHOICE_CONTAINER_DEPTH) return
  for (const child of container.children ?? []) {
    if (!isElement(child)) continue
    const role = attributeMap(child).get("role")
    if (role === "radiogroup") continue
    if (role === "radio") found.push(child)
    collectRadios(child, found, depth + 1)
  }
}

/** How many choices sit under a container, stopping at a nested declared group. */
function countChoices(node: DomNode, depth: number): number {
  if (depth > CHOICE_CONTAINER_DEPTH) return 0
  let count = 0
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue
    if (attributeMap(child).get("role") === "radiogroup") continue
    if (isToggleButton(child)) count += 1
    count += countChoices(child, depth + 1)
  }
  return count
}

/**
 * The nearest ancestor holding two or more choices under one submitted field,
 * which is where a page renders one set of buttons. Nearest first, and the field
 * is required: without it two questions that merely share a page would merge
 * into one, and merging two questions is worse than leaving one unread.
 */
function choiceContainer(ancestors: DomNode[]): DomNode | null {
  for (const candidate of ancestors)
    if (countChoices(candidate, 0) >= 2 && hiddenFieldIn(candidate))
      return candidate
  return null
}

/**
 * A field nobody can see. Hidden by markup only: a class that hides it is not
 * evidence without the stylesheet, and guessing would drop a real question.
 */
function hiddenFromPeople(attributes: Map<string, string>): boolean {
  if (attributes.has("hidden")) return true
  if (attributes.get("aria-hidden") === "true") return true
  if ((attributes.get("type") ?? "").toLowerCase() === "hidden") return true
  const style = (attributes.get("style") ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
  return style.includes("display:none") || style.includes("visibility:hidden")
}

/**
 * The field a button group submits through: the hidden form field inside the
 * choices, if the page keeps one. Ashby carries the answer there while the
 * buttons above it carry the wording and the state.
 */
function hiddenFieldIn(container: DomNode): DomNode | null {
  let found: DomNode | null = null
  const visit = (node: DomNode, depth: number): void => {
    if (found || depth > HIDDEN_FIELD_DEPTH) return
    for (const child of node.children ?? []) {
      if (!isElement(child)) continue
      const tag = tagOf(child)
      if (
        (tag === "input" || tag === "select" || tag === "textarea") &&
        hiddenFromPeople(attributeMap(child))
      ) {
        found = child
        return
      }
      visit(child, depth + 1)
    }
  }
  visit(container, 1)
  return found
}

/** One question, every choice it holds, and the field it submits through. */
function addButtonGroup(
  table: GroupTables,
  container: DomNode,
  members: DomNode[]
): void {
  // A member with no browser identity could never be chosen, so it is not an
  // option; if that leaves nothing addressable, there is no group to bind.
  const usable = members.filter((member) => member.backendNodeId !== undefined)
  const anchor = usable[0]
  if (!anchor) return
  const anchorId = anchor.backendNodeId
  if (anchorId === undefined || table.anchors.has(anchorId)) return
  const group: Grouped = {
    anchor,
    members: usable,
    kind: "button_choice",
    container,
    field: hiddenFieldIn(container),
  }
  table.anchors.set(anchorId, group)
  for (const member of usable) {
    const id = member.backendNodeId
    if (id === undefined) continue
    table.members.add(id)
    table.byMember.set(id, group)
  }
  const fieldId = group.field?.backendNodeId
  if (fieldId !== undefined) table.fields.add(fieldId)
}

/**
 * Choices a page renders as elements rather than as a field.
 *
 * A `button` carrying `aria-pressed` and a `role="radio"` are a list of choices
 * to the page and nothing to the DOM, so there is no `name` to group by the way
 * radio inputs group. The evidence is structural instead: a declared
 * radiogroup, or the two or more choices a page renders inside one container,
 * together with the field the group submits through. Read off the reduced Ashby
 * capture in test/fixtures, where a yes/no question is two toggle buttons and a
 * hidden checkbox. Class names are never evidence; they are a page's internals.
 */
function addButtonGroups(root: DomNode, table: GroupTables): void {
  // A declared radiogroup is the page saying these elements are one choice, so
  // a single member is enough evidence.
  const declared = new Map<DomNode, DomNode[]>()
  const walkDeclared = (node: DomNode): void => {
    if (isElement(node) && attributeMap(node).get("role") === "radiogroup") {
      const listed: DomNode[] = []
      collectRadios(node, listed, 0)
      if (listed.length > 0) declared.set(node, listed)
    }
    for (const child of node.children ?? []) walkDeclared(child)
    for (const shadow of node.shadowRoots ?? []) walkDeclared(shadow)
    if (node.contentDocument) walkDeclared(node.contentDocument)
  }
  walkDeclared(root)
  for (const [container, listed] of declared)
    addButtonGroup(table, container, listed)

  // Then the ones no container declares. Two or more rendered together is the
  // evidence: a lone toggle is a control the page owns, and a button that
  // submits or navigates carries no `aria-pressed` at all.
  const byContainer = new Map<DomNode, DomNode[]>()
  const walkLoose = (node: DomNode, ancestors: DomNode[]): void => {
    if (isElement(node)) {
      const id = node.backendNodeId
      if (id !== undefined && isToggleButton(node) && !table.members.has(id)) {
        const container = choiceContainer(ancestors)
        if (container) {
          const list = byContainer.get(container) ?? []
          list.push(node)
          byContainer.set(container, list)
        }
      }
    }
    const next = [node, ...ancestors].slice(0, CHOICE_CONTAINER_DEPTH)
    for (const child of node.children ?? []) walkLoose(child, next)
    for (const shadow of node.shadowRoots ?? []) walkLoose(shadow, next)
    if (node.contentDocument) walkLoose(node.contentDocument, next)
  }
  walkLoose(root, [])
  for (const [container, listed] of byContainer) {
    if (listed.length < 2) continue
    addButtonGroup(table, container, listed)
  }
}

/**
 * The wording of a grouped set: its legend, not one of its options. Answering
 * "Male" when the page asked "Gender" would be answering the wrong question.
 */
function groupLabelText(group: Grouped, source: Source): string {
  // A button group is named by the label the page authored for the field it
  // submits. The label's `for` names that field, by id and by name, and the
  // Ashby capture is where the name is the only handle the markup offers.
  const field = group.field
  if (field) {
    const attributes = attributeMap(field)
    for (const key of [attributes.get("id"), attributes.get("name")]) {
      if (!key) continue
      for (const label of source.labelsFor.get(key) ?? []) {
        const text = clamp(textOf(label), MAX_LABEL)
        if (text) return text
      }
    }
  }
  const container = group.container
  if (container) {
    const attributes = attributeMap(container)
    const labelledBy = attributes.get("aria-labelledby")
    if (labelledBy) {
      const parts: string[] = []
      for (const id of labelledBy.split(/\s+/)) {
        const target = source.ids.get(id)
        if (target) parts.push(textOf(target))
      }
      const text = clamp(parts.join(" "), MAX_LABEL)
      if (text) return text
    }
    const ariaLabel = clamp(attributes.get("aria-label"), MAX_LABEL)
    if (ariaLabel) return ariaLabel
    const legend = (container.children ?? []).find(
      (child) => isElement(child) && tagOf(child) === "legend"
    )
    if (legend) {
      const text = clamp(textOf(legend), MAX_LABEL)
      if (text) return text
    }
  }
  return labelTextFor(group.anchor, source, attributeMap(group.anchor))
}

/** Options of a select or listbox, taken from its own subtree. */
function optionsFromSubtree(
  node: DomNode,
  source: Source,
  optionIdentity: { count: number }
): { options: ObservedOption[]; optionNodes: DomNode[] } {
  const options: ObservedOption[] = []
  const optionNodes: DomNode[] = []
  for (const option of node.children ?? []) {
    if (!isElement(option)) continue
    const role = attributeMap(option).get("role")
    if (tagOf(option) !== "option" && role !== "option") continue
    // An option with no browser identity can never be chosen, so offering it
    // would be offering something this engine cannot do.
    if (option.backendNodeId === undefined) {
      optionIdentity.count += 1
      continue
    }
    options.push({
      ref: "",
      label: (clamp(textOf(option), 500) ?? "").slice(0, 500),
      value: clamp(attributeOrNull(attributeMap(option), "value"), 500),
      selected: selectedState(
        source.ax.get(option.backendNodeId),
        attributeMap(option)
      ),
      disabled:
        attributeMap(option).has("disabled") ||
        attributeMap(option).get("aria-disabled") === "true",
    })
    optionNodes.push(option)
  }
  const bounded = options.slice(0, MAX_OPTIONS)
  return { options: bounded, optionNodes: optionNodes.slice(0, MAX_OPTIONS) }
}

type ControlInput = {
  node: DomNode
  tag: string
  attributes: Map<string, string>
  ax: AxNode | undefined
  role: string | null
  source: Source
  group: Grouped | undefined
  groupText: string
  markers: string
  optionIdentity: { count: number }
}

function describeControl(input: ControlInput): {
  control: ObservedControl
  evidence: ControlEvidence
  optionNodes: DomNode[]
} {
  const { node, tag, attributes, ax, role, source, group } = input
  const kind = group ? group.kind : controlKindFor(tag, attributes, role)
  const options: ObservedOption[] = []
  const optionNodes: DomNode[] = []
  let portal = false

  if (group) {
    for (const member of group.members) {
      const memberAttributes = attributeMap(member)
      const memberAx =
        member.backendNodeId === undefined
          ? undefined
          : source.ax.get(member.backendNodeId)
      // A member with no browser identity is an option nothing could choose.
      if (member.backendNodeId === undefined) {
        input.optionIdentity.count += 1
        continue
      }
      // The page's own text is the wording of a choice rendered as an element:
      // a button says "Yes" in its content, and a role="radio" div says what a
      // person reads. It comes before the computed name, which is derived rather
      // than authored, and after the label sources, so native markup is unchanged.
      const label =
        labelTextFor(member, source, memberAttributes) ||
        clamp(textOf(member), MAX_LABEL) ||
        clamp(axText(memberAx?.name), MAX_LABEL) ||
        (memberAttributes.get("value") ?? "")
      options.push({
        ref: "",
        label: label.slice(0, 500),
        value: clamp(attributeOrNull(memberAttributes, "value"), 500),
        selected: selectedState(memberAx, memberAttributes),
        disabled:
          memberAttributes.has("disabled") ||
          memberAttributes.get("aria-disabled") === "true",
      })
      optionNodes.push(member)
    }
  } else if (kind === "select" || role === "listbox") {
    const subtree = optionsFromSubtree(node, source, input.optionIdentity)
    options.push(...subtree.options)
    optionNodes.push(...subtree.optionNodes)
  } else {
    portal =
      options.length === 0 &&
      (attributes.has("aria-haspopup") || role === "combobox")
  }

  const labelText = group
    ? groupLabelText(group, source)
    : labelTextFor(node, source, attributes)
  const groupProse = group
    ? textOf(group.container ?? group.anchor).slice(0, MAX_LABEL)
    : ""
  const description = describedText(attributes, source, ax)
  // A `required` attribute on any member makes the whole set required, which is
  // how the browser treats a radio group.
  const groupRequired =
    group?.members.some((member) => {
      const memberAttributes = attributeMap(member)
      return (
        memberAttributes.has("required") ||
        memberAttributes.get("aria-required") === "true"
      )
    }) === true
  const requiredness = requirednessFor({
    attributes,
    ax,
    labelText,
    description,
    markers: input.markers,
    groupText: `${input.groupText} ${groupProse}`.trim(),
    groupRequired,
  })

  return {
    control: {
      kind,
      value:
        clamp(axText(ax?.value)) ?? clamp(attributeOrNull(attributes, "value")),
      checked:
        kind === "checkbox" || kind === "checkbox_group"
          ? ax
            ? axBoolean(ax, "checked")
            : null
          : null,
      multiple:
        attributes.has("multiple") ||
        (ax !== undefined && axBoolean(ax, "multiselectable") === true),
      readonly:
        attributes.has("readonly") ||
        (ax !== undefined && axBoolean(ax, "readonly") === true),
      disabled:
        attributes.has("disabled") ||
        attributes.get("aria-disabled") === "true" ||
        (ax !== undefined && axBoolean(ax, "disabled") === true),
      options,
      accepts: clamp(attributeOrNull(attributes, "accept"), 200),
    },
    evidence: {
      requiredness,
      labelText,
      description,
      constraints: constraintsOf(attributes),
      portal,
    },
    optionNodes,
  }
}

/**
 * First pass. Returns the shape worth keeping, or null when a subtree carries
 * nothing. It stops at frame and shadow boundaries: those are separate contexts
 * with their own references.
 */
function planNode(
  node: DomNode,
  context: Context,
  flags: PlanFlags,
  depth: number,
  parentGroupText: string
): Plan | null {
  // Counted before anything is kept or dropped: a node planning drops never
  // reaches `emit`, so this is the only place it can report what it did not
  // read, and a cut payload drops exactly the boundary nodes planning skips.
  if (childrenCut(node)) flags.truncated.count += 1

  if (depth > MAX_PLAN_DEPTH) {
    flags.depthCapped.count += 1
    return null
  }

  if (isTextNode(node)) {
    if (node.backendNodeId === undefined) return null
    if (!flags.keepText) return null
    const text = clamp(node.nodeValue)
    if (!text) return null
    return {
      dom: node,
      context,
      kind: "text",
      tag: "#text",
      role: null,
      name: null,
      text,
      control: null,
      optionNodes: [],
      evidence: null,
      region: false,
      regionLabel: null,
      record: false,
      children: [],
      kinds: [],
    }
  }

  if (!isElement(node)) {
    // A document or shadow root is a container, not content. Frames and open
    // shadow roots are walked as their own contexts, but the root itself still
    // has to hold the tree together.
    if (node.nodeType !== 9 && node.nodeType !== 11) return null
    const roots: Plan[] = []
    for (const child of node.children ?? []) {
      const planned = planNode(
        child,
        context,
        flags,
        depth + 1,
        parentGroupText
      )
      if (planned) roots.push(planned)
    }
    if (roots.length === 0 && depth !== 0) return null
    const rootKinds: string[] = []
    for (const child of roots) rootKinds.push(...child.kinds)
    return {
      dom: node,
      context,
      kind: "document",
      tag: node.nodeType === 9 ? "#document" : "#shadow-root",
      role: null,
      name: null,
      text: null,
      control: null,
      optionNodes: [],
      evidence: null,
      region: false,
      regionLabel: null,
      record: false,
      children: roots,
      kinds: rootKinds,
    }
  }

  const tag = tagOf(node)
  const attributes = attributeMap(node)
  if (isExtensionUi(attributes)) return null
  const ownId = attributes.get("id")
  // The option list of another control is not a question of its own. Its
  // options reach the model through the control that owns them.
  if (ownId !== undefined && flags.source.portalIds.has(ownId)) return null
  // The field a button group submits through carries the value rather than any
  // wording a person reads, so the group around it is the question, not this.
  if (
    node.backendNodeId !== undefined &&
    flags.groups.fields.has(node.backendNodeId)
  )
    return null
  if (isCredential(tag, attributes)) {
    flags.excludedCredentials.count += 1
    return null
  }

  const backendNodeId = node.backendNodeId
  const ax =
    backendNodeId === undefined ? undefined : flags.source.ax.get(backendNodeId)
  const role = clamp(axText(ax?.role), 100)
  const markers = markerText(node)
  const group =
    backendNodeId === undefined
      ? undefined
      : flags.groups.byMember.get(backendNodeId)
  const isGroupAnchor =
    backendNodeId !== undefined && flags.groups.anchors.has(backendNodeId)
  // A grouped member is an option of the group's question, never its own.
  if (group && !isGroupAnchor) return null

  const control =
    isControlNode(tag, attributes, role) || isGroupAnchor
      ? describeControl({
          node,
          tag,
          attributes,
          ax,
          role,
          source: flags.source,
          group: isGroupAnchor ? group : undefined,
          groupText: parentGroupText,
          markers,
          optionIdentity: flags.optionIdentity,
        })
      : null

  const region = isRegionNode(tag, attributes, role)
  const described = attributes.get("id")
  const keepText =
    flags.keepText ||
    tag === "label" ||
    tag === "legend" ||
    /^h[1-6]$/.test(tag) ||
    (described !== undefined && flags.source.describedIds.has(described)) ||
    (role !== null && ERROR_ROLES.has(role)) ||
    attributes.has("aria-invalid")

  const groupText = region
    ? (clamp(textOf(node), MAX_LABEL) ?? parentGroupText)
    : parentGroupText
  const children: Plan[] = []
  for (const child of node.children ?? []) {
    // Frame and shadow content is walked as its own context, framed by rootsOf.
    const planned = planNode(
      child,
      context,
      { ...flags, keepText },
      depth + 1,
      groupText
    )
    if (planned) children.push(planned)
  }

  const isTextHolder = keepText && !control
  const keep =
    children.length > 0 ||
    control !== null ||
    region ||
    isTextHolder ||
    depth === 0
  if (!keep) return null

  const kinds: string[] = []
  if (control) kinds.push(control.control.kind)
  for (const child of children) kinds.push(...child.kinds)

  return {
    dom: node,
    context,
    kind: control ? "element" : region ? "group" : "element",
    tag: tag || node.nodeName,
    role,
    name: clamp(axText(ax?.name)),
    // The authored wording sits on the label, not on the control, and it is the
    // wording a person reads for this question. The computed name stays
    // separate so the two can be compared.
    text: control
      ? control.evidence.labelText || clamp(textOf(node), MAX_LABEL)
      : clamp(textOf(node), MAX_TEXT),
    control: control?.control ?? null,
    optionNodes: control?.optionNodes ?? [],
    evidence: control?.evidence ?? null,
    region,
    regionLabel: region ? (clamp(axText(ax?.name), MAX_LABEL) ?? tag) : null,
    record: false,
    children,
    kinds,
  }
}

/**
 * Repeated sibling containers with the same structure are records, not
 * questions. Structural equality only: never text, which differs per record.
 */
function markRecords(children: Plan[]): void {
  const counts = new Map<string, number>()
  for (const child of children) {
    const key = `${child.tag}:${[...child.kinds].sort().join(",")}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const child of children) {
    const key = `${child.tag}:${[...child.kinds].sort().join(",")}`
    if ((counts.get(key) ?? 0) > 1 && child.kinds.length > 0)
      child.record = true
  }
}

/** Second pass: assign references top-down and collect the flat node list. */
function emit(
  plan: Plan,
  state: BuildState,
  input: {
    parentRef: string | null
    regionRef: string | null
    recordRef: string | null
  }
): string | null {
  const backendNodeId = plan.dom.backendNodeId
  if (backendNodeId === undefined) {
    // Without browser identity there is nothing a later action could address.
    state.gaps.push({
      scope: plan.tag,
      reason: "unsupported",
      detail: "a node carried no browser identity, so it cannot be referenced",
    })
    return null
  }

  state.refCounter += 1
  const ref = `n${state.refCounter}`
  state.index.add(ref, {
    contextId: plan.context.id,
    sessionId: plan.context.sessionId,
    backendNodeId,
    frameId: plan.context.frameId,
  })

  // Every option gets a reference of its own, so a later action can address the
  // option it chose and a replayed one can be checked against live state. They
  // are resolvable through the index and named in the control's option list, so
  // they are not pushed into the node list: that would inflate the page the
  // model reads and the byte budget for no gain.
  for (const [index, optionNode] of plan.optionNodes.entries()) {
    const option = plan.control?.options[index]
    const optionBackendId = optionNode.backendNodeId
    if (!option || optionBackendId === undefined) continue
    state.refCounter += 1
    const optionRef = `n${state.refCounter}`
    state.index.add(optionRef, {
      contextId: plan.context.id,
      sessionId: plan.context.sessionId,
      backendNodeId: optionBackendId,
      frameId: plan.context.frameId,
    })
    option.ref = optionRef
  }

  let regionRef = input.regionRef
  if (plan.region) {
    regionRef = ref
    state.regionLabels.set(ref, (plan.regionLabel ?? plan.tag).slice(0, 500))
  } else if (regionRef !== null) {
    const members = state.regionMembers.get(regionRef) ?? []
    members.push(ref)
    state.regionMembers.set(regionRef, members)
    state.regions.set(ref, regionRef)
  }

  let recordRef = input.recordRef
  if (plan.record) {
    state.recordCounter += 1
    recordRef = `r${state.recordCounter}`
  }
  if (recordRef !== null) state.records.set(ref, recordRef)

  if (plan.evidence) state.evidence.set(ref, plan.evidence)

  state.nodes.push({
    ref,
    contextId: plan.context.id,
    parentRef: input.parentRef,
    kind: plan.kind,
    tag: plan.tag,
    role: plan.role,
    name: plan.name,
    text: plan.text,
    control: plan.control,
  })

  markRecords(plan.children)
  for (const child of plan.children)
    emit(child, state, {
      parentRef: ref,
      regionRef,
      recordRef,
    })

  return ref
}

/** Every context that has to be read separately, with its own root node. */
function rootsOf(
  source: Source,
  base: Context,
  root: DomNode
): { roots: Root[]; capped: number } {
  const roots: Root[] = [{ context: base, node: root, source }]
  let anonymous = 0
  let capped = 0
  const nextAnonymousId = (prefix: "frame" | "shadow"): string => {
    anonymous += 1
    return `${prefix}:${anonymous}`
  }
  const visit = (node: DomNode, depth: number): void => {
    // Past the ceiling the search stops. Only a node that actually holds a frame
    // or a shadow root is a context nobody read; an ordinary deep subtree is not
    // a gap, and counting those would call every deep page incomplete. A context
    // nested below this boundary is still not detected, which is the price of
    // bounding the walk at all.
    if (depth > MAX_ROOT_DEPTH) {
      if (node.contentDocument || (node.shadowRoots ?? []).length > 0)
        capped += 1
      return
    }
    if (node.contentDocument) {
      const frameId = node.contentDocument.frameId ?? null
      roots.push({
        context: {
          ...base,
          id: frameId ? `frame:${frameId}` : nextAnonymousId("frame"),
          kind: "frame",
          frameId,
        },
        node: node.contentDocument,
        source,
      })
      visit(node.contentDocument, depth + 1)
    }
    for (const shadow of node.shadowRoots ?? []) {
      // A closed shadow root is either ours or unreachable; both are recorded.
      if (shadow.shadowRootType === "closed") {
        if (!containsExtensionFrame(shadow))
          roots.push({
            context: {
              ...base,
              id: nextAnonymousId("shadow"),
              kind: "shadow_root",
            },
            node: shadow,
            source,
          })
        continue
      }
      roots.push({
        context: {
          ...base,
          id: nextAnonymousId("shadow"),
          kind: "shadow_root",
        },
        node: shadow,
        source,
      })
      visit(shadow, depth + 1)
    }
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(root, 0)
  return { roots, capped }
}

function containsExtensionFrame(node: DomNode): boolean {
  const visit = (candidate: DomNode, depth: number): boolean => {
    if (depth > 8) return false
    const attributes = isElement(candidate)
      ? attributeMap(candidate)
      : new Map<string, string>()
    if (candidate.nodeName.toLowerCase() === "iframe") {
      const src = attributes.get("src") ?? ""
      if (isExtensionUrl(src)) return true
    }
    for (const child of candidate.children ?? [])
      if (visit(child, depth + 1)) return true
    for (const shadow of candidate.shadowRoots ?? [])
      if (visit(shadow, depth + 1)) return true
    if (
      candidate.contentDocument &&
      visit(candidate.contentDocument, depth + 1)
    )
      return true
    return false
  }
  return visit(node, 0)
}

let observationCounter = 0

function nextObservationId(generation: number): string {
  observationCounter += 1
  return `obs-${generation}-${observationCounter}`
}

/** Read the page once. Every unreadable region becomes a gap. */
export async function observePage(input: {
  session: DriverSession
  id?: string
  maxBytes?: number
}): Promise<PageRead> {
  const { session } = input
  const maxBytes = input.maxBytes ?? DOM_AGENT_LIMITS.observationBytes
  const state: BuildState = {
    nodes: [],
    evidence: new Map(),
    index: new NodeIndex(),
    gaps: [],
    records: new Map(),
    regions: new Map(),
    regionLabels: new Map(),
    regionMembers: new Map(),
    refCounter: 0,
    recordCounter: 0,
  }

  if (!session.capability.accessibility) {
    state.gaps.push({
      scope: "page",
      reason: "unsupported",
      detail: "accessibility semantics are unavailable, so nothing was read",
    })
    return finish({
      state,
      session,
      id: input.id,
      maxBytes,
      contexts: [],
      structural: false,
    })
  }

  const contexts: Context[] = []
  const sessionContexts = session.contextList.length
    ? session.contextList
    : [
        {
          id: "root",
          kind: "document" as const,
          sessionId: null,
          frameId: null,
          url: null,
        },
      ]

  for (const sessionContext of sessionContexts) {
    const base: Context = {
      id: sessionContext.id,
      kind: sessionContext.kind === "frame" ? "frame" : "document",
      sessionId: sessionContext.sessionId,
      frameId: sessionContext.frameId,
      url: sessionContext.url,
      generation: String(session.generation),
    }
    if (isExtensionUrl(base.url)) continue

    let document: unknown
    try {
      // Bounded on purpose. The plan never reaches past MAX_PLAN_DEPTH, so a
      // deeper fetch would only pay for content nothing would read; a node the
      // bound cuts still reports its child count, so the second pass records
      // what it could not reach instead of assuming it was empty.
      document = await session.send(sessionContext.id, "DOM.getDocument", {
        depth: MAX_PLAN_DEPTH,
        pierce: true,
      })
    } catch {
      state.gaps.push({
        scope: base.url ?? base.id,
        reason: base.id === "root" ? "inaccessible" : "cross_origin",
        detail: "the document could not be read from this context",
      })
      continue
    }
    const parsed = DomDocumentSchema.safeParse(document)
    if (!parsed.success) {
      state.gaps.push({
        scope: base.url ?? base.id,
        reason: "unsupported",
        detail: "the document shape was not recognised",
      })
      continue
    }

    let axNodes: AxNode[] = []
    try {
      const payload = await session.send(
        sessionContext.id,
        "Accessibility.getFullAXTree",
        {}
      )
      const axParsed = AxTreeSchema.safeParse(payload)
      if (axParsed.success) axNodes = axParsed.data.nodes
      else
        state.gaps.push({
          scope: base.url ?? base.id,
          reason: "unsupported",
          detail: "the accessibility tree shape was not recognised",
        })
    } catch {
      state.gaps.push({
        scope: base.url ?? base.id,
        reason: "unsupported",
        detail: "the accessibility tree could not be read in this context",
      })
    }

    const source = indexSource(parsed.data.root, axNodes)
    const roots = rootsOf(source, base, parsed.data.root)
    const excludedCredentials = { count: 0 }
    const depthCapped = { count: 0 }
    const truncated = { count: 0 }
    const optionIdentity = { count: 0 }
    for (const root of roots.roots) {
      const closedShadow = root.node.shadowRootType === "closed"
      if (closedShadow) {
        state.gaps.push({
          scope: root.context.url ?? root.context.id,
          reason: "closed_shadow",
          detail: "a closed shadow root is outside this engine's reach",
        })
        continue
      }
      contexts.push(root.context)
      const groups = findGroups(root.node)
      const flags: PlanFlags = {
        source,
        groups,
        keepText: false,
        groupText: "",
        groupRequired: false,
        excludedCredentials,
        depthCapped,
        truncated,
        optionIdentity,
      }
      const planned = planNode(root.node, root.context, flags, 0, "")
      if (!planned) {
        state.gaps.push({
          scope: root.context.url ?? root.context.id,
          reason: "unsupported",
          detail: "the context contained nothing that could be read",
        })
        continue
      }
      const ref = emit(planned, state, {
        parentRef: null,
        regionRef: null,
        recordRef: null,
      })
      if (ref === null)
        state.gaps.push({
          scope: root.context.url ?? root.context.id,
          reason: "unsupported",
          detail: "the context root carried no browser identity",
        })
    }
    if (excludedCredentials.count > 0)
      state.gaps.push({
        scope: "authentication and payment fields",
        reason: "unsupported",
        detail: `${excludedCredentials.count} field(s) excluded by policy: never read and never filled`,
      })
    if (depthCapped.count > 0)
      state.gaps.push({
        scope: base.url ?? base.id,
        reason: "truncated",
        detail: `${depthCapped.count} subtree(s) sit deeper than ${MAX_PLAN_DEPTH} levels and were not planned, so nothing inside them was read`,
      })
    if (truncated.count > 0)
      state.gaps.push({
        scope: base.url ?? base.id,
        reason: "truncated",
        detail: `${truncated.count} node(s) came back with fewer children than they declare, so the read stopped at its bound and nothing under them was read`,
      })
    if (optionIdentity.count > 0)
      state.gaps.push({
        scope: base.url ?? base.id,
        reason: "unsupported",
        detail: `${optionIdentity.count} option(s) carried no browser identity and cannot be chosen`,
      })
    if (roots.capped > 0)
      state.gaps.push({
        scope: base.url ?? base.id,
        reason: "truncated",
        detail: `${roots.capped} frame or shadow root(s) sit deeper than ${MAX_ROOT_DEPTH} levels and were not read as their own context`,
      })
  }

  return finish({
    state,
    session,
    id: input.id,
    maxBytes,
    contexts,
    structural: true,
  })
}

function finish(input: {
  state: BuildState
  session: DriverSession
  id?: string
  maxBytes: number
  contexts: Context[]
  structural: boolean
}): PageRead {
  const { state, session, maxBytes } = input
  const contexts: ObservationContext[] = input.contexts.map((context) => ({
    id: context.id,
    kind: context.kind,
    url: context.url,
    generation: context.generation,
    accessible: true,
  }))

  let nodes = state.nodes
  let regions = buildRegions(state, nodes)
  if (nodes.length > DOM_AGENT_LIMITS.observationNodes) {
    state.gaps.push({
      scope: "page",
      reason: "budget",
      detail: `${nodes.length} nodes exceeded ${DOM_AGENT_LIMITS.observationNodes}; the rest were dropped, not read`,
    })
    nodes = nodes.slice(0, DOM_AGENT_LIMITS.observationNodes)
  }
  if (regions.length > DOM_AGENT_LIMITS.observationRegions) {
    state.gaps.push({
      scope: "page",
      reason: "budget",
      detail: `${regions.length} regions exceeded ${DOM_AGENT_LIMITS.observationRegions}`,
    })
    regions = regions.slice(0, DOM_AGENT_LIMITS.observationRegions)
  }

  let observation: Observation = {
    id: input.id ?? nextObservationId(session.generation),
    contexts,
    nodes,
    regions,
    coverage: observationCoverage(state.gaps, input.structural),
  }

  if (observationBytes(observation) > maxBytes) {
    // Serialized size is what the reasoner carries, so that is the real budget.
    observation = trim(observation, maxBytes)
    state.gaps.push({
      scope: "page",
      reason: "budget",
      detail: `the observation was trimmed to fit ${maxBytes} bytes`,
    })
    observation = {
      ...observation,
      coverage: observationCoverage(state.gaps, input.structural),
    }
  }

  const kept = new Set(observation.nodes.map((node) => node.ref))
  for (const ref of [...state.regions.keys()])
    if (!kept.has(ref)) state.regions.delete(ref)

  return {
    observation,
    index: state.index,
    evidence: state.evidence,
    records: state.records,
    regions: state.regions,
  }
}

function buildRegions(
  state: BuildState,
  nodes: ObservationNode[]
): ObservationRegion[] {
  const regions: ObservationRegion[] = []
  let index = 0
  for (const node of nodes) {
    if (!state.regionLabels.has(node.ref)) continue
    const members = state.regionMembers.get(node.ref) ?? []
    index += 1
    if (members.length > 200)
      state.gaps.push({
        scope: node.name ?? node.tag,
        reason: "truncated",
        detail: `${members.length} nodes exceeded the 200 a region can carry`,
      })
    regions.push({
      ref: `rgn${index}`,
      label: (state.regionLabels.get(node.ref) ?? node.tag).slice(0, 500),
      nodeRefs: members.slice(0, 200),
      recordRef: state.records.get(node.ref) ?? null,
    })
  }
  return regions
}

export function observationBytes(observation: Observation): number {
  return new TextEncoder().encode(JSON.stringify(observation)).length
}

/**
 * Fit the payload to a byte ceiling by shortening text first, then dropping
 * nodes. Any drop is reported as a gap, so a trimmed observation can never look
 * complete.
 */
function trim(observation: Observation, maxBytes: number): Observation {
  let current = observation
  for (const limit of [400, 200, 80, 24]) {
    current = {
      ...current,
      nodes: current.nodes.map((node) => ({
        ...node,
        text:
          node.text && node.text.length > limit
            ? node.text.slice(0, limit)
            : node.text,
        name:
          node.name && node.name.length > limit
            ? node.name.slice(0, limit)
            : node.name,
        control: node.control
          ? {
              ...node.control,
              options: node.control.options.map((option) => ({
                ...option,
                label:
                  option.label.length > limit
                    ? option.label.slice(0, limit)
                    : option.label,
              })),
            }
          : null,
      })),
    }
    if (observationBytes(current) <= maxBytes) return current
  }
  // Options are the largest repeatable part of the payload, so they go before
  // any node does: a control without its list is still a question.
  const withoutOptions = current.nodes.map((node) =>
    node.control ? { ...node, control: { ...node.control, options: [] } } : node
  )
  const candidate = { ...current, nodes: withoutOptions }
  if (observationBytes(candidate) <= maxBytes) return candidate
  let nodes = candidate.nodes
  while (
    nodes.length > 1 &&
    observationBytes({ ...candidate, nodes }) > maxBytes
  )
    nodes = nodes.slice(0, Math.max(1, Math.floor(nodes.length * 0.8)))
  return { ...candidate, nodes }
}

/** A bounded detail read of one region: its own subtree, not the whole page. */
export async function readRegion(input: {
  session: DriverSession
  read: PageRead
  regionRef: string
  maxBytes?: number
}): Promise<PageFragment> {
  const region = input.read.observation.regions.find(
    (candidate) => candidate.ref === input.regionRef
  )
  if (!region)
    return emptyFragment("the region is no longer part of this observation")
  const anchor = region.nodeRefs[0]
  if (!anchor) return emptyFragment("the region has no reference to read")
  return readFragment({
    session: input.session,
    read: input.read,
    nodeRef: anchor,
    depth: 6,
    maxBytes: input.maxBytes,
  })
}

/**
 * A local fragment read, addressed by browser identity rather than by selector:
 * a selector would be a guess about a page that may have changed.
 */
export async function readFragment(input: {
  session: DriverSession
  read: PageRead
  nodeRef: string
  depth?: number
  maxBytes?: number
}): Promise<PageFragment> {
  const { session } = input
  const identity = input.read.index.resolve(input.nodeRef)
  if (!identity)
    return emptyFragment("the node is no longer part of this observation")
  const contextId = identity.sessionId ?? "root"
  let described: unknown
  try {
    described = await session.send(contextId, "DOM.describeNode", {
      backendNodeId: identity.backendNodeId,
      depth: input.depth ?? 4,
      pierce: true,
    })
  } catch {
    return emptyFragment("the fragment could not be read from this context")
  }
  const parsed = DomNodeResultSchema.safeParse(described)
  if (!parsed.success || !parsed.data.node)
    return emptyFragment("the browser did not return the fragment")

  const ax = await readAx(session, contextId)
  const source = indexSource(parsed.data.node, ax.nodes)
  const context: Context = {
    id: identity.contextId,
    kind: identity.frameId ? "frame" : "document",
    sessionId: identity.sessionId,
    frameId: identity.frameId,
    url: null,
    generation: String(session.generation),
  }
  return walkOne({
    session,
    source,
    roots: [{ context, node: parsed.data.node, source }],
    id: input.read.observation.id,
    maxBytes: input.maxBytes ?? DOM_AGENT_LIMITS.observationBytes,
    // A fragment read without accessibility semantics has no requiredness and no
    // roles, so it says so rather than looking like a page that had none.
    gaps: ax.failed
      ? [
          {
            scope: identity.contextId,
            reason: "unsupported" as const,
            detail:
              "the accessibility tree could not be read, so this fragment carries no semantics",
          },
        ]
      : [],
  })
}

/**
 * The option list of a control whose portal mounts on demand, such as a
 * React combobox. Read after the list is opened, because before that it does
 * not exist in the document.
 */
export async function readOptions(input: {
  session: DriverSession
  read: PageRead
  controlRef: string
}): Promise<{ options: ObservedOption[]; gap: CoverageGap | null }> {
  const { session } = input
  const identity = input.read.index.resolve(input.controlRef)
  if (!identity)
    return {
      options: [],
      gap: staleGap(
        input.controlRef,
        "the control is no longer part of this observation"
      ),
    }
  const contextId = identity.sessionId ?? "root"
  let document: unknown
  try {
    document = await session.send(contextId, "DOM.getDocument", {
      depth: MAX_PLAN_DEPTH,
      pierce: true,
    })
  } catch {
    return {
      options: [],
      gap: staleGap(input.controlRef, "the option portal could not be read"),
    }
  }
  const parsed = DomDocumentSchema.safeParse(document)
  if (!parsed.success)
    return {
      options: [],
      gap: staleGap(input.controlRef, "the document shape was not recognised"),
    }

  const ax = await readAx(session, contextId)
  const source = indexSource(parsed.data.root, ax.nodes)
  const control = source.byBackendId.get(identity.backendNodeId)
  if (!control)
    return {
      options: [],
      gap: staleGap(
        input.controlRef,
        "the control is no longer in the document"
      ),
    }

  const attributes = attributeMap(control)
  const named =
    attributes.get("aria-controls") ?? attributes.get("aria-owns") ?? ""
  const portalIds = named.split(/\s+/).filter(Boolean)
  if (portalIds.length === 0)
    return {
      options: [],
      gap: staleGap(
        input.controlRef,
        "the control does not name the element holding its options"
      ),
    }

  const options: ObservedOption[] = []
  let optionDepthCapped = 0
  for (const id of portalIds) {
    const portal = source.ids.get(id)
    if (!portal) continue
    const listed = optionNodes(portal)
    optionDepthCapped += listed.capped
    for (const option of listed.found) {
      const optionAttributes = attributeMap(option)
      if (option.backendNodeId === undefined) continue
      options.push({
        ref: "",
        label: (clamp(textOf(option), 500) ?? "").slice(0, 500),
        value: clamp(attributeOrNull(optionAttributes, "value"), 500),
        selected: selectedState(
          source.ax.get(option.backendNodeId),
          optionAttributes
        ),
        disabled:
          optionAttributes.has("disabled") ||
          optionAttributes.get("aria-disabled") === "true",
      })
    }
  }
  if (options.length === 0)
    return {
      options: [],
      gap: staleGap(input.controlRef, "the option list is not mounted yet"),
    }
  // One gap is returned, so the most consequential reason wins: a truncated
  // list means options this run cannot offer, which outranks semantics this run
  // could not confirm.
  const gaps: CoverageGap[] = []
  if (optionDepthCapped > 0)
    gaps.push(
      staleGap(
        input.controlRef,
        `${optionDepthCapped} option(s) sit deeper than ${MAX_OPTION_DEPTH} levels and were not read`
      )
    )
  if (ax.failed)
    gaps.push(
      staleGap(
        input.controlRef,
        "the accessibility tree could not be read, so the selected state is unconfirmed"
      )
    )
  return { options: options.slice(0, MAX_OPTIONS), gap: gaps[0] ?? null }
}

function walkOne(input: {
  session: DriverSession
  source: Source
  roots: Root[]
  id: string
  maxBytes: number
  /** Gaps the read already knows about, before it walks anything. */
  gaps?: CoverageGap[]
}): PageFragment {
  const state: BuildState = {
    nodes: [],
    evidence: new Map(),
    index: new NodeIndex(),
    gaps: input.gaps ? [...input.gaps] : [],
    records: new Map(),
    regions: new Map(),
    regionLabels: new Map(),
    regionMembers: new Map(),
    refCounter: 0,
    recordCounter: 0,
  }
  const excludedCredentials = { count: 0 }
  const depthCapped = { count: 0 }
  const truncated = { count: 0 }
  const optionIdentity = { count: 0 }
  for (const root of input.roots) {
    const groups = findGroups(root.node)
    const planned = planNode(
      root.node,
      root.context,
      {
        source: input.source,
        groups,
        keepText: false,
        groupText: "",
        groupRequired: false,
        excludedCredentials,
        depthCapped,
        truncated,
        optionIdentity,
      },
      0,
      ""
    )
    if (!planned) continue
    emit(planned, state, { parentRef: null, regionRef: null, recordRef: null })
  }
  // Whatever this read could not reach is reported, so a fragment never claims
  // to be complete while a ceiling cut it.
  if (depthCapped.count > 0)
    state.gaps.push({
      scope: input.id,
      reason: "truncated",
      detail: `${depthCapped.count} subtree(s) sit deeper than ${MAX_PLAN_DEPTH} levels and were not read`,
    })
  if (truncated.count > 0)
    state.gaps.push({
      scope: input.id,
      reason: "truncated",
      detail: `${truncated.count} node(s) came back with fewer children than they declare, so the read stopped at its bound and nothing under them was read`,
    })
  if (optionIdentity.count > 0)
    state.gaps.push({
      scope: input.id,
      reason: "unsupported",
      detail: `${optionIdentity.count} option(s) carried no browser identity and cannot be chosen`,
    })
  if (excludedCredentials.count > 0)
    state.gaps.push({
      scope: "authentication and payment fields",
      reason: "unsupported",
      detail: `${excludedCredentials.count} field(s) excluded by policy: never read and never filled`,
    })
  const read = finish({
    state,
    session: input.session,
    id: input.id,
    maxBytes: input.maxBytes,
    contexts: input.roots.map((root) => root.context),
    structural: true,
  })
  return {
    nodes: read.observation.nodes,
    regions: read.observation.regions,
    coverage: read.observation.coverage,
    index: read.index,
    evidence: read.evidence,
  }
}

function optionNodes(portal: DomNode): { found: DomNode[]; capped: number } {
  const found: DomNode[] = []
  let capped = 0
  const visit = (node: DomNode, depth: number): void => {
    if (depth > MAX_OPTION_DEPTH) {
      capped += 1
      return
    }
    if (isElement(node)) {
      const role = attributeMap(node).get("role")
      if (role === "option" || tagOf(node) === "option") found.push(node)
    }
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(portal, 0)
  return { found, capped }
}

async function readAx(
  session: DriverSession,
  contextId: string
): Promise<{ nodes: AxNode[]; failed: boolean }> {
  try {
    const payload = await session.send(
      contextId,
      "Accessibility.getFullAXTree",
      {}
    )
    const parsed = AxTreeSchema.safeParse(payload)
    return parsed.success
      ? { nodes: parsed.data.nodes, failed: false }
      : { nodes: [], failed: true }
  } catch {
    return { nodes: [], failed: true }
  }
}

function staleGap(scope: string, detail: string): CoverageGap {
  return { scope, reason: "unsupported", detail }
}

function emptyFragment(detail: string): PageFragment {
  return {
    nodes: [],
    regions: [],
    coverage: observationCoverage([staleGap("fragment", detail)], false),
    index: new NodeIndex(),
    evidence: new Map(),
  }
}
