import { collectText, type Resume } from "@workspace/resume-schema"
import { containsCjk, resolveFonts } from "./fonts"
import { templates } from "./templates/index"
import {
  defaultTemplateOptions,
  isTemplateId,
  type TemplateId,
  type TemplateOptions,
} from "./types"

export type ResumeDocumentProps = {
  resume: Resume
  templateId: TemplateId | string
  options?: TemplateOptions
}

/**
 * Resolves a template id to its document and picks the font families the
 * document needs. An unknown id falls back to Lisbon rather than throwing, so a
 * resume saved against a template we later remove still renders.
 */
export function ResumeDocument({
  resume,
  templateId,
  options = defaultTemplateOptions,
}: ResumeDocumentProps) {
  const id: TemplateId = isTemplateId(templateId) ? templateId : "lisbon"
  if (!isTemplateId(templateId)) {
    console.warn(`Unknown template "${templateId}", falling back to Lisbon`)
  }

  // Registering the 10 MB CJK family is the expensive part, so the scan runs
  // every render but the registration happens at most once.
  const fonts = resolveFonts(collectText(resume).some(containsCjk))

  const { Document: Template } = templates[id]
  return <Template resume={resume} options={options} fonts={fonts} />
}
