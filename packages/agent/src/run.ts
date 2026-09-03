import { collectText } from "@workspace/resume-schema"
import {
  type ModelMessage,
  type StopCondition,
  stepCountIs,
  streamText,
} from "ai"

import type { Models } from "./models"
import { resumeContextBlock, summaryBlock } from "./prompts/base"
import type { ResumeSkill, SkillContext } from "./skills/types"
import { type PersistProposal, checkFitTool, proposePatchesTool } from "./tools"

export type AgentTools = {
  check_fit: typeof checkFitTool
  propose_patches: ReturnType<typeof proposePatchesTool>
}

export type RunMemory = {
  summaryText: string | null
  /** The recent window, already converted, ending with the current user turn. */
  messages: ModelMessage[]
}

export type RunSkillInput = {
  skill: ResumeSkill
  ctx: SkillContext
  models: Models
  runId: string
  persist: PersistProposal
  memory: RunMemory
  abortSignal?: AbortSignal
}

/** Model turns per run. A proposal normally lands in one or two. */
export const MAX_STEPS = 6

/**
 * Ends the loop once a proposal went through with nothing refused. A refused
 * batch gets another turn so the model can correct it; the step budget bounds
 * how many.
 */
const proposalAccepted: StopCondition<AgentTools> = ({ steps }) => {
  const last = steps[steps.length - 1]
  if (!last) return false
  return last.staticToolResults.some(
    (result) =>
      result.toolName === "propose_patches" &&
      result.output.rejected.length === 0
  )
}

/** Where a number is allowed to come from: the user, the posting, the resume. */
export function groundingText(ctx: SkillContext): string {
  return [
    ctx.userMessage,
    ctx.jobDescription ?? "",
    ...collectText(ctx.resume),
  ].join("\n")
}

export function runSkill(input: RunSkillInput) {
  const { skill, ctx, models } = input
  const { scopeNodeId, resumeContext } = skill.scope(ctx)

  const tools: AgentTools = {
    check_fit: checkFitTool,
    propose_patches: proposePatchesTool({
      skillId: skill.id,
      runId: input.runId,
      resume: ctx.resume,
      persist: input.persist,
      validation: {
        allowedOps: skill.allowedOps,
        allowedFields: skill.allowedFields,
        scopeNodeId,
        groundingText: groundingText(ctx),
      },
    }),
  }

  const system = [
    skill.systemPrompt(ctx),
    input.memory.summaryText ? summaryBlock(input.memory.summaryText) : null,
    resumeContextBlock(resumeContext),
  ]
    .filter((block): block is string => block !== null)
    .join("\n\n")

  return streamText({
    model: models.smart,
    system,
    messages: input.memory.messages,
    tools,
    activeTools: skill.tools,
    stopWhen: [stepCountIs(MAX_STEPS), proposalAccepted],
    providerOptions: models.providerOptions,
    abortSignal: input.abortSignal,
  })
}
