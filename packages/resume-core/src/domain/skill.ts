import { z } from "zod"

import { AppError } from "./errors"

/**
 * A playbook the user wrote.
 *
 * Stored rather than shipped, so the same contract the built-ins keep applies
 * here: prompt text with no authority. `deletedAt` is a soft delete because a
 * suggestion card stored before the deletion still has to name the playbook it
 * came from.
 */
export type CustomSkill = {
  id: string
  category: SkillCategory
  name: string
  whenToUse: string
  notFor?: string
  starter?: string
  body: string
  createdAt: string
  deletedAt?: string | null
}

/** The user's half of the library: what they wrote, and what they switched off. */
export type SkillOverlay = {
  /** Soft-deleted rows included: an old card still reads its name from here. */
  custom: CustomSkill[]
  /** Built-in and custom ids alike; the merge decides what the ids can name. */
  disabledIds: string[]
}

/**
 * What the editor saves. The caps are the wire and the table's shape at once:
 * the starter is one click's worth of text and the body is a playbook, not a
 * document.
 */
export const MAX_SKILL_NAME_CHARS = 80
export const MAX_SKILL_WHEN_TO_USE_CHARS = 200
export const MAX_SKILL_NOT_FOR_CHARS = 200
export const MAX_SKILL_STARTER_CHARS = 200
export const MAX_SKILL_BODY_CHARS = 8000

/**
 * What a skill is for. The rail groups the library by it; nothing reads it as
 * a permission, and a turn's tools and contract are the same in either one.
 */
export const SkillCategorySchema = z.enum(["editor", "interview"])
export type SkillCategory = z.infer<typeof SkillCategorySchema>

export const UserSkillInputSchema = z.object({
  // Defaulted rather than required: a client that predates the grouping, and a
  // `SKILL.md` with no category line, both mean an editing playbook.
  category: SkillCategorySchema.default("editor"),
  name: z.string().min(1).max(MAX_SKILL_NAME_CHARS),
  whenToUse: z.string().min(1).max(MAX_SKILL_WHEN_TO_USE_CHARS),
  notFor: z.string().max(MAX_SKILL_NOT_FOR_CHARS).optional(),
  starter: z.string().max(MAX_SKILL_STARTER_CHARS).optional(),
  body: z.string().min(1).max(MAX_SKILL_BODY_CHARS),
})
export type UserSkillInput = z.infer<typeof UserSkillInputSchema>

/** The cap on live custom skills. The same read-then-write shape as the hourly limit. */
export const MAX_CUSTOM_SKILLS = 20

/** The raw `SKILL.md` ceiling, before parsing. One file, not one paste. */
export const MAX_SKILL_MARKDOWN_CHARS = 20_000

/**
 * Parses a `SKILL.md` file into something the editor can save.
 *
 * Hand-rolled rather than a YAML dependency: the format is a fence, a couple
 * of `key: value` lines and prose, and a full parser would be more surface
 * than the whole feature needs. `description` maps to `whenToUse` because
 * that is what the frontmatter key is called everywhere else; other keys are
 * ignored so a file written for another tool still imports.
 *
 * A `category:` line is read when it is there and has to name one of the two
 * groups; leaving it out means an editing playbook.
 */
export function parseSkillMarkdown(text: string): UserSkillInput {
  if (text.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new AppError(
      "VALIDATION",
      `A skill file may be at most ${MAX_SKILL_MARKDOWN_CHARS} characters`
    )
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  if (lines[0]?.trim() !== "---") {
    throw new AppError(
      "VALIDATION",
      "A SKILL.md file starts with a --- block that names it"
    )
  }
  const close = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  )
  if (close === -1) {
    throw new AppError("VALIDATION", "The --- block is never closed")
  }

  const fields = new Map<string, string>()
  for (const line of lines.slice(1, close)) {
    const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line.trim())
    const [, key, value] = match ?? []
    if (key && value !== undefined) fields.set(key.toLowerCase(), value.trim())
  }

  const name = fields.get("name") ?? ""
  const whenToUse = fields.get("description") ?? ""
  if (name.length === 0) {
    throw new AppError("VALIDATION", "The --- block needs a name:")
  }
  if (whenToUse.length === 0) {
    throw new AppError(
      "VALIDATION",
      "The --- block needs a description: line saying when to use the skill"
    )
  }

  const parsed = UserSkillInputSchema.safeParse({
    category: parseCategory(fields.get("category")),
    name,
    whenToUse,
    body: lines
      .slice(close + 1)
      .join("\n")
      .trim(),
  })
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      `That skill does not fit the field limits (name ${MAX_SKILL_NAME_CHARS}, when to use ${MAX_SKILL_WHEN_TO_USE_CHARS}, body ${MAX_SKILL_BODY_CHARS})`
    )
  }
  return parsed.data
}

/** A `category:` line a file got wrong is worth naming, not a limits message. */
function parseCategory(value: string | undefined): SkillCategory | undefined {
  if (value === undefined) return undefined
  const wanted = value.trim().toLowerCase()
  const parsed = SkillCategorySchema.safeParse(wanted)
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      `The category: line must be ${SkillCategorySchema.options.join(" or ")}`
    )
  }
  return parsed.data
}
