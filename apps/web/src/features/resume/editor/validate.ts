import {
  BasicsSchema,
  BulletSchema,
  CustomItemSchema,
  EducationItemSchema,
  ExperienceItemSchema,
  LinkSchema,
  ProjectItemSchema,
  SkillsGroupSchema,
} from "@workspace/resume-schema"
import type { z } from "zod"

const SCHEMAS = {
  basics: BasicsSchema,
  link: LinkSchema,
  bullet: BulletSchema,
  experience: ExperienceItemSchema,
  education: EducationItemSchema,
  project: ProjectItemSchema,
  skills: SkillsGroupSchema,
  custom: CustomItemSchema,
} satisfies Record<string, z.ZodType>

export type NodeSchemaKey = keyof typeof SCHEMAS

/**
 * Field-level errors for one node, keyed by field name. Validation runs against
 * the same schema the server uses, so the editor never reports a problem the
 * back end would accept, or accepts one it would reject.
 */
export function validateNode(
  key: NodeSchemaKey,
  node: unknown
): Record<string, string> {
  const result = SCHEMAS[key].safeParse(node)
  if (result.success) return {}

  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (typeof field !== "string" || errors[field]) continue
    errors[field] = issue.message
  }
  return errors
}
