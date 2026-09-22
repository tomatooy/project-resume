import { isMap, isScalar, parseDocument } from "yaml"
import { z } from "zod"

export const MAX_SKILL_NAME_CHARS = 80
export const MAX_SKILL_DESCRIPTION_CHARS = 1024
export const MAX_SKILL_WHEN_TO_USE_CHARS = 200
export const MAX_SKILL_NOT_FOR_CHARS = 200
export const MAX_SKILL_STARTER_CHARS = 200
export const MAX_SKILL_BODY_CHARS = 50_000
export const MAX_CUSTOM_SKILLS = 20

export const SkillCategorySchema = z.enum(["editor", "interview"])
export type SkillCategory = z.infer<typeof SkillCategorySchema>

/** Import fills a draft; field requirements apply only when saving. */
export const SkillDraftSchema = z.object({
  category: z.string().default("editor"),
  name: z.string().default(""),
  description: z.string().default(""),
  whenToUse: z.string().optional(),
  notFor: z.string().optional(),
  starter: z.string().optional(),
  body: z.string().default(""),
})
export type SkillDraft = z.infer<typeof SkillDraftSchema>

function requiredText(label: string, maximum: number) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(
      maximum,
      `${label} must be ${maximum.toLocaleString("en-US")} characters or fewer.`
    )
}

function optionalText(label: string, maximum: number) {
  return z
    .string()
    .trim()
    .max(
      maximum,
      `${label} must be ${maximum.toLocaleString("en-US")} characters or fewer.`
    )
    .transform((value) => value || undefined)
    .optional()
}

export const UserSkillInputSchema = SkillDraftSchema.extend({
  category: SkillCategorySchema.default("editor"),
  name: requiredText("Name", MAX_SKILL_NAME_CHARS),
  description: requiredText("Description", MAX_SKILL_DESCRIPTION_CHARS),
  whenToUse: optionalText("When to use", MAX_SKILL_WHEN_TO_USE_CHARS),
  notFor: optionalText("Not for", MAX_SKILL_NOT_FOR_CHARS),
  starter: optionalText("Starter", MAX_SKILL_STARTER_CHARS),
  body: requiredText("Body", MAX_SKILL_BODY_CHARS),
})
export type UserSkillInput = z.infer<typeof UserSkillInputSchema>

/** Soft-deleted rows retain attribution for older suggestions. */
export type CustomSkill = UserSkillInput & {
  id: string
  createdAt: string
  deletedAt?: string | null
}

export type SkillOverlay = {
  custom: CustomSkill[]
  disabledIds: string[]
}

export function parseSkillMarkdown(text: string): SkillDraft {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  const fallback = SkillDraftSchema.parse({ body: normalized.trim() })
  if (lines[0]?.trim() !== "---") return fallback
  const close = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  )
  if (close === -1) return fallback

  const document = parseDocument(lines.slice(1, close).join("\n"), {
    schema: "failsafe",
    logLevel: "silent",
  })
  const fields = document.contents
  // Keep unreadable frontmatter available for editing instead of losing it.
  if (document.errors.length > 0 || !isMap(fields)) return fallback

  const metadata = fields
  function read(...keys: string[]): string | undefined {
    for (const key of keys) {
      const node = metadata.items.find(
        (pair) => isScalar(pair.key) && pair.key.value === key
      )?.value
      if (isScalar(node) && typeof node.value === "string")
        return node.value.trim()
    }
    return undefined
  }

  return SkillDraftSchema.parse({
    category: read("category")?.toLowerCase(),
    name: read("name"),
    description: read("description"),
    whenToUse: read("whenToUse", "when_to_use", "when-to-use"),
    notFor: read("notFor", "not_for", "not-for"),
    starter: read("starter"),
    body: lines
      .slice(close + 1)
      .join("\n")
      .trim(),
  })
}
