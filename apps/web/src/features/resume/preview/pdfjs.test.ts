import { expect, it } from "vitest"

// pdf.js touches canvas globals jsdom does not implement while its display
// layer evaluates. Nothing here renders, so empty stubs are enough to get the
// module graph loaded.
class StubMatrix {}
Object.assign(globalThis, {
  DOMMatrix: StubMatrix,
  Path2D: class {},
  ImageData: class {},
})

/**
 * react-pdf's entry module assigns `GlobalWorkerOptions.workerSrc` the bare
 * specifier "pdf.worker.mjs" when it evaluates, clobbering whatever the app
 * configured. When `./pdfjs` evaluates first (an import or a fit check before
 * the viewer opens), react-pdf evaluates second and wins, and the viewer falls
 * through to the fake worker with "Failed to resolve module specifier".
 */
it("keeps the app's worker url when react-pdf evaluates afterwards", async () => {
  const { pdfjs } = await import("./pdfjs")
  const configured = pdfjs.GlobalWorkerOptions.workerSrc
  expect(configured).toMatch(/pdf\.worker/)

  await import("./PdfViewer")

  expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(configured)
})
