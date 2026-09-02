import { z } from "zod"

/**
 * Presentation settings. These live on the `resumes` row rather than inside the
 * document, so a version captures content only and switching templates can
 * never change what a resume says.
 *
 * The contract sits here rather than in `resume-render` because it is stored
 * data, and `resume-core` and the server need it without pulling react-pdf in.
 * `resume-render` re-exports it, so template code still reads it from there.
 */

export const TEMPLATE_IDS = [
  "lisbon",
  "meridian",
  "plainsong",
  "harbor",
  "ledger",
  "atlas",
] as const

export type TemplateId = (typeof TEMPLATE_IDS)[number]
export const TemplateIdSchema = z.enum(TEMPLATE_IDS)
export const DEFAULT_TEMPLATE_ID: TemplateId = "lisbon"

export const PageSizeSchema = z.enum(["A4", "LETTER"])
export type PageSize = z.infer<typeof PageSizeSchema>

export const FontScaleSchema = z.union([
  z.literal(0.9),
  z.literal(1),
  z.literal(1.1),
])
export type FontScale = z.infer<typeof FontScaleSchema>

export const TemplateOptionsSchema = z.object({
  pageSize: PageSizeSchema,
  fontScale: FontScaleSchema,
  /** Hex. Templates that are deliberately monochrome ignore it. */
  accent: z.string().optional(),
})
export type TemplateOptions = z.infer<typeof TemplateOptionsSchema>

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

/**
 * Read-side coercion for the `template_id` column, which is plain text so that
 * adding a template needs no migration. The export and preflight screens index
 * the template map without guarding, so a value from an older release must
 * become a template that exists rather than reaching them.
 */
export function toTemplateId(value: unknown): TemplateId {
  return isTemplateId(value) ? value : DEFAULT_TEMPLATE_ID
}

/** Same, for the `template_options` jsonb column. */
export function toTemplateOptions(value: unknown): TemplateOptions {
  const parsed = TemplateOptionsSchema.safeParse(value)
  return parsed.success ? parsed.data : defaultTemplateOptions
}
