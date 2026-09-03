import { z } from "zod"
import { ITEM_PREFIX, newId } from "./ids"
import { canonicalJson } from "./hash"
import {
  indexNodes,
  isWithin,
  type NodeKind,
  type NodeRef,
  textFields,
} from "./nodes"
import {
  BulletSchema,
  ItemSchema,
  LinkSchema,
  NodeId,
  ResumeSchema,
  type Bullet,
  type Item,
  type Link,
  type Resume,
} from "./schema"

/* ------------------------------------------------------------------ types */

const Common = z.object({
  reason: z.string().max(500),
  skillId: z.string(),
  confidence: z.number().min(0).max(1).optional(),
})

export const ReplaceText = Common.extend({
  op: z.literal("replace_text"),
  targetNodeId: NodeId,
  field: z.string(),
  before: z.string(),
  after: z.string().min(1),
})

export const UpdateFields = Common.extend({
  op: z.literal("update_fields"),
  targetNodeId: NodeId,
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
})

export const InsertAfter = Common.extend({
  op: z.literal("insert_after"),
  parentId: NodeId,
  afterNodeId: NodeId.nullable(),
  node: z.unknown(),
})

export const Delete = Common.extend({
  op: z.literal("delete"),
  targetNodeId: NodeId,
  before: z.unknown(),
})

export const Move = Common.extend({
  op: z.literal("move"),
  targetNodeId: NodeId,
  toIndex: z.number().int().min(0),
})

export const ResumePatchSchema = z.discriminatedUnion("op", [
  ReplaceText,
  UpdateFields,
  InsertAfter,
  Delete,
  Move,
])

export type ResumePatch = z.infer<typeof ResumePatchSchema>
export type PatchOp = ResumePatch["op"]

export const PATCH_OPS: PatchOp[] = [
  "replace_text",
  "update_fields",
  "insert_after",
  "delete",
  "move",
]

export const PATCH_ERROR_CODES = [
  "TARGET_NOT_FOUND",
  "PARENT_NOT_FOUND",
  "OP_NOT_ALLOWED",
  "FIELD_NOT_ALLOWED",
  "BEFORE_MISMATCH",
  "SCHEMA_INVALID",
  "KIND_MISMATCH",
  "EMPTY_TEXT",
  "UNGROUNDED_NUMBER",
  "OUT_OF_SCOPE",
  "INDEX_OUT_OF_RANGE",
] as const

export type PatchErrorCode = (typeof PATCH_ERROR_CODES)[number]

/** Fields no patch may ever write, because they are structural. */
const PROTECTED_FIELDS = new Set(["id", "kind", "items", "bullets", "links"])

/* ------------------------------------------------------------------ apply */

export type AppliedPatch = {
  patch: ResumePatch
  inverse: ResumePatch
  assignedIds?: string[]
}

export type FailedPatch = {
  patch: ResumePatch
  code: PatchErrorCode
  message: string
}

export type ApplyResult = {
  resume: Resume
  applied: AppliedPatch[]
  failed: FailedPatch[]
}

type Located = {
  kind: NodeKind
  parentId: string | null
  /** The array the node lives in. `null` for `basics`, which has no siblings. */
  siblings: { id: string }[] | null
  index: number
  node: Record<string, unknown>
}

function locate(resume: Resume, id: string): Located | undefined {
  if (id === "basics") {
    return {
      kind: "basics",
      parentId: null,
      siblings: null,
      index: 0,
      node: resume.basics as unknown as Record<string, unknown>,
    }
  }

  const linkIndex = resume.basics.links.findIndex((l) => l.id === id)
  if (linkIndex !== -1) {
    const node = resume.basics.links[linkIndex]
    if (!node) return undefined
    return {
      kind: "link",
      parentId: "basics",
      siblings: resume.basics.links,
      index: linkIndex,
      node: node as unknown as Record<string, unknown>,
    }
  }

  const sectionIndex = resume.sections.findIndex((s) => s.id === id)
  if (sectionIndex !== -1) {
    const node = resume.sections[sectionIndex]
    if (!node) return undefined
    return {
      kind: "section",
      parentId: null,
      siblings: resume.sections,
      index: sectionIndex,
      node: node as unknown as Record<string, unknown>,
    }
  }

  for (const section of resume.sections) {
    const itemIndex = section.items.findIndex((i) => i.id === id)
    if (itemIndex !== -1) {
      const node = section.items[itemIndex]
      if (!node) return undefined
      return {
        kind: "item",
        parentId: section.id,
        siblings: section.items,
        index: itemIndex,
        node: node as unknown as Record<string, unknown>,
      }
    }
    for (const item of section.items) {
      if (item.kind === "skills") continue
      const bulletIndex = item.bullets.findIndex((b) => b.id === id)
      if (bulletIndex !== -1) {
        const node = item.bullets[bulletIndex]
        if (!node) return undefined
        return {
          kind: "bullet",
          parentId: item.id,
          siblings: item.bullets,
          index: bulletIndex,
          node: node as unknown as Record<string, unknown>,
        }
      }
    }
  }

  return undefined
}

