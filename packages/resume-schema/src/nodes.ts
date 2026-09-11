import type { z } from "zod"

import {
  BasicsSchema,
  BulletSchema,
  CustomItemSchema,
  EducationItemSchema,
  ExperienceItemSchema,
  LinkSchema,
  ProjectItemSchema,
  SectionSchema,
  SkillsGroupSchema,
  type Basics,
  type Bullet,
  type Item,
  type Link,
  type Resume,
  type Section,
} from "./schema"

export type NodeKind = "basics" | "section" | "item" | "bullet" | "link"

type RefBase = {
  id: string
  /** `null` only for `basics` and top-level sections. */
  parentId: string | null
  /** Position within the parent's array. `0` for `basics`. */
  index: number
  /** Path from the resume root, usable with lodash-style access. */
  path: (string | number)[]
}

/**
 * An addressable node with its kind and its typed value in one place, so a
 * check on `kind` narrows `node` and nothing downstream has to cast.
 */
export type NodeRef =
  | (RefBase & { kind: "basics"; node: Basics })
  | (RefBase & { kind: "section"; node: Section })
  | (RefBase & { kind: "item"; node: Item })
  | (RefBase & { kind: "bullet"; node: Bullet })
  | (RefBase & { kind: "link"; node: Link })

/** Any node the document holds. */
export type ResumeNode = NodeRef["node"]

/**
 * A node's own field, read by name. The editor addresses fields by string
 * because its inputs are generic; this is the one place that string meets
 * the node, and the caller still has to check what came back.
 */
export function readField(node: ResumeNode, field: string): unknown {
  const record: Record<string, unknown> = node
  return record[field]
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

/**
 * Fields of each node kind that `replace_text` may target. Contact details
 * and link URLs are here as well: a typo in an email address is exactly the
 * kind of edit a resume needs, and `update_fields` alone cannot reach a field
 * that is already present.
 */
const TEXT_FIELDS: Record<NodeKind, readonly string[]> = {
  basics: ["headline", "summary", "name", "email", "phone", "location"],
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
  link: ["label", "url"],
}

const ITEM_SCHEMAS: Record<Item["kind"], z.ZodObject> = {
  experience: ExperienceItemSchema,
  education: EducationItemSchema,
  project: ProjectItemSchema,
  skills: SkillsGroupSchema,
  custom: CustomItemSchema,
}

const NODE_SCHEMAS: Record<Exclude<NodeKind, "item">, z.ZodObject> = {
  basics: BasicsSchema,
  section: SectionSchema,
  bullet: BulletSchema,
  link: LinkSchema,
}

/**
 * Whether a node's own schema accepts this field, and whether the field may be
 * cleared.
 *
 * `undefined` means the node has no such field, which `update_fields` refuses.
 * A field the schema declares optional is the one kind `null` may clear. The
 * answer is read off the schema rather than a second list of field names, so
 * the two cannot disagree when a field is added.
 */
export function nodeField(
  kind: NodeKind,
  node: unknown,
  field: string
): "required" | "optional" | undefined {
  const record =
    typeof node === "object" && node !== null
      ? (node as Record<string, unknown>)
      : undefined
  let schema: z.ZodObject | undefined
  if (kind === "item") {
    const itemKind = record?.kind
    schema =
      typeof itemKind === "string" && itemKind in ITEM_SCHEMAS
        ? ITEM_SCHEMAS[itemKind as Item["kind"]]
        : undefined
  } else {
    schema = NODE_SCHEMAS[kind]
  }
  const fieldSchema = schema?.shape[field]
  if (!fieldSchema) return undefined
  // Zod deprecates `isOptional` in favour of exactly this probe.
  return fieldSchema.safeParse(undefined).success ? "optional" : "required"
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
  switch (ref.kind) {
    case "basics":
      return "Basics"
    case "section":
      return ref.node.title
    case "item":
      return itemLabel(ref.node)
    case "bullet":
      return `bullet ${ref.index + 1}`
    case "link":
      return `link ${ref.index + 1}`
  }
}

function itemLabel(item: Item): string {
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
