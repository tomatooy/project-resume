import { indexNodes, ROOT_PARENT, type Resume } from "@workspace/resume-schema"
import { onePage } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import { validateForRun } from "../src/domain/validation"

type Bullet = { id: string; text: string; itemId: string }

function bullets(resume: Resume): Bullet[] {
  const found: Bullet[] = []
  for (const ref of indexNodes(resume).values()) {
    if (ref.kind !== "bullet" || !ref.parentId) continue
    const node = ref.node
    if (
      typeof node === "object" &&
      node !== null &&
      "id" in node &&
      "text" in node &&
      typeof node.id === "string" &&
      typeof node.text === "string"
    ) {
      found.push({ id: node.id, text: node.text, itemId: ref.parentId })
    }
  }
  return found
}

const resume = onePage
const all = bullets(resume)
const bullet = all[0]
const otherBullet = all.find((b) => b.itemId !== bullet?.itemId)
if (!bullet || !otherBullet)
  throw new Error("fixture needs bullets in two items")

function rewrite(target: Bullet, after: string, skillId = "bullet_rewrite") {
  return {
    op: "replace_text",
    skillId,
    targetNodeId: target.id,
    field: "text",
    before: target.text,
    after,
    reason: "Leads with the outcome.",
  }
}

/** A propose-mode context for the assistant, with structural edits off. */
function propose(selectedNodeId?: string) {
  return {
    mode: "propose" as const,
    allowStructural: false,
    selectedNodeId,
  }
}

describe("validateForRun scope", () => {
  it("confines patches to the item holding the selection", () => {
    const result = validateForRun(
      resume,
      [
        rewrite(bullet, "Cut deploy time."),
        rewrite(otherBullet, "Led the team."),
      ],
      propose(bullet.id)
    )
    expect(result.valid).toHaveLength(1)
    expect(result.rejected).toEqual([
      { index: 1, code: "OUT_OF_SCOPE", message: otherBullet.id },
    ])
  })

  it("leaves patches free to edit past the selection when nothing was selected", () => {
    const result = validateForRun(
      resume,
      [rewrite(otherBullet, "Led the team.")],
      propose()
    )
    expect(result.rejected).toEqual([])
  })

  it("applies the same scope when the suggestion is accepted later", () => {
    const result = validateForRun(resume, [rewrite(otherBullet, "Led it.")], {
      mode: "reapply",
      allowStructural: false,
      selectedNodeId: bullet.id,
    })
    expect(result.rejected[0]?.code).toBe("OUT_OF_SCOPE")
  })
})

describe("validateForRun tiers", () => {
  const item = onePage.sections[0]?.items[0]
  if (!item) throw new Error("fixture needs an item")

  it("refuses a structural patch when the request did not enable it", () => {
    const result = validateForRun(
      resume,
      [
        {
          op: "delete",
          skillId: "bullet_rewrite",
          targetNodeId: item.id,
          before: item,
          reason: "No longer relevant.",
        },
      ],
      propose()
    )
    expect(result.rejected[0]?.code).toBe("STRUCTURAL_NOT_REQUESTED")
  })

  it("accepts it on a turn that enabled structural edits", () => {
    const result = validateForRun(
      resume,
      [
        {
          op: "delete",
          skillId: "bullet_rewrite",
          targetNodeId: item.id,
          before: item,
          reason: "No longer relevant.",
        },
      ],
      { mode: "propose", allowStructural: true }
    )
    expect(result.rejected).toEqual([])
    expect(result.valid).toHaveLength(1)
  })

  it("keeps the root outside any scope, since a selection is never the document", () => {
    const result = validateForRun(
      resume,
      [
        {
          op: "insert_after",
          skillId: "bullet_rewrite",
          parentId: ROOT_PARENT,
          afterNodeId: null,
          node: { type: "custom", title: "Speaking", items: [] },
          reason: "Adds a section.",
        },
      ],
      { mode: "propose", allowStructural: true, selectedNodeId: bullet.id }
    )
    expect(result.rejected[0]?.code).toBe("OUT_OF_SCOPE")
  })
})
