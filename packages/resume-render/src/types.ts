import type { Resume } from "@workspace/resume-schema"
import type { ComponentType } from "react"

import type { ResolvedFonts } from "./fonts"

export type PageSize = "A4" | "LETTER"
export type FontScale = 0.9 | 1 | 1.1

export type TemplateOptions = {
  pageSize: PageSize
  fontScale: FontScale
  /** Hex. Templates that are deliberately monochrome ignore it. */
  accent?: string
}

export const TEMPLATE_IDS = [
  "lisbon",
  "meridian",
  "plainsong",
  "harbor",
  "ledger",
  "atlas",
] as const

export type TemplateId = (typeof TEMPLATE_IDS)[number]

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

export const defaultTemplateOptions: TemplateOptions = {
  pageSize: "LETTER",
  fontScale: 1,
}

export function isTemplateId(value: unknown): value is TemplateId {
  return (
    typeof value === "string" &&
    (TEMPLATE_IDS as readonly string[]).includes(value)
  )
}
