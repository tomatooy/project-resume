import type { SkillSpec } from "@workspace/resume-core"
import type { Resume, ResumeNode } from "@workspace/resume-schema"

/** Everything a skill can see for one request (back-end design, 10.2). */
export type SkillContext = {
  resume: Resume
  userMessage: string
  selectedNodeId?: string
  jobDescription?: string
  targetPages?: number
}

/**
 * What the model is shown: the whole resume, or the selected item with the
 * headline for orientation. Not what it may change; that is derived from the
 * same selection by `validateForSkill`, so the two cannot drift.
 */
export type SkillScope =
  | { kind: "document"; resume: Resume }
  | { kind: "node"; headline?: string; selected: ResumeNode }

/** A registry row plus the two things only the prompt side knows. */
export type ResumeSkill = SkillSpec & {
  /** What the model is shown for this request. */
  show(ctx: SkillContext): SkillScope
  /** Base prompt, patch contract and the skill's own instructions. No resume. */
  systemPrompt(ctx: SkillContext): string
}