/** The array `insert_after` would push into, given a parent node id. */
function childArray(
  resume: Resume,
  parentId: string
): { array: { id: string }[]; child: "link" | "item" | "bullet" } | undefined {
  if (parentId === "basics") {
    return { array: resume.basics.links, child: "link" }
  }
  const section = resume.sections.find((s) => s.id === parentId)
  if (section) return { array: section.items, child: "item" }
  for (const s of resume.sections) {
    const item = s.items.find((i) => i.id === parentId)
    if (item && item.kind !== "skills") {
      return { array: item.bullets, child: "bullet" }
    }
  }
  return undefined
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

/**
 * Applies patches in order on a structural copy. A failing patch is skipped
 * (or halts the run with `stopOnError`), and each success reports the inverse
 * patch that undoes it, which is what the editor's undo stack is built from.
 *
 * `allowInvalid` waives the final whole-document check, and only that check:
 * every per-patch rule still applies. Typing writes through on each keystroke,
 * so a field is invalid for as long as it takes to retype it, and refusing
 * those states puts the deleted character straight back in the box. The
 * editor's document is therefore allowed to be work in progress; `save` in the
 * session store is where a document has to be whole before it goes anywhere.
 */
export function applyPatches(
  resume: Resume,
  patches: ResumePatch[],
  opts: { stopOnError?: boolean; allowInvalid?: boolean } = {}
): ApplyResult {
  const draft = structuredClone(resume)
  const applied: AppliedPatch[] = []
  const failed: FailedPatch[] = []

  for (const patch of patches) {
    const outcome = applyOne(draft, patch)
    if ("code" in outcome) {
      failed.push({ patch, code: outcome.code, message: outcome.message })
      if (opts.stopOnError) break
      continue
    }
    applied.push(outcome)
  }

  const parsed = ResumeSchema.safeParse(draft)
  if (!parsed.success) {
    if (opts.allowInvalid) return { resume: draft, applied, failed }

    // The document as a whole is invalid, so nothing is applied. Attribute the
    // failure to the last patch, which is the one that broke it.
    const culprit = applied.at(-1)?.patch ?? patches.at(-1)
    return {
      resume,
      applied: [],
      failed: [
        ...failed,
        ...(culprit
          ? [
              {
                patch: culprit,
                code: "SCHEMA_INVALID" as const,
                message: parsed.error.issues[0]?.message ?? "Invalid document",
              },
            ]
          : []),
      ],
    }
  }

  return { resume: parsed.data, applied, failed }
}

type ApplyOne = AppliedPatch | { code: PatchErrorCode; message: string }

function applyOne(draft: Resume, patch: ResumePatch): ApplyOne {
  switch (patch.op) {
    case "replace_text": {
      const found = locate(draft, patch.targetNodeId)
      if (!found) {
        return { code: "TARGET_NOT_FOUND", message: patch.targetNodeId }
      }
      if (PROTECTED_FIELDS.has(patch.field)) {
        return { code: "FIELD_NOT_ALLOWED", message: patch.field }
      }
      const current = found.node[patch.field]
      if (typeof current !== "string") {
        return { code: "FIELD_NOT_ALLOWED", message: patch.field }
      }
      if (normalize(current) !== normalize(patch.before)) {
        return { code: "BEFORE_MISMATCH", message: patch.field }
      }
      found.node[patch.field] = patch.after
      return {
        patch,
        inverse: { ...patch, before: patch.after, after: current },
      }
    }

    case "update_fields": {
      const found = locate(draft, patch.targetNodeId)
      if (!found) {
        return { code: "TARGET_NOT_FOUND", message: patch.targetNodeId }
      }
      const before: Record<string, unknown> = {}
      for (const key of Object.keys(patch.after)) {
        if (PROTECTED_FIELDS.has(key)) {
          return { code: "FIELD_NOT_ALLOWED", message: key }
        }
        before[key] = found.node[key]
      }
      if (canonicalJson(before) !== canonicalJson(patch.before)) {
        return { code: "BEFORE_MISMATCH", message: patch.targetNodeId }
      }
      Object.assign(found.node, patch.after)
      return {
        patch,
        inverse: { ...patch, before: patch.after, after: before },
      }
    }

    case "insert_after": {
      const container = childArray(draft, patch.parentId)
      if (!container) {
        return { code: "PARENT_NOT_FOUND", message: patch.parentId }
      }
      const built = buildChild(container.child, patch.node)
      if (!built) {
        return { code: "KIND_MISMATCH", message: container.child }
      }
      const at =
        patch.afterNodeId === null
          ? 0
          : container.array.findIndex((n) => n.id === patch.afterNodeId) + 1
      if (patch.afterNodeId !== null && at === 0) {
        return { code: "TARGET_NOT_FOUND", message: patch.afterNodeId }
      }
      container.array.splice(at, 0, built.node)
      return {
        patch,
        assignedIds: built.ids,
        inverse: {
          op: "delete",
          reason: `Undo: ${patch.reason}`,
          skillId: patch.skillId,
          targetNodeId: built.node.id,
          before: built.node,
        },
      }
    }

    case "delete": {
      const found = locate(draft, patch.targetNodeId)
      if (!found?.siblings) {
        return { code: "TARGET_NOT_FOUND", message: patch.targetNodeId }
      }
      const removed = found.siblings.splice(found.index, 1)[0]
      if (!removed) {
        return { code: "TARGET_NOT_FOUND", message: patch.targetNodeId }
      }
      const previous = found.siblings[found.index - 1]
      return {
        patch,
        inverse: {
          op: "insert_after",
          reason: `Undo: ${patch.reason}`,
          skillId: patch.skillId,
          parentId: found.parentId ?? "basics",
          afterNodeId: previous?.id ?? null,
          node: removed,
        },
      }
    }

    case "move": {
      const found = locate(draft, patch.targetNodeId)
      if (!found?.siblings) {
        return { code: "TARGET_NOT_FOUND", message: patch.targetNodeId }
      }
      if (patch.toIndex >= found.siblings.length) {
        return { code: "INDEX_OUT_OF_RANGE", message: String(patch.toIndex) }
      }
      const moved = found.siblings.splice(found.index, 1)[0]
      if (!moved) {
        return { code: "TARGET_NOT_FOUND", message: patch.targetNodeId }
      }
      found.siblings.splice(patch.toIndex, 0, moved)
      return { patch, inverse: { ...patch, toIndex: found.index } }
    }
  }
}

/**
 * Parses a model-supplied node against the schema for its slot and stamps fresh
 * ids on it and every descendant. Ids the model supplied are always discarded.
 */
function buildChild(
  child: "link" | "item" | "bullet",
  raw: unknown
):
  | { node: { id: string } & Record<string, unknown>; ids: string[] }
  | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const ids: string[] = []

  if (child === "link") {
    const id = newId("lnk")
    const parsed = LinkSchema.safeParse({ ...raw, id })
    if (!parsed.success) return undefined
    ids.push(id)
    return {
      node: parsed.data as unknown as Link & Record<string, unknown>,
      ids,
    }
  }

  if (child === "bullet") {
    const id = newId("bul")
    const parsed = BulletSchema.safeParse({ ...raw, id })
    if (!parsed.success) return undefined
    ids.push(id)
    return {
      node: parsed.data as unknown as Bullet & Record<string, unknown>,
      ids,
    }
  }

  const kind = (raw as Record<string, unknown>).kind
  if (typeof kind !== "string" || !(kind in ITEM_PREFIX)) return undefined
  const id = newId(ITEM_PREFIX[kind as keyof typeof ITEM_PREFIX])
  const bullets = Array.isArray((raw as Record<string, unknown>).bullets)
    ? ((raw as Record<string, unknown>).bullets as unknown[]).map((b) => {
        const bulletId = newId("bul")
        ids.push(bulletId)
        return { ...(b as object), id: bulletId }
      })
    : undefined
  const candidate = {
    ...raw,
    id,
    ...(bullets ? { bullets } : {}),
  }
  const parsed = ItemSchema.safeParse(candidate)
  if (!parsed.success) return undefined
  ids.unshift(id)
  return { node: parsed.data as unknown as Item & Record<string, unknown>, ids }
}

