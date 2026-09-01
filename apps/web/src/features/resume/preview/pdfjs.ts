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

// react-pdf resolves to this same hoisted copy of pdfjs-dist, so setting the
// worker here configures the viewer too. Both the viewer and `check-fit` import
// this module rather than touching `GlobalWorkerOptions` themselves, so
// whichever loads first wins and they cannot disagree.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export { pdfjs }
