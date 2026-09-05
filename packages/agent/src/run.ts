import {
  type LanguageModelUsage,
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
  /**
   * Fired per completed model turn. Callers sum usage here rather than await
   * the result's totals, which never settle when the stream is aborted.
   */
  onStepEnd?: (step: { usage: LanguageModelUsage }) => void
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

export function runSkill(input: RunSkillInput) {
  const { skill, ctx, models } = input
  const { resumeContext } = skill.scope(ctx)

  const tools: AgentTools = {
    check_fit: checkFitTool,
    propose_patches: proposePatchesTool({
      runId: input.runId,
      resume: ctx.resume,
      persist: input.persist,
      // Op and field whitelists, the scope anchor and the grounding text are
      // all derived from the skill id and the selection. What the model was
      // shown (`resumeContext`) is a separate decision from what it is allowed
      // to change, and only the latter is enforced.
      validation: {
        mode: "propose",
        skillId: skill.id,
        selectedNodeId: ctx.selectedNodeId,
        userMessage: ctx.userMessage,
        jobDescription: ctx.jobDescription,
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
    onStepEnd: (step) => input.onStepEnd?.({ usage: step.usage }),
  })
}
