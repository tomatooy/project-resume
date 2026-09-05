import { looksMultiColumn } from "./columns"

export type PdfText = {
  text: string
  pageCount: number
  /** The naive reading order is probably wrong. Never a reason to stop. */
  multiColumn: boolean
}

/** Distinguishable failures, so the dialog can say something specific. */
export type ExtractErrorKind =
  | "encrypted"
  | "unreadable"
  | "no-text"
  | "too-many-pages"
  | "too-large"

export class ExtractError extends Error {
  constructor(readonly kind: ExtractErrorKind) {
    super(kind)
    this.name = "ExtractError"
  }
}

export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MAX_PDF_PAGES = 10

/** Below this a PDF is an image of a resume, not a resume. */
const MIN_USEFUL_CHARS = 40

function normalize(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * PDF bytes to plain text, in the browser.
 *
 * Extraction lives here rather than on the server for a blunt reason: the
 * Worker has no storage binding and no queue, so an uploaded file would have
 * nowhere to land. Doing it here also means the document itself never leaves
 * the tab, which is the right default for a resume.
 *
 * Text comes out in content-stream order, unmodified. `looksMultiColumn` says
 * whether to trust it.
 */
export async function extractPdfText(
  file: File,
  onPage: (page: number, pageCount: number) => void,
  signal?: AbortSignal
): Promise<PdfText> {
  // Imported here, not at the top: this module is on the app shell's import
  // path (ResumeRail -> ImportDialog -> use-import), so it is evaluated during
  // server rendering, and pdf.js touches DOMMatrix as it loads. Same reason
  // `useAssistant` defers `check-fit`.
  const { pdfjs } = await import("../resume/preview/pdfjs")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data: bytes })

  try {
    const doc = await task.promise.catch((error: unknown) => {
      const name =
        error instanceof Error ? error.name : String(error ?? "unknown")
      throw new ExtractError(
        name === "PasswordException" ? "encrypted" : "unreadable"
      )
    })

    const pageCount = doc.numPages
    if (pageCount > MAX_PDF_PAGES) {
      throw new ExtractError("too-many-pages")
    }

    const chunks: string[] = []
    const xs: number[] = []

    for (let number = 1; number <= pageCount; number += 1) {
      signal?.throwIfAborted()
      onPage(number, pageCount)

      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      const parts: string[] = []

      for (const item of content.items) {
        if (!("str" in item)) continue
        parts.push(item.str)
        parts.push(item.hasEOL ? "\n" : " ")
        if (item.str.trim()) xs.push(item.transform[4] ?? 0)
      }

      chunks.push(parts.join(""))
      page.cleanup()
    }

    const text = normalize(chunks.join("\n\n"))
    if (text.length < MIN_USEFUL_CHARS) throw new ExtractError("no-text")

    return { text, pageCount, multiColumn: looksMultiColumn(xs) }
  } finally {
    // The worker port leaks without this, the same way check-fit destroys its
    // one-off task.
    await task.destroy()
  }
}
