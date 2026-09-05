import {
  type MessageMetadata,
  CheckFitOutputSchema,
} from "@workspace/resume-core"
import {
  convertToModelMessages,
  isToolUIPart,
  type ModelMessage,
  type UIMessage,
  validateUIMessages,
} from "ai"

import type { Models } from "./models"
import { type RunMemory, runSkill } from "./run"
import type { ResumeSkill, SkillContext } from "./skills/types"
import { type PersistProposal, checkFitTool } from "./tools"

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
  memory: RunMemory
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
 */
export function checkFitState(
  message: UIMessage
): "awaiting" | "answered" | "none" {
  let seen = false
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.type !== "tool-check_fit") continue
    seen = true
    if (part.state === "output-error") return "answered"
    if (
      part.state === "output-available" &&
      CheckFitOutputSchema.safeParse(part.output).success
    ) {
      return "answered"
    }
  }
  return seen ? "awaiting" : "none"
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
