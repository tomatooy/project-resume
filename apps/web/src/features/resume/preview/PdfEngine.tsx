import { applyStrict } from "@workspace/resume-schema"
import { ResumeDocument, pdf } from "@workspace/resume-render"
import type { PreviewInput } from "./render-queue"

export async function renderPreview(input: PreviewInput): Promise<Blob> {
  const applied = input.patches.length
    ? applyStrict(input.doc, input.patches)
    : null
  const shown = applied?.ok ? applied.resume : input.doc
  return pdf(
    <ResumeDocument
      resume={shown}
      templateId={input.templateId}
      options={input.options}
    />
  ).toBlob()
}
