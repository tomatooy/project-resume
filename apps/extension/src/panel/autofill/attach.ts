import type { StartResult } from "@workspace/resume-core/contracts"
import { useEffect, useRef } from "react"
import type { AutofillAction, AutofillView } from "../../lib/autofill-view"

/** Bytes per `fromCharCode` call, well under the argument limit. */
const CHUNK = 0x8000

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

/**
 * Renders the resume snapshot as the app's download does (spec 10). The
 * renderer loads on first use, as its own chunk, so the panel stays light.
 */
export async function renderResumeBase64(
  document: StartResult["document"]
): Promise<string> {
  const { renderPreview } = await import("@workspace/resume-preview/render")
  const blob = await renderPreview({
    doc: document.data,
    templateId: document.templateId,
    options: document.templateOptions,
    patches: [],
  })
  return toBase64(new Uint8Array(await blob.arrayBuffer()))
}

/**
 * Renders each pending resume once and hands the PDF to the service worker,
 * which attaches it; a failed render reports `attach-failed`. A settled
 * attach clears the version, so a retry of the same one renders again.
 */
export function useResumeAttach(
  attach: AutofillView["attach"],
  onAction: (action: AutofillAction) => void
): void {
  const act = useRef(onAction)
  const rendering = useRef<string | null>(null)
  useEffect(() => {
    act.current = onAction
  }, [onAction])
  useEffect(() => {
    if (!attach) {
      rendering.current = null
      return
    }
    if (rendering.current === attach.versionId) return
    const { versionId, document } = attach
    rendering.current = versionId
    renderResumeBase64(document).then(
      (base64) => act.current({ kind: "attach", versionId, base64 }),
      () => act.current({ kind: "attach-failed", versionId })
    )
  }, [attach])
}
