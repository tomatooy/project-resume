import { useCallback, useRef, useState } from "react"

import { importResume } from "@/lib/api"
import { ApiError, type ResumeSummary } from "@/lib/types"
import {
  ExtractError,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  extractPdfText,
} from "./pdf-text"

export type ImportStage = "reading" | "extracting" | "parsing"

export type ImportProgress = {
  stage: ImportStage
  page: number
  pageCount: number
}

export type ImportSource =
  | { kind: "file"; file: File }
  | { kind: "text"; text: string }

export type ImportFailure = {
  message: string
  /** Extraction failed, so the paste box is the way out. */
  suggestPaste: boolean
}

/** Long enough that a stage that finishes instantly still reads as a step. */
const STAGE_FLOOR_MS = 400

const MAX_CHARS = 20_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const EXTRACT_MESSAGE: Record<string, string> = {
  encrypted:
    "That PDF is password protected, so its text cannot be read. Paste the text instead.",
  "no-text":
    "That PDF has no text in it, which usually means it is a scan or an image. Paste the text instead.",
  "too-many-pages": `That file is longer than ${MAX_PDF_PAGES} pages. Import the resume on its own, or paste the text instead.`,
  "too-large": "That file is larger than 10MB. Paste the text instead.",
  unreadable: "That file could not be opened as a PDF. Paste the text instead.",
}

function failureFor(error: unknown): ImportFailure {
  if (error instanceof ExtractError) {
    return {
      message: EXTRACT_MESSAGE[error.kind] ?? EXTRACT_MESSAGE.unreadable ?? "",
      suggestPaste: true,
    }
  }
  if (error instanceof ApiError) {
    return {
      message:
        error.code === "INTERNAL"
          ? "Something went wrong reading that resume. Try again."
          : error.message,
      suggestPaste: false,
    }
  }
  return { message: "Something went wrong. Try again.", suggestPaste: false }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

/**
 * Runs one import, start to finish, inside the dialog.
 *
 * There is no queue and no durable storage behind this, so the work lives
 * exactly as long as the request does. Cancelling therefore abandons it rather
 * than backgrounding it, and the dialog stays open until it is done.
 */
export function useImport(onDone: (resume: ResumeSummary) => void) {
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [failure, setFailure] = useState<ImportFailure | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setProgress(null)
  }, [])

  const reset = useCallback(() => {
    setFailure(null)
    setWarning(null)
  }, [])

  const run = useCallback(
    async (source: ImportSource) => {
      const controller = new AbortController()
      abort.current = controller
      setFailure(null)
      setWarning(null)

      try {
        let text: string

        if (source.kind === "file") {
          const startedAt = Date.now()
          setProgress({ stage: "reading", page: 0, pageCount: 0 })

          if (source.file.size > MAX_PDF_BYTES) {
            throw new ExtractError("too-large")
          }
          await sleep(Math.max(0, STAGE_FLOOR_MS - (Date.now() - startedAt)))

          const extracted = await extractPdfText(
            source.file,
            (page, pageCount) => {
              setProgress({ stage: "extracting", page, pageCount })
            },
            controller.signal
          )
          if (extracted.multiColumn) {
            setWarning(
              "This looks like a two-column layout. The text may come through jumbled; if it does, paste it instead."
            )
          }
          text = extracted.text
        } else {
          text = source.text.trim()
        }

        if (text.length > MAX_CHARS) {
          setProgress(null)
          setFailure({
            message: `That is ${text.length.toLocaleString()} characters, over the ${MAX_CHARS.toLocaleString()} limit. Trim it and try again.`,
            suggestPaste: false,
          })
          return
        }

        setProgress({ stage: "parsing", page: 0, pageCount: 0 })
        const resume = await importResume({ text }, controller.signal)
        if (controller.signal.aborted) return

        setProgress(null)
        onDone(resume)
      } catch (error) {
        setProgress(null)
        if (isAbort(error)) return
        setFailure(failureFor(error))
      } finally {
        abort.current = null
      }
    },
    [onDone]
  )

  return {
    progress,
    failure,
    warning,
    busy: progress !== null,
    run,
    cancel,
    reset,
  }
}
