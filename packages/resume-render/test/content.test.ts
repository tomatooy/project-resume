import {
  renderToBuffer as renderPdf,
  type DocumentProps,
} from "@react-pdf/renderer"
import { createElement, type ReactElement } from "react"
import { describe, expect, it } from "vitest"

import { hasBullets, type Resume } from "@workspace/resume-schema"
import { onePage, twoPage, unicode } from "@workspace/resume-schema/fixtures"
import { ResumeDocument } from "../src/index"
import { TEMPLATE_IDS, type TemplateId } from "../src/types"

/** Reads the PDF back with pdf.js, the same engine the console's viewer uses. */
async function extractText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
  })
  const doc = await task.promise
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    pages.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "))
  }
  await task.destroy()
  // Collapse the whitespace pdf.js inserts between separately positioned runs.
  return pages.join("\n").replace(/\s+/g, " ")
}

/**
 * `ResumeDocument` returns a react-pdf `<Document>`, but its own prop type does
 * not overlap `DocumentProps`, so the element needs a cast at this boundary.
 */
async function textOf(resume: Resume, templateId: TemplateId): Promise<string> {
  const buffer = await renderPdf(
    createElement(ResumeDocument, {
      resume,
      templateId,
    }) as ReactElement<DocumentProps>
  )
  return extractText(buffer)
}

function allBullets(resume: Resume): string[] {
  return resume.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      hasBullets(item) ? item.bullets.map((b) => b.text) : []
    )
  )
}

const squash = (text: string) => text.replace(/\s+/g, " ")

describe("no content is dropped", () => {
  for (const id of TEMPLATE_IDS) {
    it(`${id} renders the name, every bullet, and every skill`, async () => {
      const text = await textOf(onePage, id)

      expect(text).toContain(onePage.basics.name)
      expect(text).toContain(onePage.basics.headline)

      for (const bullet of allBullets(onePage)) {
        expect(
          text,
          `missing bullet: ${squash(bullet).slice(0, 40)}`
        ).toContain(squash(bullet))
      }

      for (const section of onePage.sections) {
        for (const item of section.items) {
          if (item.kind !== "skills") continue
          for (const skill of item.skills) {
            expect(text, `missing skill: ${skill}`).toContain(skill)
          }
        }
      }
    })
  }

  it("carries content onto the second page rather than truncating", async () => {
    const text = await textOf(twoPage, "lisbon")
    for (const bullet of allBullets(twoPage)) {
      expect(text).toContain(squash(bullet))
    }
  })

  it("renders CJK through the fallback family", async () => {
    const text = await textOf(unicode, "lisbon")
    expect(text).toContain("陈雨欣")
    expect(text).toContain("重构了组件库的主题系统")
  })

  it("renders Latin diacritics, Greek and Cyrillic from the primary family", async () => {
    const text = await textOf(unicode, "lisbon")
    expect(text).toContain("Résumé naïve façade")
    expect(text).toContain("Ελληνικά")
    expect(text).toContain("Русский")
  })

  it("skips a section that has no items", async () => {
    const withEmpty: Resume = {
      ...onePage,
      sections: [
        ...onePage.sections,
        {
          id: "sec_emptyone0",
          type: "custom",
          title: "Ghost Section",
          items: [],
        },
      ],
    }
    expect(await textOf(withEmpty, "lisbon")).not.toContain("Ghost Section")
  })
})
