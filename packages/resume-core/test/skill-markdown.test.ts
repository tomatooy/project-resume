import { describe, expect, it } from "vitest"

import { AppError } from "../src/domain/errors"
import {
  MAX_SKILL_BODY_CHARS,
  MAX_SKILL_MARKDOWN_CHARS,
  parseSkillMarkdown,
} from "../src/domain/skill"

const FILE = `---
name: Terse sentences
description: The prose is wordy and the user wants it shorter.
model: some-other-tool
---

Prefer one clause per sentence.
`

/** The code an `AppError` carried out of a call, or undefined if none. */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return error instanceof AppError ? error.code : undefined
  }
}

describe("parseSkillMarkdown", () => {
  it("reads the name, the description and the body", () => {
    expect(parseSkillMarkdown(FILE)).toEqual({
      category: "editor",
      name: "Terse sentences",
      whenToUse: "The prose is wordy and the user wants it shorter.",
      body: "Prefer one clause per sentence.",
    })
  })

  it("reads a category line, and leaves one out", () => {
    const interview = FILE.replace(
      "description:",
      "category: interview\ndescription:"
    )
    expect(parseSkillMarkdown(interview).category).toBe("interview")
    // The key is optional: a file another tool wrote has no opinion here.
    expect(parseSkillMarkdown(FILE).category).toBe("editor")
  })

  it("names a category line it cannot place", () => {
    const odd = FILE.replace(
      "description:",
      "category: interviewing\ndescription:"
    )
    expect(codeOf(() => parseSkillMarkdown(odd))).toBe("VALIDATION")
  })

  it("maps description to whenToUse and ignores keys it does not know", () => {
    const parsed = parseSkillMarkdown(FILE)
    expect(parsed.whenToUse).toBe(
      "The prose is wordy and the user wants it shorter."
    )
    expect(parsed).not.toHaveProperty("model")
  })

  it("tolerates CRLF line endings", () => {
    expect(parseSkillMarkdown(FILE.replace(/\n/g, "\r\n")).name).toBe(
      "Terse sentences"
    )
  })

  it("rejects a file with no frontmatter fence", () => {
    expect(codeOf(() => parseSkillMarkdown("Just prose."))).toBe("VALIDATION")
  })

  it("rejects a block that is never closed", () => {
    expect(codeOf(() => parseSkillMarkdown("---\nname: Terse\n\nProse."))).toBe(
      "VALIDATION"
    )
  })

  it("rejects a file with no description", () => {
    expect(
      codeOf(() => parseSkillMarkdown("---\nname: Terse\n---\n\nProse."))
    ).toBe("VALIDATION")
  })

  it("rejects a body past the field cap", () => {
    const file = `---\nname: Terse\ndescription: Wordy prose.\n---\n\n${"x".repeat(MAX_SKILL_BODY_CHARS + 1)}`
    expect(codeOf(() => parseSkillMarkdown(file))).toBe("VALIDATION")
  })

  it("rejects a file past the raw cap before reading it", () => {
    expect(
      codeOf(() => parseSkillMarkdown("x".repeat(MAX_SKILL_MARKDOWN_CHARS + 1)))
    ).toBe("VALIDATION")
  })
})
