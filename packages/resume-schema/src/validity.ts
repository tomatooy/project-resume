import { ResumeSchema, type Resume } from "./schema"
import { indexNodes } from "./nodes"

/** First message per field, keyed by field name, for one node. */
export type NodeErrors = Readonly<Record<string, string>>

export type DocumentValidity = {
  /** Field errors by node id. A node that validates is absent. */
  byNode: Readonly<Record<string, NodeErrors>>
  /** Whether the document parses whole, which is what a write requires. */
  savable: boolean
}

/** Stable identity, so a clean node does not re-render its editor. */
export const NO_ERRORS: NodeErrors = Object.freeze({})

const VALID: DocumentValidity = Object.freeze({
  byNode: Object.freeze({}),
  savable: true,
})

function isPrefix(prefix: (string | number)[], path: PropertyKey[]): boolean {
  if (prefix.length > path.length) return false
  return prefix.every((segment, i) => segment === path[i])
}

/**
 * Every validity question the editor asks, answered by one parse.
 *
 * Field errors and savability used to be two checks on two clocks: each pane
 * parsed its own node on every keystroke, while `save` parsed the document
 * behind the autosave debounce. The save bar could not report a broken field
 * until the debounce fired, and the two could disagree about what counts as
 * broken. Here the whole-document parse is the only authority, and the field
 * errors are that parse's own issues attributed back to the nodes they came
 * from, so nothing can drift.
 *
 * Attribution is by longest matching node path, so an error inside an item
 * belongs to the item rather than to the section holding it. Issues that name
 * no field of any node (a duplicate id, a section that is too long) are left
 * out of `byNode`; they still make the document unsavable.
 */
export function documentErrors(resume: Resume): DocumentValidity {
  const result = ResumeSchema.safeParse(resume)
  if (result.success) return VALID

  const nodes = [...indexNodes(resume).values()].sort(
    (a, b) => b.path.length - a.path.length
  )

  const byNode: Record<string, Record<string, string>> = {}
  for (const issue of result.error.issues) {
    const owner = nodes.find((ref) => isPrefix(ref.path, issue.path))
    if (!owner) continue
    const field = issue.path[owner.path.length]
    if (typeof field !== "string") continue
    const errors = byNode[owner.id] ?? {}
    byNode[owner.id] = errors
    errors[field] ??= issue.message
  }

  return { byNode, savable: false }
}
