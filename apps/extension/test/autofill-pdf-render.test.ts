// @vitest-environment node
import { expect, it } from "vitest"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import { renderResumePdf } from "../src/autofill/render-pdf"
import { pdfBytes } from "../src/autofill/pdf-contract"

it("renders the selected resume template into a bounded valid PDF with its source stamp", async () => {
  const services = createServices(inMemoryPorts())
  const resume = await services.resumes.create()
  const { sourceStamp } = await services.autofill.prepare({
    resumeId: resume.id,
  })
  const source = await services.autofill.document({ sourceStamp })
  const file = await renderResumePdf(source)
  expect(file.filename).toMatch(/\.pdf$/)
  expect(file.sourceStamp).toEqual(sourceStamp)
  const bytes = await pdfBytes(file)
  expect(bytes.length).toBeGreaterThan(1000)
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-")
}, 20000)
