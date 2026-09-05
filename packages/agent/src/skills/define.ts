import { SKILL, type SkillId } from "@workspace/resume-core"

import { buildSystemPrompt } from "../prompts/base"
import { nodeScope, wholeDocument } from "../scope"
import type { ResumeSkill, SkillContext } from "./types"

/**
 * A skill file adds the one thing the registry cannot hold: what the model
 * is told. Its label, status, whitelists, required inputs, tools and scope
 * all come from the registry row in `resume-core`, which is what the server
 * enforces, so nothing here can disagree with it.
 */
export function defineSkill(definition: {
  id: SkillId
  /** The skill's own instructions, appended after the base prompt and contract. */
  fragment: (ctx: SkillContext) => string
}): ResumeSkill {
  const spec = SKILL[definition.id]
  return {
    ...spec,
    show: spec.scope === "node" ? nodeScope : wholeDocument,
    systemPrompt: (ctx) =>
      buildSystemPrompt({
        fragment: definition.fragment(ctx),
        allowedOps: spec.allowedOps,
        allowedFields: spec.allowedFields,
      }),
  }
}
