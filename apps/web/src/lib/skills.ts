import type {
  SkillId,
  SkillRequirement,
  SkillSpec,
} from "@workspace/resume-core"

/**
 * The picker reads the registry the route enforces: the same row says what
 * a skill is called, whether it has shipped, and what it needs from the
 * user, so the picker cannot offer a request the server would refuse.
 */
export { SKILLS, type SkillSpec, skillOf } from "@workspace/resume-core"

export const DEFAULT_SKILL: SkillId = "bullet_rewrite"

/** Selectable now; a `phase2` skill is listed but disabled. */
export function available(skill: SkillSpec): boolean {
  return skill.status === "mvp"
}

/** Whether the composer must show and send this input for the skill. */
export function needs(
  skill: SkillSpec | undefined,
  input: SkillRequirement
): boolean {
  return skill?.requires.includes(input) ?? false
}
