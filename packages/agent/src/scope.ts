import { scopeAnchor } from "@workspace/resume-schema"

import type { SkillContext, SkillScope } from "./skills/types"

export function wholeDocument(ctx: SkillContext): SkillScope {
  return { resumeContext: ctx.resume }
}

/**
 * The node-scoped rule from the back-end design, 10.2: with a selection, send
 * the containing item plus the headline. A selection outside any item (basics,
 * a section) scopes to itself. An id that no longer exists falls back to the
 * whole document rather than failing the run, since the user may have deleted
 * the node after selecting it.
 *
 * This decides what the model is *shown*. What it is allowed to *change* is
 * derived from the same anchor by `validateForSkill`, so the two cannot drift.
 */
export function nodeScope(ctx: SkillContext): SkillScope {
  if (!ctx.selectedNodeId) return wholeDocument(ctx)
  const anchor = scopeAnchor(ctx.resume, ctx.selectedNodeId)
  if (!anchor) return wholeDocument(ctx)

  return {
    resumeContext: {
      basics: { id: "basics", headline: ctx.resume.basics.headline },
      selected: anchor.node,
    },
  }
}
