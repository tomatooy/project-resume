import { z } from "zod"
import { ITEM_PREFIX, newId } from "./ids"
import { canonicalJson } from "./hash"
import {
  indexNodes,
  isWithin,
  type NodeKind,
  type NodeRef,
  nodeField,
  textFields,
} from "./nodes"
import {
  BulletSchema,
  ItemSchema,
  LinkSchema,
  NodeId,
  ResumeSchema,
  SectionSchema,
  type Bullet,
  type Item,
  type Link,
  type Resume,
  type Section,
} from "./schema"

/* ------------------------------------------------------------------ types */

/**
 * The parent the top-level sections live under. They have no node to name, so
 * `insert_after` and `move` address their container as `"root"`. It is a
 * pseudo-parent: it is never a target and never a real node, so the checks
 * that walk the document treat it as outside every scope.
 */
export const ROOT_PARENT = "root"

/** A node id, or the root pseudo-parent. */
export const ParentId = z.union([NodeId, z.literal(ROOT_PARENT)])

const Common = z.object({
  reason: z.string().max(500),
  /**
   * Which playbook shaped this patch. Attribution only: never validated, never
   * an enforcement key, and absent on a patch the editor built by hand or a
   * model that forgot to tag it.
   */
  skillId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const ReplaceText = Common.extend({
  op: z.literal("replace_text"),
  targetNodeId: NodeId,
  field: z.string(),
  before: z.string(),
  after: z.string().min(1),
})

/**
 * Both records cover the same key set. A key that is absent from the node and
 * a key whose value is `null` are the same state, so `null` in `after` clears
 * the field and `null` in `before` says the field is currently absent.
 */
export const UpdateFields = Common.extend({
  op: z.literal("update_fields"),
  targetNodeId: NodeId,
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
})

export const InsertAfter = Common.extend({
  op: z.literal("insert_after"),
  parentId: ParentId,
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
  /** Absent, or the node's own parent, means a reorder among its siblings. */
  toParentId: ParentId.optional(),
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
  "OUT_OF_SCOPE",
  "INDEX_OUT_OF_RANGE",
  "STRUCTURAL_NOT_REQUESTED",
  "REQUIRED_FIELD",
] as const

export type PatchErrorCode = (typeof PATCH_ERROR_CODES)[number]

/**
 * Fields no patch may ever write, because they are structural. `type` is here
 * for the same reason as `kind`: rewriting it would re-interpret every item in
 * the section.
 */
const PROTECTED_FIELDS = new Set([
  "id",
  "kind",
  "type",
  "items",
  "bullets",
  "links",
])

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

/**
 * `ok: false` means the whole-document check failed and nothing was applied,
 * so there is no document to read. Keeping the resume off that branch is the
 * point: the previous single entry point returned the *input* document there,
 * and a caller reading `.resume` without looking at `.failed` silently carried
 * on with an unpatched document.
 */
export type StrictApplyResult =
  | ({ ok: true } & ApplyResult)
  | { ok: false; failed: FailedPatch[] }

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

/** The kind of node a container array holds. */
type ChildKind = "section" | "item" | "bullet" | "link"

/** The array `insert_after` would push into, given a parent node id. */
function childArray(
  resume: Resume,
  parentId: string
): { array: { id: string }[]; child: ChildKind } | undefined {
  if (parentId === ROOT_PARENT) {
    return { array: resume.sections, child: "section" }
  }
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

/** `update_fields` needs both records to cover the same keys, or an inverse is
 * not expressible. */
function sameKeySet(before: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(before)
  return own.length === keys.length && keys.every((key) => key in before)
}

type ApplyOpts = { stopOnError?: boolean }

/** Runs the patches on a copy. Shared by both entry points. */
function run(
  resume: Resume,
  patches: ResumePatch[],
  opts: ApplyOpts
): { draft: Resume; applied: AppliedPatch[]; failed: FailedPatch[] } {
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

  return { draft, applied, failed }
}

/**
 * Applies patches in order on a structural copy, requiring the result to be a
 * whole valid document. A failing patch is skipped (or halts the run with
 * `stopOnError`), and each success reports the inverse patch that undoes it.
 *
 * Use this everywhere a document is about to be persisted, measured, or shown
 * as the effect of a proposal. The `ok: false` branch carries no resume, so
 * the "silently kept the unpatched document" reading is not expressible.
 */
export function applyStrict(
  resume: Resume,
  patches: ResumePatch[],
  opts: ApplyOpts = {}
): StrictApplyResult {
  const { draft, applied, failed } = run(resume, patches, opts)

  const parsed = ResumeSchema.safeParse(draft)
  if (!parsed.success) {
    // Attribute the failure to the last patch, which is the one that broke it.
    const culprit = applied.at(-1)?.patch ?? patches.at(-1)
    return {
      ok: false,
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

  return { ok: true, resume: parsed.data, applied, failed }
}

/**
 * Applies patches without the final whole-document check, and only that check:
 * every per-patch rule still applies. Typing writes through on each keystroke,
 * so a field is invalid for as long as it takes to retype it, and refusing
 * those states puts the deleted character straight back in the box. The
 * editor's document is therefore allowed to be work in progress; `save` in the
 * session store is where a document has to be whole before it goes anywhere.
 *
 * This is the editor's entry point and nothing else's.
 */
export function applyDraft(
  resume: Resume,
  patches: ResumePatch[],
  opts: ApplyOpts = {}
): ApplyResult {
  const { draft, applied, failed } = run(resume, patches, opts)
  const parsed = ResumeSchema.safeParse(draft)
  return { resume: parsed.success ? parsed.data : draft, applied, failed }
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
      const keys = Object.keys(patch.after)
      if (!sameKeySet(patch.before, keys)) {
        return {
          code: "BEFORE_MISMATCH",
          message: "before and after must list the same fields",
        }
      }
      const previous: Record<string, unknown> = {}
      const expected: Record<string, unknown> = {}
      for (const key of keys) {
        if (PROTECTED_FIELDS.has(key)) {
          return { code: "FIELD_NOT_ALLOWED", message: key }
        }
        const field = nodeField(found.kind, found.node, key)
        if (!field) return { code: "FIELD_NOT_ALLOWED", message: key }
        if (field === "required" && (patch.after[key] ?? null) === null) {
          return { code: "REQUIRED_FIELD", message: key }
        }
        // Absent and null are the same state on both sides, so an inverse is
        // exact and "was it empty or missing?" never has to be answered.
        previous[key] = found.node[key] ?? null
        expected[key] = patch.before[key] ?? null
      }
      if (canonicalJson(expected) !== canonicalJson(previous)) {
        return { code: "BEFORE_MISMATCH", message: patch.targetNodeId }
      }
      for (const key of keys) {
        const value = patch.after[key] ?? null
        if (value === null) {
          delete found.node[key]
        } else {
          found.node[key] = value
        }
      }
      return {
        patch,
        inverse: { ...patch, before: patch.after, after: previous },
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
          // A section has no parent node, so its inverse is an insert into
          // the root. Naming a real parent here produced a `basics` insert
          // that failed the kind check, which is why undo after deleting a
          // section used to do nothing.
          parentId: found.parentId ?? ROOT_PARENT,
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
      const currentParent = found.parentId ?? ROOT_PARENT
      const toParentId = patch.toParentId

      if (toParentId !== undefined && toParentId !== currentParent) {
        const destination = childArray(draft, toParentId)
        if (!destination) {
          return { code: "PARENT_NOT_FOUND", message: toParentId }
        }
        if (destination.child !== found.kind) {
          return { code: "KIND_MISMATCH", message: destination.child }
        }
        if (patch.toIndex > destination.array.length) {
          return {
            code: "INDEX_OUT_OF_RANGE",
            message: `${patch.toIndex} of ${destination.array.length + 1}`,
          }
        }
        const moved = found.siblings.splice(found.index, 1)[0]
        if (!moved) {
          return { code: "TARGET_NOT_FOUND", message: patch.targetNodeId }
        }
        destination.array.splice(patch.toIndex, 0, moved)
        return {
          patch,
          inverse: {
            ...patch,
            toParentId: currentParent,
            toIndex: found.index,
          },
        }
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
  child: ChildKind,
  raw: unknown
):
  | { node: { id: string } & Record<string, unknown>; ids: string[] }
  | undefined {
  if (typeof raw !== "object" || raw === null) return undefined

  if (child === "link") {
    const id = newId("lnk")
    const parsed = LinkSchema.safeParse({ ...raw, id })
    if (!parsed.success) return undefined
    return {
      node: parsed.data as unknown as Link & Record<string, unknown>,
      ids: [id],
    }
  }

  if (child === "bullet") {
    const id = newId("bul")
    const parsed = BulletSchema.safeParse({ ...raw, id })
    if (!parsed.success) return undefined
    return {
      node: parsed.data as unknown as Bullet & Record<string, unknown>,
      ids: [id],
    }
  }

  if (child === "section") {
    const id = newId("sec")
    const record = raw as Record<string, unknown>
    const rawItems = Array.isArray(record.items) ? record.items : undefined
    const built = rawItems?.map(stampItem)
    if (built?.some((entry) => entry === undefined)) return undefined
    const items = built?.flatMap((entry) => (entry ? [entry.node] : []))
    const parsed = SectionSchema.safeParse({
      ...record,
      id,
      ...(items ? { items } : {}),
    })
    if (!parsed.success) return undefined
    return {
      node: parsed.data as unknown as Section & Record<string, unknown>,
      ids: [id, ...(built ?? []).flatMap((entry) => entry?.ids ?? [])],
    }
  }

  const built = stampItem(raw)
  if (!built) return undefined
  const node = built.node as Item & Record<string, unknown>
  return { node, ids: built.ids }
}

/** The item branch, shared by a section insert and an insert into a section. */
function stampItem(raw: unknown): { node: Item; ids: string[] } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== "string" || !(kind in ITEM_PREFIX)) return undefined
  const id = newId(ITEM_PREFIX[kind as keyof typeof ITEM_PREFIX])
  const rawBullets = Array.isArray(record.bullets) ? record.bullets : undefined
  const bullets = rawBullets?.map((bullet) => ({
    ...(bullet as object),
    id: newId("bul"),
  }))
  const parsed = ItemSchema.safeParse({
    ...record,
    id,
    ...(bullets ? { bullets } : {}),
  })
  if (!parsed.success) return undefined
  return {
    node: parsed.data,
    ids: [id, ...(bullets ?? []).map((bullet) => bullet.id)],
  }
}

/* --------------------------------------------------------------- validate */

export type ValidationContext = {
  /** The user asked for this turn to be able to restructure the document. */
  allowStructural: boolean
  /** When set, every target must be this node or a descendant of it. */
  scopeNodeId?: string
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

/**
 * What kind of request a patch needs, computed from the patch and the
 * document rather than stated by the model or the client.
 *
 * The panel recomputes the same answer for a card's treatment and for the
 * bulk accept, from this one function, so what the user sees as destructive
 * is what the server refuses without the flag.
 *
 * Returns the reason phrase, or `undefined` when the patch is a content edit.
 */
export function structuralReason(
  resume: Resume,
  patch: ResumePatch
): string | undefined {
  const index = indexNodes(resume)
  const target =
    patch.op === "insert_after"
      ? index.get(patch.parentId)
      : index.get(patch.targetNodeId)
  return tierReason(index, patch, target)
}

/** The same answer when the caller already holds the index and the target. */
function tierReason(
  index: Map<string, NodeRef>,
  patch: ResumePatch,
  target: NodeRef | undefined
): string | undefined {
  switch (patch.op) {
    case "delete":
      if (target?.kind === "item") return "delete an item"
      if (target?.kind === "section") return "delete a section"
      return undefined
    case "insert_after":
      if (patch.parentId === ROOT_PARENT) return "add a section"
      if (index.get(patch.parentId)?.kind === "section") return "add an item"
      return undefined
    case "move": {
      if (patch.toParentId === undefined) return undefined
      const current = target ? (target.parentId ?? ROOT_PARENT) : undefined
      return patch.toParentId === current
        ? undefined
        : "move a node to another container"
    }
    default:
      return undefined
  }
}

/* ------------------------------------------------------ estimate figures */

/**
 * A quantity in resume prose: `40`, `1,000`, `99.9`, `250+`, `2x`, `75%`.
 * The leading guard keeps identifiers out (`EC2`, `S3`, `AES256`, `p99`).
 */
const FIGURE =
  /(?:^|[^A-Za-z0-9])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:x|%)?\+?)/g

/** Keys whose strings are not a claim: identity, type, and the dates. */
const NOT_CLAIM = new Set(["id", "kind", "type", "start", "end"])

/**
 * The figures a patch writes that the document does not already state, in the
 * order they appear (`["40", "250+"]`). A range yields one entry per figure.
 *
 * Not a gate. A figure the user cannot stand behind in an interview costs more
 * than the bullet gains, so the panel turns these into a note to check before
 * accepting, and the playbooks prefer a conservative shape. A figure the
 * source already states is not reported, and commas do not make two figures of
 * one (`1,000`).
 */
export function addedFigures(resume: Resume, patch: ResumePatch): string[] {
  const known = new Set(figuresIn(claimText(resume).join("\n")).keys())
  const out: string[] = []
  for (const [figure, display] of figuresIn(addedText(patch))) {
    if (!known.has(figure)) out.push(display)
  }
  return out
}

/** Normalized figure to the first spelling it appeared in. */
function figuresIn(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(FIGURE)) {
    const display = match[1]
    if (display === undefined) continue
    const figure = display.replaceAll(",", "")
    if (!found.has(figure)) found.set(figure, display)
  }
  return found
}

/**
 * The text that can back a figure. Not `collectText`: a digit in the phone
 * number, the email or a start date is not a claim, and counting it as one
 * would silence the note for a figure the resume does not actually state.
 */
function claimText(resume: Resume): string[] {
  const out: string[] = [resume.basics.name]
  const basics = resume.basics
  if (basics.headline) out.push(basics.headline)
  if (basics.location) out.push(basics.location)
  if (basics.summary) out.push(basics.summary)
  collectStrings(basics.links, out)
  collectStrings(resume.sections, out)
  return out
}

/** Every string a patch adds, wherever the op keeps it. */
function addedText(patch: ResumePatch): string {
  const out: string[] = []
  if (patch.op === "replace_text") out.push(patch.after)
  if (patch.op === "update_fields") collectStrings(patch.after, out)
  if (patch.op === "insert_after") collectStrings(patch.node, out)
  return out.join("\n")
}

/** Strings inside an unknown node, minus the keys that are never claims. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out)
    return
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (NOT_CLAIM.has(key)) continue
      collectStrings(entry, out)
    }
  }
}

/**
 * The deterministic gate every model-proposed patch passes through, on the
 * server before persisting and again at accept time against the current head.
 * Shape, tier, scope, field limits, and a dry run of the whole set.
 */
export function validatePatches(
  resume: Resume,
  patches: unknown[],
  ctx: ValidationContext
): ValidationResult {
  const valid: ResumePatch[] = []
  const rejected: RejectedPatch[] = []
  const index = indexNodes(resume)

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

    // 2. Target or parent exists. `"root"` is the pseudo-parent the top-level
    // sections live under, so it is present by definition.
    let target: NodeRef | undefined
    if (patch.op === "insert_after") {
      if (patch.parentId !== ROOT_PARENT && !index.has(patch.parentId)) {
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

    // 3. Tier. The user asked for restructuring, or this is refused.
    const structural = tierReason(index, patch, target)
    if (structural && !ctx.allowStructural) {
      reject("STRUCTURAL_NOT_REQUESTED", structural)
      return
    }

    // 4. Scope. `"root"` is outside every scope, because a selection is never
    // the whole document.
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
      if (!allowed.includes(patch.field)) {
        reject("FIELD_NOT_ALLOWED", patch.field)
        return
      }
    }
    if (patch.op === "update_fields" && target) {
      if (!sameKeySet(patch.before, Object.keys(patch.after))) {
        reject("BEFORE_MISMATCH", "before and after must list the same fields")
        return
      }
      for (const key of Object.keys(patch.after)) {
        if (PROTECTED_FIELDS.has(key)) {
          reject("FIELD_NOT_ALLOWED", key)
          return
        }
        const field = nodeField(target.kind, target.node, key)
        if (!field) {
          reject("FIELD_NOT_ALLOWED", key)
          return
        }
        if (field === "required" && (patch.after[key] ?? null) === null) {
          reject("REQUIRED_FIELD", key)
          return
        }
      }
    }

    // 6. Move bounds, against the destination when the move crosses parents.
    if (patch.op === "move" && target) {
      const toParentId = patch.toParentId
      if (
        toParentId !== undefined &&
        toParentId !== (target.parentId ?? ROOT_PARENT)
      ) {
        const destination = childArray(resume, toParentId)
        if (!destination) {
          reject("PARENT_NOT_FOUND", toParentId)
          return
        }
        if (patch.toIndex > destination.array.length) {
          reject(
            "INDEX_OUT_OF_RANGE",
            `${patch.toIndex} of ${destination.array.length + 1}`
          )
          return
        }
      } else if (patch.toIndex >= siblingCount(resume, target)) {
        reject("INDEX_OUT_OF_RANGE", `${patch.toIndex}`)
        return
      }
    }

    // 7. Non-empty text.
    if (patch.op === "replace_text" && patch.after.trim() === "") {
      reject("EMPTY_TEXT", patch.field)
      return
    }

    // Dry-run against the accumulated set: `before` equality,
    // `insert_after.node` parsing as the parent's child kind (reported as
    // KIND_MISMATCH), and the whole-document re-check.
    const dry = applyStrict(resume, [...valid, patch], { stopOnError: true })
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
