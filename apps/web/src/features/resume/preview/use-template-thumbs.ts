import {
  TEMPLATE_IDS,
  type Resume,
  type TemplateId,
  type TemplateOptions,
} from "@workspace/resume-schema"
import { useEffect, useState } from "react"

export type ThumbMap = Partial<Record<TemplateId, string>>

/**
 * Keyed on the document object, not a content hash. The store replaces the
 * document on every patch, so identity already changes exactly when the render
 * would; hashing would add an async step to buy nothing but dedupe across an
 * undo back to identical content. Weak so old documents are collectable.
 */
const cache = new WeakMap<Resume, Map<string, string>>()

/** Both options change layout, so both have to be part of the key. */
export function thumbKey(
  templateId: TemplateId,
  options: TemplateOptions
): string {
  return `${templateId}:${options.pageSize}:${options.fontScale}`
}

/**
 * The selected template first, so the card the user is looking at is the one
 * that resolves first.
 *
 * The preview already holds a rendered blob for this template, but it is not
 * reused: it trails the document by the render debounce, and carries a hovered
 * suggestion's patches when there is one, so it is not reliably a picture of
 * the document being thumbnailed. Correlating the two costs more than the one
 * render it would save out of six.
 */
export function thumbOrder(selected: TemplateId): TemplateId[] {
  return [selected, ...TEMPLATE_IDS.filter((id) => id !== selected)]
}

export function readThumbs(resume: Resume, options: TemplateOptions): ThumbMap {
  const stored = cache.get(resume)
  if (!stored) return {}
  const thumbs: ThumbMap = {}
  for (const id of TEMPLATE_IDS) {
    const src = stored.get(thumbKey(id, options))
    if (src) thumbs[id] = src
  }
  return thumbs
}

export function writeThumb(
  resume: Resume,
  options: TemplateOptions,
  templateId: TemplateId,
  src: string
): void {
  const stored = cache.get(resume) ?? new Map<string, string>()
  stored.set(thumbKey(templateId, options), src)
  cache.set(resume, stored)
}

export type TemplateThumbsInput = {
  resume: Resume
  options: TemplateOptions
  selected: TemplateId
}

/**
 * Renders every template to a thumbnail while the picker is open.
 *
 * Inputs are frozen at mount, and the picker is unmounted while closed, so
 * mount is open: editing with the picker open leaves the thumbnails as they
 * were rather than re-rendering six documents per keystroke. Reopening picks
 * up the edits.
 *
 * The queue is sequential on purpose. Six renders at once would hold the main
 * thread for the length of all of them; one at a time leaves a gap between
 * each, and the caller draws its schematic until a card's render lands, so
 * nothing in the picker ever waits on this.
 */
export function useTemplateThumbs(input: TemplateThumbsInput): ThumbMap {
  const [frozen] = useState(input)
  const [thumbs, setThumbs] = useState<ThumbMap>(() =>
    readThumbs(frozen.resume, frozen.options)
  )

  useEffect(() => {
    let cancelled = false

    void (async () => {
      // Dynamic so the renderer and pdf.js stay out of the chunk the pane
      // loads with, the same reason `check-fit` is imported on demand.
      const { renderTemplateThumb } = await import("./template-thumbs")

      for (const id of thumbOrder(frozen.selected)) {
        if (cancelled) return
        if (readThumbs(frozen.resume, frozen.options)[id]) continue

        const src = await renderTemplateThumb(frozen.resume, id, frozen.options)
        if (!src) continue

        // Stored even when the picker has closed: the work is already paid
        // for, and the next open reads it back instead of repeating it.
        writeThumb(frozen.resume, frozen.options, id, src)
        if (cancelled) return
        setThumbs((current) => ({ ...current, [id]: src }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [frozen])

  return thumbs
}
