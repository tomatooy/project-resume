import { applyStrict } from "@workspace/resume-schema"
import type { Resume, ResumePatch } from "@workspace/resume-schema"
import { pdf, ResumeDocument } from "@workspace/resume-render"
import type { TemplateId, TemplateOptions } from "@workspace/resume-render"

import { pdfjs } from "./pdfjs"

export type CheckFitInput = {
  resume: Resume
  templateId: TemplateId
  options: TemplateOptions
  /** Applied to a copy before measuring. Empty measures the document as it is. */
  patches?: ResumePatch[]
}

export type CheckFitResult =
  | { ok: true; pageCount: number; pageSize: TemplateOptions["pageSize"] }
  | { ok: false; message: string }

/**
 * Answers "how many pages would this be?" without disturbing the live preview.
 *
 * The visible preview goes through `usePDF`, which owns a single render
 * pipeline; pushing a hypothetical document through it would make the pane
 * flicker to a version the user never asked for. So this renders its own
 * one-off blob with `pdf().toBlob()` and reads the page count back with
 * pdf.js, leaving the pane alone.
 *
 * Never throws. A failed render returns `ok: false` so the caller can carry on
 * without the number, which is what the assistant needs: a missing page count
 * is a smaller problem than a dead run.
 */
export async function checkFit({
  resume,
  templateId,
  options,
  patches = [],
}: CheckFitInput): Promise<CheckFitResult> {
  try {
    let measured = resume
    if (patches.length > 0) {
      const applied = applyStrict(resume, patches)
      // Refusing to answer beats answering about the wrong document. The model
      // asked how many pages *these patches* produce; measuring the unpatched
      // resume and reporting success would feed it a number for a document
      // nobody proposed.
      if (!applied.ok) {
        return {
          ok: false,
          message: applied.failed[0]?.message ?? "Patches could not be applied",
        }
      }
      measured = applied.resume
    }

    const blob = await pdf(
      <ResumeDocument
        resume={measured}
        templateId={templateId}
        options={options}
      />
    ).toBlob()

    const data = new Uint8Array(await blob.arrayBuffer())
    const task = pdfjs.getDocument({ data })
    try {
      const doc = await task.promise
      return { ok: true, pageCount: doc.numPages, pageSize: options.pageSize }
    } finally {
      // The loading task owns the worker port. Without this the port leaks on
      // every call, and the assistant calls this once per run.
      await task.destroy()
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not render the preview",
    }
  }
}