/* --------------------------------------------------------------- validate */

export type ValidationContext = {
  allowedOps: PatchOp[]
  /** Narrows `textFields` further, per skill. */
  allowedFields?: Partial<Record<NodeKind, string[]>>
  /** When set, every target must be this node or a descendant of it. */
  scopeNodeId?: string
  /** User message + job description + all resume text. */
  groundingText: string
}

export type RejectedPatch = {
  index: number
  code: PatchErrorCode
  message: string
}

export type ValidationResult = {
  valid: ResumePatch[]
  rejected: RejectedPatch[]
}

const NUMBER_TOKEN = /\d[\d,.]*%?/g

function numbersIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(NUMBER_TOKEN)) out.add(match[0])
    return out
  }
  if (Array.isArray(value)) {
    for (const entry of value) numbersIn(entry, out)
    return out
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) numbersIn(entry, out)
  }
  return out
}

/**
 * The deterministic gate every model-proposed patch passes through, on the
 * server before persisting and again at accept time against the current head.
 * Rule 10 (grounding) is what stops the model inventing metrics.
 */
export function validatePatches(
  resume: Resume,
  patches: unknown[],
  ctx: ValidationContext
): ValidationResult {
  const valid: ResumePatch[] = []
  const rejected: RejectedPatch[] = []
  const index = indexNodes(resume)
  const grounding = ctx.groundingText

  patches.forEach((raw, i) => {
    const reject = (code: PatchErrorCode, message: string) => {
      rejected.push({ index: i, code, message })
    }

    // 1. Shape.
    const parsed = ResumePatchSchema.safeParse(raw)
    if (!parsed.success) {
      reject("SCHEMA_INVALID", parsed.error.issues[0]?.message ?? "Bad patch")
      return
    }
    const patch = parsed.data

    // 2. Op allowed for this skill.
    if (!ctx.allowedOps.includes(patch.op)) {
      reject("OP_NOT_ALLOWED", patch.op)
      return
    }

    // 3. Target or parent exists.
    let target: NodeRef | undefined
    if (patch.op === "insert_after") {
      if (!index.has(patch.parentId)) {
        reject("PARENT_NOT_FOUND", patch.parentId)
        return
      }
      if (patch.afterNodeId && !index.has(patch.afterNodeId)) {
        reject("TARGET_NOT_FOUND", patch.afterNodeId)
        return
      }
      target = index.get(patch.parentId)
    } else {
      target = index.get(patch.targetNodeId)
      if (!target) {
        reject("TARGET_NOT_FOUND", patch.targetNodeId)
        return
      }
    }

    // 4. Scope.
    if (ctx.scopeNodeId) {
      const id =
        patch.op === "insert_after" ? patch.parentId : patch.targetNodeId
      if (!isWithin(resume, id, ctx.scopeNodeId)) {
        reject("OUT_OF_SCOPE", id)
        return
      }
    }

    // 5. Field allowed.
    if (patch.op === "replace_text" && target) {
      const allowed = textFields(target.kind, target.node)
      const narrowed = ctx.allowedFields?.[target.kind]
      if (
        !allowed.includes(patch.field) ||
        (narrowed && !narrowed.includes(patch.field))
      ) {
        reject("FIELD_NOT_ALLOWED", patch.field)
        return
      }
    }
    if (patch.op === "update_fields") {
      for (const key of Object.keys(patch.after)) {
        if (PROTECTED_FIELDS.has(key)) {
          reject("FIELD_NOT_ALLOWED", key)
          return
        }
      }
    }

    // 8. Move bounds.
    if (patch.op === "move" && target) {
      const parent = target.parentId ? index.get(target.parentId) : null
      const size = siblingCount(resume, target)
      if (patch.toIndex >= size) {
        reject("INDEX_OUT_OF_RANGE", `${patch.toIndex} of ${size}`)
        return
      }
      void parent
    }

    // 9. Non-empty text.
    if (patch.op === "replace_text" && patch.after.trim() === "") {
      reject("EMPTY_TEXT", patch.field)
      return
    }

    // 10. Grounding: every number in the proposed text must already exist.
    const proposed =
      patch.op === "replace_text"
        ? patch.after
        : patch.op === "update_fields"
          ? patch.after
          : patch.op === "insert_after"
            ? patch.node
            : null
    if (proposed !== null) {
      const source =
        patch.op === "replace_text"
          ? `${patch.before}\n${grounding}`
          : grounding
      for (const token of numbersIn(proposed)) {
        if (!source.includes(token)) {
          reject("UNGROUNDED_NUMBER", token)
          return
        }
      }
    }

    // 6 and 11. Dry-run against the accumulated set, which also checks
    // `before` equality and re-validates the whole document.
    const dry = applyPatches(resume, [...valid, patch], { stopOnError: true })
    const problem = dry.failed[0]
    if (problem) {
      reject(problem.code, problem.message)
      return
    }

    valid.push(patch)
  })

  return { valid, rejected }
}

function siblingCount(resume: Resume, ref: NodeRef): number {
  switch (ref.kind) {
    case "section":
      return resume.sections.length
    case "link":
      return resume.basics.links.length
    case "item": {
      const section = resume.sections.find((s) => s.id === ref.parentId)
      return section?.items.length ?? 0
    }
    case "bullet": {
      for (const s of resume.sections) {
        const item = s.items.find((i) => i.id === ref.parentId)
        if (item && item.kind !== "skills") return item.bullets.length
      }
      return 0
    }
    default:
      return 1
  }
}
