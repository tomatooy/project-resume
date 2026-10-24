import { waitFor } from "./dom"
import type { ScannedField } from "./types"

/** How long the page may take to show the file it was given. */
const SHOWN_MS = 15_000

export type AttachResult = "attached" | "skipped" | "failed"

export type AttachOptions = {
  setFiles?: (input: HTMLInputElement, file: File) => void
  /** The file name the vendor's widget shows, when it has its own. */
  attachedName?: (field: ScannedField) => string | null
  timeoutMs?: number
  /** The names of the files we put into this field on this page. */
  placed?: ReadonlySet<string>
}

/** Sets the input's files as a person's pick would, then fires its events. */
function setFilesNatively(input: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Puts the resume PDF into a file field (spec 10). A field that already
 * shows a file keeps it, unless the name it shows is `previous` or one in
 * `placed`: a file we attached before. With `attachedName`, success waits
 * for the page to show the new name.
 */
export async function attachFile(
  field: ScannedField,
  file: { name: string; base64: string; previous: string | null },
  options: AttachOptions = {}
): Promise<AttachResult> {
  const { element } = field
  if (field.kind !== "file" || !(element instanceof HTMLInputElement))
    return "failed"
  const { attachedName } = options
  const shown = attachedName?.(field) ?? element.files?.item(0)?.name ?? null
  if (shown !== null && shown !== file.previous && !options.placed?.has(shown))
    return "skipped"
  try {
    const pdf = new File([decode(file.base64)], file.name, {
      type: "application/pdf",
    })
    ;(options.setFiles ?? setFilesNatively)(element, pdf)
  } catch {
    return "failed"
  }
  if (!attachedName) return "attached"
  const confirmed = await waitFor(
    () => (attachedName(field) === file.name ? true : null),
    options.timeoutMs ?? SHOWN_MS
  )
  return confirmed ? "attached" : "failed"
}
