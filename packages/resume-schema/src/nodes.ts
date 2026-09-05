import type { Item, Resume, Section } from "./schema"

export type NodeKind = "basics" | "section" | "item" | "bullet" | "link"

export type NodeRef = {
  id: string
  kind: NodeKind
  /** `null` only for `basics` and top-level sections. */
  parentId: string | null
  /** Position within the parent's array. `0` for `basics`. */
  index: number
  node: unknown
  /** Path from the resume root, usable with lodash-style access. */
  path: (string | number)[]
}

/** Every addressable node in the document, keyed by id, in document order. */
export function indexNodes(resume: Resume): Map<string, NodeRef> {
  const map = new Map<string, NodeRef>()

  map.set("basics", {
    id: "basics",
    kind: "basics",
    parentId: null,
    index: 0,
    node: resume.basics,
    path: ["basics"],
  })

  resume.basics.links.forEach((link, l) => {
    map.set(link.id, {
      id: link.id,
      kind: "link",
      parentId: "basics",
      index: l,
      node: link,
      path: ["basics", "links", l],
    })
  })

  resume.sections.forEach((section, s) => {
    map.set(section.id, {
      id: section.id,
      kind: "section",
      parentId: null,
      index: s,
      node: section,
      path: ["sections", s],
    })

    section.items.forEach((item, i) => {
      map.set(item.id, {
        id: item.id,
        kind: "item",
        parentId: section.id,
        index: i,
        node: item,
        path: ["sections", s, "items", i],
      })

      if (item.kind === "skills") return

      item.bullets.forEach((bullet, b) => {
        map.set(bullet.id, {
          id: bullet.id,
          kind: "bullet",
          parentId: item.id,
          index: b,
          node: bullet,
          path: ["sections", s, "items", i, "bullets", b],
        })
      })
    })
  })

  return map
}

export function findNode(resume: Resume, id: string): NodeRef | undefined {
  return indexNodes(resume).get(id)
}

/** Fields of each node kind that `replace_text` may target. */
const TEXT_FIELDS: Record<NodeKind, readonly string[]> = {
  basics: ["headline", "summary"],
  section: ["title"],
  item: [
    "role",
    "company",
    "title",
    "subtitle",
    "name",
    "degree",
    "field",
    "school",
    "label",
  ],
  bullet: ["text"],
  link: ["label"],
}

/**
 * Text fields that actually exist on this node. Filtering by presence keeps a
 * skills group from advertising `role`, and keeps optional absent fields out of
 * the model's reach.
 */
export function textFields(kind: NodeKind, node: unknown): string[] {
  const candidates = TEXT_FIELDS[kind]
  if (typeof node !== "object" || node === null) return [...candidates]
  const record = node as Record<string, unknown>
  return candidates.filter((field) => typeof record[field] === "string")
}

/** A short human label for a node, e.g. `Acme` or `bullet 2`. */
function label(ref: NodeRef): string {
  const node = ref.node as Record<string, unknown>
  switch (ref.kind) {
    case "basics":
      return "Basics"
    case "section":
      return String((node as unknown as Section).title)
    case "item": {
      const item = node as unknown as Item
      switch (item.kind) {
        case "experience":
          return item.company
        case "education":
          return item.school
        case "project":
          return item.name
        case "skills":
          return item.label
        case "custom":
          return item.title
      }
      break
    }
    case "bullet":
      return `bullet ${ref.index + 1}`
    case "link":
      return `link ${ref.index + 1}`
  }
  return ref.id
}

/** Fields that carry a node's own text, most identifying first. */
const SUMMARY_FIELDS = [
  "text",
  "role",
  "title",
  "name",
  "school",
  "label",
] as const

/**
 * A node's content in one line, for showing what an addition or a removal
 * actually was. `label` names a node within its parent ("bullet 2"); this says
 * what the node reads as.
 */
export function nodeSummary(node: unknown): string {
  if (typeof node === "string") return node
  if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>
    for (const field of SUMMARY_FIELDS) {
      const value = record[field]
      if (typeof value === "string" && value.length > 0) return value
    }
  }
  return "this entry"
}

/** `Experience > Acme > bullet 2`, for suggestion cards and prompts. */
export function breadcrumb(resume: Resume, id: string): string {
  const index = indexNodes(resume)
  const parts: string[] = []
  let current = index.get(id)
  while (current) {
    parts.unshift(label(current))
    current = current.parentId ? index.get(current.parentId) : undefined
  }
  return parts.join(" > ")
}

/** True when `id` is `ancestorId` or lives inside it. Used for scope checks. */
export function isWithin(
  resume: Resume,
  id: string,
  ancestorId: string
): boolean {
  if (id === ancestorId) return true
  const index = indexNodes(resume)
  let current = index.get(id)
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true
    current = index.get(current.parentId)
  }
  return false
}

/**
 * The node a selection confines patches to: the item, or `basics`, that holds
 * it. Selecting a bullet scopes to its item, so a skill may touch that
 * bullet's siblings but nothing outside the item the user pointed at.
 *
 * Returns undefined when the selection no longer exists, which means "no
 * scope" rather than "reject": the user may have deleted the node after
 * selecting it, and failing the run over that is worse than widening it.
 *
 * This lives here, next to `isWithin` which enforces it, because both halves
 * of the patch contract need the same answer: the prompt builder deciding what
 * to show the model, and the server re-checking a stored patch at accept time.
 */
export function scopeAnchor(
  resume: Resume,
  selectedNodeId: string
): NodeRef | undefined {
  const index = indexNodes(resume)
  const selected = index.get(selectedNodeId)
  if (!selected) return undefined

  let current = selected
  while (
    current.kind !== "item" &&
    current.kind !== "basics" &&
    current.parentId
  ) {
    const parent = index.get(current.parentId)
    if (!parent) break
    current = parent
  }
  return current
}

/** Every string in the document, for grounding checks and prompts. */
export function collectText(resume: Resume): string[] {
  const out: string[] = []
  const push = (value: unknown) => {
    if (typeof value === "string" && value.length > 0) out.push(value)
  }
  const b = resume.basics
  push(b.name)
  push(b.headline)
  push(b.summary)
  push(b.location)
  for (const link of b.links) {
    push(link.label)
    push(link.url)
  }
  for (const section of resume.sections) {
    push(section.title)
    for (const item of section.items) {
      for (const value of Object.values(item)) push(value)
      if (item.kind === "skills") {
        for (const skill of item.skills) push(skill)
      } else {
        for (const bullet of item.bullets) push(bullet.text)
      }
    }
  }
  return out
}
