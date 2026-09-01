import {
  renderToBuffer as render,
  type DocumentProps,
} from "@react-pdf/renderer"
import { createElement, type ReactElement } from "react"
import { describe, expect, it } from "vitest"

import type { Resume } from "@workspace/resume-schema"
import {
  longBullets,
  minimal,
  onePage,
  starter,
  twoPage,
  unicode,
  pageExpectations,
} from "@workspace/resume-schema/fixtures"
import { ResumeDocument } from "../src/index"
import { TEMPLATE_IDS, type TemplateId } from "../src/types"

/**
 * `ResumeDocument` returns a react-pdf `<Document>`, but its own prop type does
 * not overlap `DocumentProps`, so the element needs a cast at the boundary.
 */
function renderToBuffer(resume: Resume, templateId: TemplateId) {
  return render(
    createElement(ResumeDocument, {
      resume,
      templateId,
    }) as ReactElement<DocumentProps>
  )
}

const FIXTURES = { minimal, starter, onePage, twoPage, longBullets, unicode }

/** Counts page objects in the raw PDF. `/Type /Pages` is the tree root. */
function pageCount(buffer: Buffer): number {
  const text = buffer.toString("latin1")
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

describe("templates render", () => {
  const counts: Record<string, Record<string, number>> = {}

  for (const id of TEMPLATE_IDS) {
    for (const [name, resume] of Object.entries(FIXTURES)) {
      it(`${id} / ${name}`, async () => {
        const buffer = await renderToBuffer(resume, id)
        expect(buffer.length).toBeGreaterThan(1000)
        expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
        expect(pageCount(buffer)).toBe(
          pageExpectations[id][name as keyof typeof FIXTURES]
        )
        counts[id] ??= {}
        counts[id][name] = pageCount(buffer)
      })
    }
  }

  it("reports the page count matrix", () => {
    console.log(JSON.stringify(counts, null, 2))
    expect(Object.keys(counts)).toHaveLength(TEMPLATE_IDS.length)
  })
})
