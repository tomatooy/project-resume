// @vitest-environment node
import { expect, it } from "vitest"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import { renderResumePdf } from "../src/autofill/render-pdf"
import { pdfBytes } from "../src/autofill/pdf-contract"

it("renders the pinned bundle into a bounded valid PDF carrying its identity", async () => {
  const services = createServices(inMemoryPorts())
  const resume = await services.resumes.create()
  const prepared = await services.autofill.prepare({ resumeId: resume.id })
  const source = await services.autofill.document({
    resumeId: resume.id,
    bundleId: prepared.bundle.id,
  })
  const file = await renderResumePdf(source)
  expect(file.filename).toMatch(/\.pdf$/)
  expect(file.pdfId).toBe(source.pdfId)
  const bytes = await pdfBytes(file)
  expect(bytes.length).toBeGreaterThan(1000)
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-")
}, 20000)
