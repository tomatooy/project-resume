import type {
  SkillId,
  SkillRequirement,
  SkillStatus,
} from "@workspace/resume-core"
import type { NodeKind, PatchOp, Resume } from "@workspace/resume-schema"

/** Everything a skill can see for one request (back-end design, 10.2). */
export type SkillContext = {
  resume: Resume
  userMessage: string
  selectedNodeId?: string
  jobDescription?: string
  targetPages?: number
}

export type SkillScope = {
  /** What the model is shown; the whole resume or a cut-down view of it. */
  resumeContext: unknown
}

export type SkillToolName = "check_fit" | "propose_patches"

export type ResumeSkill = {
  id: SkillId
  name: string
  description: string
  status: SkillStatus
  /**
   * Both mirror the tables in `resume-core`, which is what the validator
   * enforces. These copies exist so the prompt can state the limits; they are
   * read by `buildSystemPrompt` and by nothing that gates a patch.
   */
  allowedOps: PatchOp[]
  allowedFields?: Partial<Record<NodeKind, string[]>>
  /** `propose_patches` is always present. */
  tools: SkillToolName[]
  requires: SkillRequirement[]
  scope(ctx: SkillContext): SkillScope
  /** Base prompt, patch contract and the skill's own instructions. No resume. */
  systemPrompt(ctx: SkillContext): string
}
