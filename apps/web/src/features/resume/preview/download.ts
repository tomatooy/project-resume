import { slug } from "@/lib/format"

/**
 * Saves the already-rendered preview blob. Export is free: the PDF the pane is
 * showing is the file the user gets. Returns the filename it wrote, for the
 * caller's toast.
 */
export function downloadPdf(blob: Blob, name: string): string {
  const filename = `${slug(name)}-resume.pdf`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return filename
}
