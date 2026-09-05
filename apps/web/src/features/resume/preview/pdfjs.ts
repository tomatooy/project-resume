import * as pdfjs from "pdfjs-dist"

// `?url` is what makes Vite emit the worker as an asset and hand back its real
// path. `new URL("pdfjs-dist/...", import.meta.url)` is what react-pdf's own
// README recommends, but it does not work here: Vite only rewrites relative
// specifiers inside `new URL`, so a bare package path resolves against the
// page origin and 404s, leaving the viewer spinning forever with no error.
//
// The `?url` form has its own trap, handled in vite.config.ts: pdfjs-dist has
// to be excluded from optimizeDeps or the dependency scanner tries to
// pre-bundle the worker and warns in a self-amplifying loop.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

/**
 * Points pdf.js at the bundled worker.
 *
 * A function rather than a bare assignment because react-pdf's entry module
 * sets `workerSrc` to the bare specifier "pdf.worker.mjs" as it evaluates, and
 * this module is usually already evaluated by then: the app shell reaches it
 * through ResumeRail -> ImportDialog -> pdf-text on every route. A module body
 * only runs once, so it cannot win that race; a call can. `PdfViewer` calls
 * this after importing react-pdf. Without it the viewer falls through to the
 * fake worker and dies on "Failed to resolve module specifier".
 *
 * Idempotent. react-pdf resolves to this same copy of pdfjs-dist, so setting
 * the worker here configures the viewer too.
 */
export function setPdfWorker(): void {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
}

setPdfWorker()

export { pdfjs }
