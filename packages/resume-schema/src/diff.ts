import { canonicalJson } from "./hash"
import { breadcrumb, indexNodes, type NodeKind } from "./nodes"
import type { Resume } from "./schema"

export type FieldChange = {
  field: string
  /** Absent when the field was not set on that side of the change. */
  before?: string
  after?: string
}

export type NodeDiff = {
  id: string
  kind: NodeKind
  change: "added" | "removed" | "changed" | "moved"
  /** Human path in the document the change belongs to. */
  label: string
  /**
   * Which of the node's own fields differ, for `changed` only. Present so a
   * reader can see what the text went from and to without being handed two
   * whole nodes to compare themselves.
   */
  fields?: FieldChange[]
  before?: unknown
  after?: unknown
}

/**
 * Node-level diff keyed by id, used by History compare. Content changes ignore
 * child collections, so editing a bullet reports the bullet, not its whole job.
 */
export function diffDocuments(a: Resume, b: Resume): NodeDiff[] {
  const left = indexNodes(a)
  const right = indexNodes(b)
  const out: NodeDiff[] = []

  for (const [id, ref] of left) {
    const other = right.get(id)
    if (!other) {
      out.push({
        id,
        kind: ref.kind,
        change: "removed",
        label: breadcrumb(a, id),
        before: ref.node,
      })
      continue
    }
    if (
      canonicalJson(shallow(ref.node)) !== canonicalJson(shallow(other.node))
    ) {
      out.push({
        id,
        kind: ref.kind,
        change: "changed",
        label: breadcrumb(b, id),
        fields: changedFields(shallow(ref.node), shallow(other.node)),
        before: ref.node,
        after: other.node,
      })
    } else if (ref.index !== other.index || ref.parentId !== other.parentId) {
      out.push({
        id,
        kind: ref.kind,
        change: "moved",
        label: breadcrumb(b, id),
        before: ref.index,
        after: other.index,
      })
    }
  }

  for (const [id, ref] of right) {
    if (left.has(id)) continue
    out.push({
      id,
      kind: ref.kind,
      change: "added",
      label: breadcrumb(b, id),
      after: ref.node,
    })
  }

  return out
}

/**
 * The own fields that differ. `id` and `kind` are identity, not content: a node
 * is only matched to its counterpart because they are equal.
 */
function changedFields(before: unknown, after: unknown): FieldChange[] {
  const left = fieldsOf(before)
  const right = fieldsOf(after)
  const out: FieldChange[] = []

  for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (field === "id" || field === "kind") continue
    const from = display(left[field])
    const to = display(right[field])
    if (from !== to) out.push({ field, before: from, after: to })
  }
  return out
}

function fieldsOf(node: unknown): Record<string, unknown> {
  return typeof node === "object" && node !== null
    ? (node as Record<string, unknown>)
    : {}
}

/**
 * One string per value so a caller can render a change without re-deriving how
 * each field is shaped. An unset field reads as absent rather than as the
 * string "undefined", which a reader would take for content.
 */
function display(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string").join(", ")
  }
  if (typeof value === "object") return canonicalJson(value)
  return String(value)
}

/** Drop child collections so a node is compared on its own fields only. */
function shallow(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node
  const {
    items: _i,
    bullets: _b,
    links: _l,
    ...rest
  } = node as Record<string, unknown>
  return rest
}
