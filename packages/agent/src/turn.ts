import {
  type MessageMetadata,
  CheckFitOutputSchema,
  type TurnPlan,
} from "@workspace/resume-core"
import type { Resume } from "@workspace/resume-schema"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type StopCondition,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from "ai"

import type { Models } from "./models"
import { buildSystemPrompt } from "./prompts/base"
import { hideToolStepText } from "./visible"
import {
  type AgentTools,
  TOOL_NAMES,
  type PersistProposal,
  type TurnState,
  buildTools,
  checkFitTool,
} from "./tools"

/** Re-exported so a caller can build what `startTurn` takes from one import. */
export type { AgentTools, TurnState } from "./tools"

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
  /** The step budget ran out with nothing proposed. */
  budgetExhausted: boolean
  /** Present when the turn failed; the caller classifies and logs it. */
  error?: unknown
}

/** What the user sees in place of an answer when the turn breaks. */
export const TURN_ERROR_TEXT = "The assistant hit a problem. Please try again."

export type RunTurnInput = {
  /** What this turn knows: the selection, the hint, the flag. */
  state: TurnState
  resume: Resume
  models: Models
  runId: string
  persist: PersistProposal
  /** Records the plan line on the run. */
  recordPlan: (plan: TurnPlan) => Promise<void>
  /** Appends a playbook the turn loaded to the run row. */
  addSkill: (id: string) => Promise<void>
  memory: TurnMemory
  abortSignal?: AbortSignal
  /**
   * Fired per completed model turn. Callers sum usage here rather than await
   * the result's totals, which never settle when the stream is aborted.
   */
  onStepEnd?: (step: { usage: LanguageModelUsage }) => void
}

export type StartTurnInput = RunTurnInput & {
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
 * The model loop for one turn.
 *
 * One `streamText` call, one tool set, and nothing that rewrites the request
 * mid-turn: `activeTools` is the same array on every step, so the provider's
 * prompt prefix stays cacheable (the SDK rewrites the tools block whenever
 * `activeTools` changes, which is what missed the cache every step when the
 * tool set was gated per stage). `plan`, `load_skill` and `propose_patches`
 * may all run in the same step, so a short turn is one round trip.
 *
 * The tool set is handed back beside the result because `toUIMessageStream`
 * takes it separately: it looks each call's name up there to tell a static
 * tool from a dynamic one, and without it every tool chunk goes out carrying a
 * `dynamic: false` the browser never had to see.
 *
 * Exported for this package's own tests, which read the steps back; the app
 * only ever sees `startTurn`.
 */
export function runTurn(input: RunTurnInput) {
  const { state, resume, models } = input

  const tools = buildTools({
    runId: input.runId,
    resume,
    state,
    persist: input.persist,
    recordPlan: input.recordPlan,
    addSkill: input.addSkill,
  })

  const system = buildSystemPrompt({
    state,
    resume,
    summaryText: input.memory.summaryText,
  })

  const result = streamText({
    model: models.smart,
    system,
    messages: input.memory.messages,
    tools,
    activeTools: [...TOOL_NAMES],
    stopWhen: [stepCountIs(MAX_STEPS), proposalAccepted],
    providerOptions: models.providerOptions.smart,
    abortSignal: input.abortSignal,
    onStepEnd: (step) => input.onStepEnd?.({ usage: step.usage }),
  })

  return { result, tools }
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
 * The UI stream is piped through the visibility rule, which drops the text of
 * any step that called a tool and never passes reasoning through. The message
 * handed to `onSettled` is the unfiltered one: it is only read for the fit
 * state and the outcome, and the store applies the same rule, so what is
 * persisted matches what was streamed.
 */
export function startTurn(input: StartTurnInput): Response {
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, steps: 0 }
  let streamError: unknown

  const { result, tools } = runTurn({
    ...input,
    // Summed per step rather than read off the result's totals, which never
    // settle when the stream is aborted.
    onStepEnd: (step) => {
      usage.steps += 1
      usage.inputTokens += step.usage.inputTokens ?? 0
      usage.outputTokens += step.usage.outputTokens ?? 0
    },
  })

  const uiStream = toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: input.originalMessages,
    // Thinking is the model's own. `models.ts` turns it on for the smart tier,
    // and nothing downstream should see it.
    sendReasoning: false,
    messageMetadata: ({ part }) =>
      part.type === "start" ? input.metadata : undefined,
    onError: (error) => {
      streamError = error
      return TURN_ERROR_TEXT
    },
    onEnd: async ({ responseMessage, isAborted, outcome }) => {
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
        budgetExhausted:
          !proposedPatches(responseMessage) && usage.steps >= MAX_STEPS,
        error: failed ? (outcome.error ?? streamError) : undefined,
      })
    },
  })

  return createUIMessageStreamResponse({
    stream: uiStream.pipeThrough(hideToolStepText()),
  })
}

/** Whether the turn ever landed a proposal, which is what lets it speak. */
function proposedPatches(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      isToolUIPart(part) &&
      part.type === "tool-propose_patches" &&
      part.state === "output-available"
  )
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
