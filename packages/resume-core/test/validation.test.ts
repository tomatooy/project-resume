import { indexNodes, type Resume } from "@workspace/resume-schema"
import { onePage } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import { stampSkillId, validateForSkill } from "../src/domain/validation"

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

/** Everything the model saw, so grounding is satisfied by default. */
function propose(selectedNodeId?: string, skillId = "bullet_rewrite") {
  return {
    mode: "propose" as const,
    skillId,
    selectedNodeId,
    userMessage: "Tighten this up",
  }
}

describe("validateForSkill scope", () => {
  it("confines a node-scoped skill to the item holding the selection", () => {
    const result = validateForSkill(
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

  it("leaves a whole-document skill free to edit past the selection", () => {
    const result = validateForSkill(
      resume,
      [rewrite(otherBullet, "Led the team.", "jd_match")],
      { ...propose(bullet.id, "jd_match"), jobDescription: "Staff engineer" }
    )
    expect(result.rejected).toEqual([])
  })

  it("applies the same scope when the suggestion is accepted later", () => {
    const result = validateForSkill(
      resume,
      [rewrite(otherBullet, "Led the team.")],
      { mode: "reapply", skillId: "bullet_rewrite", selectedNodeId: bullet.id }
    )
    expect(result.rejected[0]?.code).toBe("OUT_OF_SCOPE")
  })

  it("scopes to the whole document when nothing was selected", () => {
    const result = validateForSkill(
      resume,
      [rewrite(otherBullet, "Led the team.")],
      propose()
    )
    expect(result.rejected).toEqual([])
  })
})

describe("validateForSkill limits", () => {
  it("rejects an op the skill does not own", () => {
    const result = validateForSkill(
      resume,
      [
        {
          op: "delete",
          skillId: "bullet_rewrite",
          targetNodeId: bullet.id,
          before: bullet.text,
          reason: "Redundant.",
        },
      ],
      propose()
    )
    expect(result.rejected[0]?.code).toBe("OP_NOT_ALLOWED")
  })

  it("refuses an unknown skill rather than validating against nothing", () => {
    expect(() =>
      validateForSkill(resume, [], propose(undefined, "made_up"))
    ).toThrow()
  })
})

describe("validateForSkill grounding", () => {
  it("rejects a number the model invented at propose time", () => {
    const result = validateForSkill(
      resume,
      [rewrite(bullet, "Cut deploy time by 47%.")],
      propose()
    )
    expect(result.rejected[0]?.code).toBe("UNGROUNDED_NUMBER")
  })

  it("skips grounding at accept time, when the prompt is gone", () => {
    const result = validateForSkill(
      resume,
      [rewrite(bullet, "Cut deploy time by 47%.")],
      { mode: "reapply", skillId: "bullet_rewrite" }
    )
    expect(result.rejected).toEqual([])
  })
})

describe("stampSkillId", () => {
  it("overwrites whatever skill the model claimed", () => {
    const [stamped] = stampSkillId(
      [rewrite(bullet, "Cut deploy time.", "jd_match")],
      "bullet_rewrite"
    )
    expect(stamped).toMatchObject({ skillId: "bullet_rewrite" })
  })

  it("leaves a non-object alone for the shape check to reject", () => {
    expect(stampSkillId([null, "nope"], "bullet_rewrite")).toEqual([
      null,
      "nope",
    ])
  })
})
