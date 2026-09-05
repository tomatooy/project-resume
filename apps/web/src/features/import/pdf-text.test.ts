import { expect, it } from "vitest"

/**
 * The app shell imports this module on every route through ResumeRail ->
 * ImportDialog -> use-import, so it is evaluated during server rendering,
 * where pdf.js has no DOMMatrix to touch. Loading pdf.js has to wait for an
 * actual extraction.
 */
it("loads without pdf.js globals", async () => {
  const globals = globalThis as { DOMMatrix?: unknown }
  expect(globals.DOMMatrix).toBeUndefined()
  await expect(import("./pdf-text")).resolves.toHaveProperty("extractPdfText")
})
