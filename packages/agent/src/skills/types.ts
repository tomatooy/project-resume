import type { UserSkillInput } from "@workspace/resume-core"

/** Guidance only; loading a body never changes a turn's permissions. */
export type Skill = UserSkillInput & {
  id: string
}

/** Catalog metadata excludes the body sent through load_skill. */
export type SkillMeta = Omit<Skill, "body">
