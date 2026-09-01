import { canonicalJson } from "./hash"
import { breadcrumb, indexNodes, type NodeKind } from "./nodes"
import type { Resume } from "./schema"

export type NodeDiff = {
  id: string
  kind: NodeKind
  change: "added" | "removed" | "changed" | "moved"
  /** Human path in the document the change belongs to. */
  label: string
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
