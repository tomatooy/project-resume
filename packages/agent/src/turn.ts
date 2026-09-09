import {
  type MessageMetadata,
  CheckFitOutputSchema,
} from "@workspace/resume-core"
import {
  convertToModelMessages,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type StopCondition,
  stepCountIs,
  streamText,
  type UIMessage,
  validateUIMessages,
} from "ai"

import type { Models } from "./models"
import { resumeContextBlock, summaryBlock } from "./prompts/base"
import type { ResumeSkill, SkillContext } from "./skills/types"
import { type PersistProposal, checkFitTool, proposePatchesTool } from "./tools"

export type AgentTools = {
  check_fit: typeof checkFitTool
  propose_patches: ReturnType<typeof proposePatchesTool>
}

export type TurnMemory = {
  summaryText: string | null
  /** The recent window, already converted, ending with the current user turn. */
  messages: ModelMessage[]
}

export type TurnUsage = {
  inputTokens: number
  outputTokens: number
  /** Model turns taken, which is what the step budget bounds. */
  steps: number
}

/**
 * How a turn ended.
 *
 * `paused` is the one that is not an ending: `check_fit` has no server side,
 * so the model's turn stops with the call open, the browser renders the PDF
 * and sends the conversation back. The run stays open until then, which is
 * why the caller must not close it.
 */
export type TurnOutcome = {
  status: "completed" | "paused" | "cancelled" | "failed"
  usage: TurnUsage
  /** The assistant message as the transcript will hold it. */
  message: UIMessage
  /** Present when the turn failed; the caller classifies and logs it. */
  error?: unknown
}

/** What the user sees in place of an answer when the turn breaks. */
export const TURN_ERROR_TEXT = "The assistant hit a problem. Please try again."

export type StartTurnInput = {
  skill: ResumeSkill
  ctx: SkillContext
  models: Models
  runId: string
  persist: PersistProposal
  memory: TurnMemory
  /** The transcript the browser sent, which the response extends. */
  originalMessages: UIMessage[]
  /** Stamped on the assistant message as it starts. */
  metadata: MessageMetadata
  /**
   * Awaited before the stream closes, so writes made here still happen inside
   * the request. A promise handed back instead would settle after the response
   * had ended, which on Workers means after the isolate may be gone.
   */
  onSettled: (outcome: TurnOutcome) => Promise<void>
  abortSignal?: AbortSignal
}

export type RunSkillInput = {
  skill: ResumeSkill
  ctx: SkillContext
  models: Models
  runId: string
  persist: PersistProposal
  memory: TurnMemory
  abortSignal?: AbortSignal
  /**
   * Fired per completed model turn. Callers sum usage here rather than await
   * the result's totals, which never settle when the stream is aborted.
   */
  onStepEnd?: (step: { usage: LanguageModelUsage }) => void
}

/** Model turns per run. A proposal normally lands in one or two. */
const MAX_STEPS = 6

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

/**
 * The model loop for one skill: the prompt from the skill and what it was
 * shown, the tools bound to this run, and the stop rule.
 *
 * Exported for this package's own tests, which read the steps back; the app
 * only ever sees `startTurn`.
 */
export function runSkill(input: RunSkillInput) {
  const { skill, ctx, models } = input

  const tools: AgentTools = {
    check_fit: checkFitTool,
    propose_patches: proposePatchesTool({
      runId: input.runId,
      resume: ctx.resume,
      persist: input.persist,
      // Op and field whitelists and the scope anchor are all derived from the
      // skill id and the selection. What the model was shown (`skill.show`) is
      // a separate decision from what it is allowed to change, and only the
      // latter is enforced.
      validation: {
        mode: "propose",
        skillId: skill.id,
        selectedNodeId: ctx.selectedNodeId,
        userMessage: ctx.userMessage,
      },
    }),
  }

  const system = [
    skill.systemPrompt(ctx),
    input.memory.summaryText ? summaryBlock(input.memory.summaryText) : null,
    resumeContextBlock(skill.show(ctx)),
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

/**
 * One assistant turn, start to finish, behind one call.
 *
 * The model loop, the tools, the step budget, the usage totals, the rule that
 * decides a turn paused rather than ended, and the mapping from an abort to an
 * outcome all live here. The caller supplies what only it knows (the run, the
 * services, the transcript) and is handed a `Response` plus one callback that
 * says how the turn ended.
 *
 * Those rules used to sit in the route, spread across `onStepEnd`, `onError`
 * and `onFinish` closures, which is why they could only be exercised through
 * an HTTP request. They also made the app import the AI SDK directly, against
 * the split this package exists to keep.
 */
export function startTurn(input: StartTurnInput): Response {
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, steps: 0 }
  let streamError: unknown

  const result = runSkill({
    skill: input.skill,
    ctx: input.ctx,
    models: input.models,
    runId: input.runId,
    persist: input.persist,
    memory: input.memory,
    abortSignal: input.abortSignal,
    // Summed per step rather than read off the result's totals, which never
    // settle when the stream is aborted.
    onStepEnd: (step) => {
      usage.steps += 1
      usage.inputTokens += step.usage.inputTokens ?? 0
      usage.outputTokens += step.usage.outputTokens ?? 0
    },
  })

  return result.toUIMessageStreamResponse({
    originalMessages: input.originalMessages,
    messageMetadata: ({ part }) =>
      part.type === "start" ? input.metadata : undefined,
    onError: (error) => {
      streamError = error
      return TURN_ERROR_TEXT
    },
    onFinish: async ({ responseMessage, isAborted, outcome }) => {
      const failed = outcome.status === "failed"
      const paused =
        !isAborted && !failed && checkFitState(responseMessage) === "awaiting"

      await input.onSettled({
        status: paused
          ? "paused"
          : isAborted
            ? "cancelled"
            : failed
              ? "failed"
              : "completed",
        usage,
        message: responseMessage,
        error: failed ? (outcome.error ?? streamError) : undefined,
      })
    },
  })
}

/**
 * Where a message stands on the one tool the browser answers.
 *
 * `awaiting`: the model called `check_fit` and nobody has answered.
 * `answered`: an answer is attached, so the model can carry on.
 * `none`: the message never called it.
 *
 * Only the newest call counts. A continued turn keeps the calls it already
 * made, so a message that answered one check and then opened another is
 * awaiting, and reading the answered one first would close a run that is
 * still waiting on the browser. `condense_to_pages` checks more than once
 * whenever its first cut misses the page target.
 */
export function checkFitState(
  message: UIMessage
): "awaiting" | "answered" | "none" {
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const part = message.parts[i]
    if (!part || !isToolUIPart(part) || part.type !== "tool-check_fit") continue
    if (part.state === "output-error") return "answered"
    return part.state === "output-available" &&
      CheckFitOutputSchema.safeParse(part.output).success
      ? "answered"
      : "awaiting"
  }
  return "none"
}

/** The browser's `check_fit` answer, as the model messages that continue the run. */
export function checkFitAnswer(message: UIMessage): Promise<ModelMessage[]> {
  return convertToModelMessages([message], {
    tools: { check_fit: checkFitTool },
    ignoreIncompleteToolCalls: true,
  })
}

/** Parses what `useChat` posted into messages the rest of this package accepts. */
export function parseUIMessages(messages: unknown[]): Promise<UIMessage[]> {
  return validateUIMessages({ messages })
}
