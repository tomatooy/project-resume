import { pdf, ResumeDocument } from "@workspace/resume-render"
import {
  AUTOFILL_LIMITS,
  type PdfDocument,
} from "@workspace/resume-core/contracts"
import { pdfDigest, ResumePdfSchema } from "./pdf-contract"

/**
 * Render the pinned document to PDF bytes. The returned file is identified by
 * the bundle's PDF identity, not by a source stamp: the same resume, template
 * and font assets have to produce the same identity, and a change to any of
 * them has to produce a different one.
 */
export async function renderResumePdf(source: PdfDocument) {
  const blob = await pdf(
    <ResumeDocument
      resume={source.resume}
      templateId={source.render.templateId}
      options={source.render.templateOptions}
    />
  ).toBlob()
  if (!blob.size || blob.size > AUTOFILL_LIMITS.uploadBytes)
    throw new Error("PDF too large")
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  const name = source.resume.basics.name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70)
  return ResumePdfSchema.parse({
    pdfId: source.pdfId,
    filename: `${name || "applicant"}-resume.pdf`,
    base64: btoa(binary),
    byteLength: bytes.length,
    sha256: await pdfDigest(bytes),
  })
}
