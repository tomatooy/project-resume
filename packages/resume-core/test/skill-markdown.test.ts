import { describe, expect, it } from "vitest"

import { UserSkillInputSchema, parseSkillMarkdown } from "../src/domain/skill"

const FILE = `---
name: Terse sentences
description: Make sentences shorter.
model: some-other-tool
---

Prefer one clause per sentence.
`

describe("parseSkillMarkdown", () => {
  it("imports standard fields without requiring when to use", () => {
    const draft = parseSkillMarkdown(FILE)
    expect(draft).toMatchObject({
      category: "editor",
      name: "Terse sentences",
      description: "Make sentences shorter.",
      body: "Prefer one clause per sentence.",
    })
    expect(draft.whenToUse).toBeUndefined()
    expect(draft).not.toHaveProperty("model")
    expect(UserSkillInputSchema.safeParse(draft).success).toBe(true)
  })

  it.each(["|", ">"])(
    "reads a multiline YAML description using %s",
    (style) => {
      const draft = parseSkillMarkdown(
        `---\nname: "Terse: sentences"\ndescription: ${style}\n  First sentence.\n  Second sentence.\n---\n\nBody.`
      )
      expect(draft.name).toBe("Terse: sentences")
      expect(draft.description).toBe(
        style === "|"
          ? "First sentence.\nSecond sentence."
          : "First sentence. Second sentence."
      )
    }
  )

  it("reads optional metadata separately from the description", () => {
    const draft = parseSkillMarkdown(
      FILE.replace(
        "model:",
        `category: interview
whenToUse: Before an interview.
notFor: Adding detail.
starter: Shorten this.
model:`
      )
    )
    expect(draft).toMatchObject({
      category: "interview",
      description: "Make sentences shorter.",
      whenToUse: "Before an interview.",
      notFor: "Adding detail.",
      starter: "Shorten this.",
    })
  })

  it("tolerates a BOM and CRLF line endings", () => {
    expect(
      parseSkillMarkdown(`\uFEFF${FILE.replace(/\n/g, "\r\n")}`).name
    ).toBe("Terse sentences")
  })

  it("imports oversized content intact and rejects it only when saving", () => {
    const body = "x".repeat(60_000)
    const draft = parseSkillMarkdown(
      FILE.replace("Prefer one clause per sentence.", body)
    )
    expect(draft.body).toBe(body)
    expect(UserSkillInputSchema.safeParse(draft).success).toBe(false)
  })

  it("leaves missing fields for the user to fill in", () => {
    const draft = parseSkillMarkdown("---\nname: Terse\n---\n\nBody.")
    expect(draft.description).toBe("")
    expect(draft.body).toBe("Body.")
    expect(UserSkillInputSchema.safeParse(draft).success).toBe(false)
  })

  it("keeps an unrecognized category in the draft for correction", () => {
    const draft = parseSkillMarkdown(
      FILE.replace("model:", "category: other\nmodel:")
    )
    expect(draft.category).toBe("other")
    expect(UserSkillInputSchema.safeParse(draft).success).toBe(false)
  })

  it.each([
    "Just prose.",
    "---\nname: Terse\n\nProse.",
    "---\nname: [broken\n---\nBody.",
  ])("preserves text it cannot parse as frontmatter in the body", (text) => {
    expect(parseSkillMarkdown(text)).toMatchObject({
      name: "",
      description: "",
      body: text,
    })
  })
})

describe("UserSkillInputSchema", () => {
  const input = {
    category: "editor",
    name: "Terse",
    description: "Shorten prose.",
    body: "Short sentences.",
  }

  it("normalizes blank optional fields away", () => {
    expect(
      UserSkillInputSchema.parse({ ...input, whenToUse: "  " }).whenToUse
    ).toBeUndefined()
  })

  it.each(["name", "description", "body"])(
    "requires nonblank %s at save time",
    (field) => {
      expect(
        UserSkillInputSchema.safeParse({ ...input, [field]: "  " }).success
      ).toBe(false)
    }
  )

  it("accepts 50,000 body characters and rejects 50,001 when saving", () => {
    expect(
      UserSkillInputSchema.safeParse({
        ...input,
        body: "x".repeat(50_000),
      }).success
    ).toBe(true)
    expect(
      UserSkillInputSchema.safeParse({
        ...input,
        body: "x".repeat(50_001),
      }).success
    ).toBe(false)
  })
})
