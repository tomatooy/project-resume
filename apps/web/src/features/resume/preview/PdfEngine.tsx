import { applyPatches } from "@workspace/resume-schema"
import { ResumeDocument, usePDF } from "@workspace/resume-render"
import { useEffect, useMemo } from "react"

import { useDebouncedValue } from "@/lib/use-debounced-value"
import { useResumeState } from "../session-context"
import type { PreviewStore } from "./preview-store"

/**
 * Turns the live document into a PDF blob and publishes it to the preview
 * store. Renders nothing.
 *
 * Renders are debounced so typing does not queue a layout pass per keystroke,
 * and the previous blob is left in place while a new one is in flight so the
 * viewer never flashes empty.
 */
export default function PdfEngine({ store }: { store: PreviewStore }) {
  const doc = useResumeState((s) => s.doc)
  const templateId = useResumeState((s) => s.templateId)
  const options = useResumeState((s) => s.templateOptions)
  const patches = useResumeState((s) => s.previewPatches)

  // Hovering a suggestion previews its effect without touching the document.
  const shown = useMemo(
    () => (patches.length > 0 ? applyPatches(doc, patches).resume : doc),
    [doc, patches]
  )

  // Memoised because `useDebouncedValue` compares by identity: a fresh object
  // literal here restarts the timer on every render, and every settle commits a
  // new identity that triggers the next render, so the debounce sustains its
  // own 300ms loop and re-renders the PDF forever with nothing changed.
  const pending = useMemo(
    () => ({ shown, templateId, options }),
    [shown, templateId, options]
  )
  const input = useDebouncedValue(pending, 300)
  const element = useMemo(
    () => (
      <ResumeDocument
        resume={input.shown}
        templateId={input.templateId}
        options={input.options}
      />
    ),
    [input]
  )

  const [instance, update] = usePDF({ document: element })

  useEffect(() => {
    update(element)
  }, [element, update])

  useEffect(() => {
    store.setState((s) => ({
      ...s,
      loading: instance.loading,
      error: instance.error,
      // Only overwrite on success; a failed render keeps the last good blob.
      blob: instance.blob ?? s.blob,
    }))
  }, [instance.loading, instance.error, instance.blob, store])

  return null
}
