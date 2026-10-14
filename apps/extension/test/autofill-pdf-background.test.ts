// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import {
  PdfRenderRequestSchema,
  pdfDigest,
  type ResumePdf,
} from "../src/autofill/pdf-contract"
import type { PdfDocument } from "@workspace/resume-core/contracts"

const mocks = vi.hoisted(() => ({ document: vi.fn() }))
vi.mock("../src/lib/api", () => ({
  api: { autofill: { document: mocks.document } },
}))
const send = vi.fn()
const close = vi.fn(async () => {})
const create = vi.fn(async () => {})
let source: PdfDocument
let resumeId = ""
let bundleId = ""
let file: ResumePdf
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  const services = createServices(inMemoryPorts())
  const resume = await services.resumes.create()
  const prepared = await services.autofill.prepare({ resumeId: resume.id })
  resumeId = resume.id
  bundleId = prepared.bundle.id
  source = await services.autofill.document({ resumeId, bundleId })
  const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF")
  file = {
    pdfId: source.pdfId,
    filename: "resume.pdf",
    base64: btoa(new TextDecoder().decode(bytes)),
    byteLength: bytes.length,
    sha256: await pdfDigest(bytes),
  }
  mocks.document.mockResolvedValue(source)
  send.mockImplementation(async (raw) => {
    const parsed = PdfRenderRequestSchema.safeParse(raw)
    return parsed.success
      ? { ok: true, requestId: parsed.data.requestId, file }
      : { ready: true }
  })
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      getContexts: vi.fn(async () => []),
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      sendMessage: send,
    },
    offscreen: {
      createDocument: create,
      closeDocument: close,
      Reason: { BLOBS: "BLOBS" },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())
it("generates a source-bound PDF in a hidden document and closes it after use", async () => {
  const { prepareResumePdf } = await import("../src/autofill/pdf-background")
  expect(
    await prepareResumePdf(resumeId, bundleId, new AbortController().signal)
  ).toEqual(file)
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "chrome-extension://extension/offscreen.html",
      reasons: ["BLOBS"],
    })
  )
  expect(close).toHaveBeenCalledOnce()
})
it("rejects a mismatched reply and closes the renderer", async () => {
  send.mockImplementation(async (raw) =>
    PdfRenderRequestSchema.safeParse(raw).success
      ? { ok: true, requestId: crypto.randomUUID(), file }
      : { ready: true }
  )
  const { prepareResumePdf } = await import("../src/autofill/pdf-background")
  await expect(
    prepareResumePdf(resumeId, bundleId, new AbortController().signal)
  ).rejects.toThrow("PDF unavailable")
  expect(close).toHaveBeenCalledOnce()
})
it("cancels a stalled render and clears the hidden document", async () => {
  send.mockImplementation(async (raw) =>
    PdfRenderRequestSchema.safeParse(raw).success
      ? new Promise(() => {})
      : { ready: true }
  )
  const { prepareResumePdf } = await import("../src/autofill/pdf-background")
  const controller = new AbortController()
  const pending = prepareResumePdf(resumeId, bundleId, controller.signal)
  const rejected = expect(pending).rejects.toThrow("PDF rendering cancelled")
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  controller.abort()
  await rejected
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
})
it("rejects a changed source before rendering", async () => {
  mocks.document.mockResolvedValue({
    ...source,
    bundleId: "0000000000000000",
  })
  const { prepareResumePdf } = await import("../src/autofill/pdf-background")
  await expect(
    prepareResumePdf(resumeId, bundleId, new AbortController().signal)
  ).rejects.toThrow("Source changed")
  expect(create).not.toHaveBeenCalled()
})
it("cancels while waiting for renderer readiness without leaving it open", async () => {
  send.mockImplementation(async () => new Promise(() => {}))
  const { prepareResumePdf } = await import("../src/autofill/pdf-background")
  const controller = new AbortController()
  const pending = prepareResumePdf(resumeId, bundleId, controller.signal)
  const rejected = expect(pending).rejects.toThrow("PDF rendering cancelled")
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  controller.abort()
  await rejected
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
})
