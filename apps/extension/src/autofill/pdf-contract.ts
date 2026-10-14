import { z } from "zod"
import {
  AUTOFILL_LIMITS,
  PdfDocumentSchema,
  SourceStampSchema,
} from "@workspace/resume-core/contracts"

export const ResumePdfSchema = z.strictObject({
  /** Identity of the rendered bytes: bundle, template, options, assets. */
  pdfId: z.string().min(1).max(64),
  /**
   * The retired identity, still spoken by the retired executor, which refuses
   * a PDF it cannot tie to the plan it was rendered for. A render from a pinned
   * bundle carries no stamp, so that path refuses until ticket 12 joins the
   * two, rather than attaching bytes nothing can identify.
   */
  sourceStamp: SourceStampSchema.optional(),
  filename: z
    .string()
    .min(5)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+\.pdf$/),
  base64: z
    .string()
    .min(8)
    .max(Math.ceil(AUTOFILL_LIMITS.uploadBytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  byteLength: z.number().int().min(5).max(AUTOFILL_LIMITS.uploadBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export type ResumePdf = z.infer<typeof ResumePdfSchema>
export const PdfRenderRequestSchema = z.strictObject({
  type: z.literal("af.pdf.render"),
  protocolVersion: z.literal(1),
  requestId: z.uuid(),
  source: PdfDocumentSchema,
})
export const PdfRenderReplySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    requestId: z.uuid(),
    file: ResumePdfSchema,
  }),
  z.strictObject({ ok: z.literal(false), requestId: z.uuid() }),
])
export async function pdfDigest(
  bytes: Uint8Array<ArrayBuffer>
): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}
export async function pdfBytes(
  file: ResumePdf
): Promise<Uint8Array<ArrayBuffer>> {
  const checked = ResumePdfSchema.parse(file)
  const bytes = Uint8Array.from(atob(checked.base64), (char) =>
    char.charCodeAt(0)
  )
  if (
    bytes.byteLength !== checked.byteLength ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-" ||
    (await pdfDigest(bytes)) !== checked.sha256
  )
    throw new Error("Invalid PDF")
  return bytes
}
