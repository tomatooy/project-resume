import {
  SKILL_ALLOWED_FIELDS,
  SKILL_ALLOWED_OPS,
  SKILL_REQUIRES,
  SKILL_STATUS,
  type SkillId,
} from "@workspace/resume-core"

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
  /** What the model is shown. Not what it may change: see `SKILL_SCOPE`. */
  scope: (ctx: SkillContext) => SkillScope
  /** The skill's own instructions, appended after the base prompt and contract. */
  fragment: (ctx: SkillContext) => string
}

/**
 * Status, op whitelist, field whitelist and required inputs all come from
 * `resume-core`, which is what the server enforces. A skill file only adds
 * what the model needs: its prompt fragment and what it is shown.
 */
export function defineSkill(definition: SkillDefinition): ResumeSkill {
  const allowedOps = SKILL_ALLOWED_OPS[definition.id]
  const allowedFields = SKILL_ALLOWED_FIELDS[definition.id]
  const tools: SkillToolName[] = definition.tools ?? ["propose_patches"]
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    status: SKILL_STATUS[definition.id],
    allowedOps,
    allowedFields,
    tools: tools.includes("propose_patches")
      ? tools
      : [...tools, "propose_patches"],
    requires: SKILL_REQUIRES[definition.id],
    scope: definition.scope,
    systemPrompt: (ctx) =>
      buildSystemPrompt({
        fragment: definition.fragment(ctx),
        allowedOps,
        allowedFields,
      }),
  }
}
