import { defaultTemplateOptions, type Resume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import {
  readThumbs,
  thumbKey,
  thumbOrder,
  writeThumb,
} from "./use-template-thumbs"

const doc = (name: string): Resume => ({
  schemaVersion: 1,
  basics: { id: "basics", name, links: [] },
  sections: [],
})

describe("thumbKey", () => {
  it("separates the options that change the render", () => {
    const a4 = { ...defaultTemplateOptions, pageSize: "A4" as const }
    const large = { ...defaultTemplateOptions, fontScale: 1.1 as const }

    expect(thumbKey("lisbon", defaultTemplateOptions)).not.toBe(
      thumbKey("atlas", defaultTemplateOptions)
    )
    expect(thumbKey("lisbon", defaultTemplateOptions)).not.toBe(
      thumbKey("lisbon", a4)
    )
    expect(thumbKey("lisbon", defaultTemplateOptions)).not.toBe(
      thumbKey("lisbon", large)
    )
  })
})

describe("thumbOrder", () => {
  it("renders the selected template first and every other one once", () => {
    const order = thumbOrder("ledger")

    expect(order[0]).toBe("ledger")
    expect(new Set(order).size).toBe(order.length)
    expect(order).toContain("lisbon")
    expect(order).toContain("atlas")
  })
})

describe("the thumbnail cache", () => {
  it("returns nothing for a document it has not seen", () => {
    expect(readThumbs(doc("Unseen"), defaultTemplateOptions)).toEqual({})
  })

  it("reads back what it stored, so reopening the menu costs no renders", () => {
    const resume = doc("Jo")
    writeThumb(
      resume,
      defaultTemplateOptions,
      "lisbon",
      "data:image/png;base64,AAA"
    )

    expect(readThumbs(resume, defaultTemplateOptions)).toEqual({
      lisbon: "data:image/png;base64,AAA",
    })
  })

  it("keys on the options, so a page size change re-renders", () => {
    const resume = doc("Jo")
    writeThumb(
      resume,
      defaultTemplateOptions,
      "lisbon",
      "data:image/png;base64,AAA"
    )

    const a4 = { ...defaultTemplateOptions, pageSize: "A4" as const }
    expect(readThumbs(resume, a4)).toEqual({})
  })

  it("keys on the document, so an edit re-renders", () => {
    writeThumb(
      doc("Jo"),
      defaultTemplateOptions,
      "lisbon",
      "data:image/png;base64,AAA"
    )

    expect(readThumbs(doc("Jo"), defaultTemplateOptions)).toEqual({})
  })
})
