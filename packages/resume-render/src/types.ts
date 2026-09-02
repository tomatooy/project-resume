import type { Resume } from "@workspace/resume-schema"
import type { ComponentType } from "react"

import type { ResolvedFonts } from "./fonts"

/**
 * The template contract is defined in `resume-schema` because it is stored on
 * the `resumes` row and the server needs it without react-pdf. Re-exported
 * here so template code keeps reading it from the package that owns rendering.
 */
export {
  DEFAULT_TEMPLATE_ID,
  defaultTemplateOptions,
  FontScaleSchema,
  isTemplateId,
  PageSizeSchema,
  TEMPLATE_IDS,
  TemplateIdSchema,
  TemplateOptionsSchema,
  toTemplateId,
  toTemplateOptions,
  type FontScale,
  type PageSize,
  type TemplateId,
  type TemplateOptions,
} from "@workspace/resume-schema"

import type { TemplateId, TemplateOptions } from "@workspace/resume-schema"

export type TemplateProps = {
  resume: Resume
  options: TemplateOptions
  /** Families resolved by `ResumeDocument`, including a CJK fallback if needed. */
  fonts: ResolvedFonts
}

export type TemplateDefinition = {
  id: TemplateId
  name: string
  /** One line, shown under the template's thumbnail in the picker. */
  description: string
  /** Drives the thumbnail the console draws: two columns or one. */
  twoColumn: boolean
  /** Whether the thumbnail shows a rule under the name block. */
  ruledHeader: boolean
  accent: string
  Document: ComponentType<TemplateProps>
}
