import { describe, expect, it } from "vitest"

import { resumeFileName } from "../src/format"

describe("resumeFileName", () => {
  it("preserves the resume title with spaces removed", () => {
    expect(resumeFileName("Mira Halvorsen")).toBe("MiraHalvorsen.pdf")
    expect(resumeFileName("Zoë Ångström")).toBe("ZoëÅngström.pdf")
  })

  it("falls back when the name has nothing to keep", () => {
    expect(resumeFileName("")).toBe("resume.pdf")
  })
})
