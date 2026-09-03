import {
  SKILL_ALLOWED_OPS,
  SKILL_REQUIRES,
  SKILL_STATUS,
  type SkillId,
} from "@workspace/resume-core"
import type { NodeKind } from "@workspace/resume-schema"

import { buildSystemPrompt } from "../prompts/base"
import type {
  ResumeSkill,
  SkillContext,
  SkillScope,
  SkillToolName,
} from "./types"

export type SkillDefinition = {
  id: SkillId
  name: string
  description: string
  tools?: SkillToolName[]
  allowedFields?: Partial<Record<NodeKind, string[]>>
  scope: (ctx: SkillContext) => SkillScope
  /** The skill's own instructions, appended after the base prompt and contract. */
  fragment: (ctx: SkillContext) => string
}

/**
 * Status, op whitelist and required inputs come from `resume-core`, which is
 * what the server enforces. A skill file only adds what the model needs.
 */
export function defineSkill(definition: SkillDefinition): ResumeSkill {
  const allowedOps = SKILL_ALLOWED_OPS[definition.id]
  const tools: SkillToolName[] = definition.tools ?? ["propose_patches"]
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    status: SKILL_STATUS[definition.id],
    allowedOps,
    allowedFields: definition.allowedFields,
    tools: tools.includes("propose_patches")
      ? tools
      : [...tools, "propose_patches"],
    requires: SKILL_REQUIRES[definition.id],
    scope: definition.scope,
    systemPrompt: (ctx) =>
      buildSystemPrompt({
        fragment: definition.fragment(ctx),
        allowedOps,
        allowedFields: definition.allowedFields,
      }),
  }
}
