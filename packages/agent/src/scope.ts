import { indexNodes, type NodeRef } from "@workspace/resume-schema"

import type { SkillContext, SkillScope } from "./skills/types"

export function wholeDocument(ctx: SkillContext): SkillScope {
  return { resumeContext: ctx.resume }
}

/**
 * The node-scoped rule from the back-end design, 10.2: with a selection, send
 * the containing item plus the headline and confine patches to that item.
 * A selection outside any item (basics, a section) scopes to itself. An id
 * that no longer exists falls back to the whole document rather than failing
 * the run, since the user may have deleted the node after selecting it.
 */
export function nodeScope(ctx: SkillContext): SkillScope {
  if (!ctx.selectedNodeId) return wholeDocument(ctx)
  const index = indexNodes(ctx.resume)
  const selected = index.get(ctx.selectedNodeId)
  if (!selected) return wholeDocument(ctx)

  const anchor = containingUnit(index, selected)
  return {
    scopeNodeId: anchor.id,
    resumeContext: {
      basics: { id: "basics", headline: ctx.resume.basics.headline },
      selected: anchor.node,
    },
  }
}

/** Walks up from a bullet or link to the item or basics that holds it. */
function containingUnit(index: Map<string, NodeRef>, ref: NodeRef): NodeRef {
  let current = ref
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
