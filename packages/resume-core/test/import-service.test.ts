import type { ParsedResume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { MAX_IMPORT_CHARS } from "../src/services/import-service"
import { harness } from "./harness"

/** Long enough to pass the floor; what it says never reaches the stub. */
const TEXT =
  "Ada Lovelace. Analyst at Babbage & Co, 1842 to 1843. Wrote the first program."

const PARSED: ParsedResume = {
  basics: { name: "Ada Lovelace", email: "ada@example.com" },
  sections: [
    {
      type: "experience",
      title: "Experience",
      items: [
        {
          company: "Babbage & Co",
          role: "Analyst",
          start: "1842",
          end: "1843",
          bullets: ["Wrote the first program."],
        },
      ],
    },
  ],
}

describe("ImportService", () => {
  it("writes the resume, names it after its owner, and snapshots the import", async () => {
    const h = harness()
    h.resumeParser.result = PARSED
    h.resumeParser.model = "fast-test"

    const result = await h.importService.import({ text: TEXT })

    expect(result.model).toBe("fast-test")
    expect(result.resume.title).toBe("Ada Lovelace resume")
    const record = await h.resumeService.get(result.resume.id)
    expect(record.data.basics.name).toBe("Ada Lovelace")
    expect(record.data.sections).toHaveLength(1)

    const versions = await h.versionService.list(result.resume.id)
    expect(versions.map((v) => [v.label, v.createdBy])).toEqual([
      ["Imported", "system"],
    ])
  })

  it("hands the parser trimmed text and the caller's abort signal", async () => {
    const h = harness()
    h.resumeParser.result = PARSED
    const controller = new AbortController()

    await h.importService.import({
      text: `\n  ${TEXT}  \n`,
      signal: controller.signal,
    })

    expect(h.resumeParser.calls).toEqual([
      { text: TEXT, signal: controller.signal },
    ])
  })

  it("refuses text too short or too long to be a resume before parsing", async () => {
    const h = harness()

    await expect(h.importService.import({ text: "Ada" })).rejects.toMatchObject(
      { code: "VALIDATION" }
    )
    await expect(
      h.importService.import({ text: "x".repeat(MAX_IMPORT_CHARS + 1) })
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(h.resumeParser.calls).toHaveLength(0)
  })

  it("writes nothing when the parser finds no sections", async () => {
    const h = harness()
    h.resumeParser.result = { basics: { name: "Ada" }, sections: [] }

    await expect(h.importService.import({ text: TEXT })).rejects.toMatchObject({
      code: "VALIDATION",
    })
    expect(await h.resumeService.list()).toHaveLength(0)
  })

  it("lets a parser failure through untouched and writes nothing", async () => {
    const h = harness()
    h.resumeParser.failWith = new Error("provider down")

    await expect(h.importService.import({ text: TEXT })).rejects.toThrow(
      "provider down"
    )
    expect(await h.resumeService.list()).toHaveLength(0)
  })
})
