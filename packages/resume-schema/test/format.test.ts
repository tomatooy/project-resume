import { describe, expect, it } from "vitest"

import { resumeFileName } from "../src/format"

describe("resumeFileName", () => {
  it("names the PDF after the person, safe for a file system", () => {
    expect(resumeFileName("Mira Halvorsen")).toBe("mira-halvorsen-resume.pdf")
    expect(resumeFileName("Zoë Ångström")).toBe("zoe-angstrom-resume.pdf")
  })

  it("falls back when the name has nothing to keep", () => {
    expect(resumeFileName("")).toBe("resume-resume.pdf")
  })
})
