import { downloadBlob } from "@workspace/resume-preview"
import { resumeFileName } from "@workspace/resume-schema"

/**
 * Saves the already-rendered preview blob. Export is free: the PDF the pane is
 * showing is the file the user gets. Returns the filename it wrote, for the
 * caller's toast.
 */
export function downloadPdf(blob: Blob, name: string): string {
  const filename = resumeFileName(name)
  downloadBlob(blob, filename)
  return filename
}
