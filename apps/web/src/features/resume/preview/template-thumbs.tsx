import { pdf, ResumeDocument } from "@workspace/resume-render"
import type {
  Resume,
  TemplateId,
  TemplateOptions,
} from "@workspace/resume-schema"

import { pdfjs } from "./pdfjs"

/**
 * Device pixels across. The cards are about 84 CSS px wide, so this covers a
 * 2x screen without paying to rasterize a full page.
 */
const THUMB_WIDTH = 176

/**
 * Draws page one of a rendered resume as a PNG data url.
 *
 * Never throws. A thumbnail that fails leaves its card on the schematic, which
 * is a far smaller problem than a picker that cannot open.
 */
async function rasterizeFirstPage(blob: Blob): Promise<string | null> {
  try {
    const data = new Uint8Array(await blob.arrayBuffer())
    const task = pdfjs.getDocument({ data })
    try {
      const doc = await task.promise
      const page = await doc.getPage(1)
      const unscaled = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: THUMB_WIDTH / unscaled.width })

      const canvas = document.createElement("canvas")
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise

      return canvas.toDataURL("image/png")
    } finally {
      // The loading task owns the worker port, and the picker opens this once
      // per template. `check-fit` destroys its own for the same reason.
      await task.destroy()
    }
  } catch {
    return null
  }
}

/**
 * Renders one template off the live preview's pipeline, the way `check-fit`
 * measures a hypothetical document: `usePDF` owns a single pipeline, and
 * pushing five other templates through it would make the pane flicker through
 * every one of them.
 */
export async function renderTemplateThumb(
  resume: Resume,
  templateId: TemplateId,
  options: TemplateOptions
): Promise<string | null> {
  try {
    const blob = await pdf(
      <ResumeDocument
        resume={resume}
        templateId={templateId}
        options={options}
      />
    ).toBlob()
    return await rasterizeFirstPage(blob)
  } catch {
    return null
  }
}
