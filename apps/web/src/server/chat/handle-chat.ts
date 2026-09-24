import {
  checkFitAnswer,
  checkFitState,
  fromUIMessage,
  type Models,
  parseUIMessages,
  resolveSkills,
  type Skill,
  startTurn as startModelTurn,
  type TurnState,
  toModelMessages,
} from "@workspace/agent"
import {
  type AgentRun,
  AppError,
  type Background,
  type ChatMessage,
  type MessageMetadata,
} from "@workspace/resume-core"
import type { Resume } from "@workspace/resume-schema"
import type { ModelMessage, UIMessage } from "ai"

import type { Services } from "../container"
import { errorResponse, parseRequest } from "../errors"
import type { Logger } from "../log"
import { type ChatRequest, ChatRequestSchema } from "./contract"
import { settleRun } from "./run-lifecycle"

export type ChatDeps = {
  services: Services
  models: Models
  background: Background
  log: Logger
  now: () => Date
}

/** Longer than any run should take; shorter than the platform's own cutoff. */
export const RUN_TIMEOUT_MS = 90_000

export async function handleChat(
  deps: ChatDeps,
  request: Request
): Promise<Response> {
  const { services, log } = deps
  try {
    const body = parseRequest(ChatRequestSchema, await request.json())
    const messages = await parseUIMessages(body.messages)
    const last = messages[messages.length - 1]
    if (!last) throw new AppError("VALIDATION", "No message to answer")

    // RLS makes all three of these the ownership check: a resume that is not
    // the caller's reads as missing, a conversation id that does not belong
    // to this resume is refused the same way, and the overlay is that user's
    // own rows. The library is resolved once per request, from the same read
    // the prompt and the tools share.
    const [record, conversation, overlay] = await Promise.all([
      services.resumes.get(body.resumeId),
      services.memory.openConversation(body.resumeId),
      services.skills.listOverlay(),
    ])
    if (conversation.id !== body.conversationId) {
      throw new AppError("NOT_FOUND", "Not found")
    }

    const turn =
      last.role === "user"
        ? await openTurn(deps, body, messages, last)
        : await continueTurn(deps, body, last)

    if (request.signal.aborted) {
      await services.runs.cancel(turn.run.id)
      return new Response(null, { status: 499 })
    }
    return stream(deps, request, {
      ...turn,
      resume: record.data,
      // A `check_fit` continuation re-reads the library, so an edit made
      // between the two halves shifts the index for the second half. Harmless:
      // loaded bodies are not carried across the pause anyway.
      skills: resolveSkills(overlay),
      originalMessages: messages,
    })
  } catch (error) {
    return errorResponse(error, log)
  }
}

type Turn = {
  run: AgentRun
  /** What the tools agree on for this turn. */
  state: TurnState
  /** Stamped on the user message and on the assistant message it opens. */
  metadata: MessageMetadata
  summaryText: string | null
  modelMessages: ModelMessage[]
}

/** A user message: open a run, store the message, build the prompt window. */
async function openTurn(
  deps: ChatDeps,
  body: ChatRequest,
  messages: UIMessage[],
  last: UIMessage
): Promise<Turn> {
  const { services, models } = deps
  const userMessage = textOf(last)
  if (userMessage.length === 0) {
    throw new AppError("VALIDATION", "The message is empty")
  }

  await services.runs.assertWithinHourlyLimit()
  await supersedeStalledRun(deps, body.conversationId, messages)

  const structural = body.structural ?? false
  const run = await services.runs.start({
    conversationId: body.conversationId,
    resumeId: body.resumeId,
    hintSkillId: body.hintSkillId ?? null,
    model: models.ids.smart,
    selectedNodeId: body.selectedNodeId ?? null,
    structural,
    input: {},
  })

  const metadata = metadataFor({
    hintSkillId: body.hintSkillId,
    selectedNodeId: body.selectedNodeId,
    structural,
  })

  const memory = await services.memory.buildContext(body.conversationId)
  const replay =
    body.trigger === "regenerate-message"
      ? windowEndingAt(memory.messages, userMessage)
      : null
  if (replay === null) {
    await services.memory.record(
      fromUIMessage(last, {
        conversationId: body.conversationId,
        agentRunId: run.id,
        metadata,
      })
    )
  }

  // Either way the window ends with the turn being answered: the stored one
  // when it was already there, and the one just taken when it was not.
  const modelMessages: ModelMessage[] = replay
    ? toModelMessages(replay)
    : [
        ...toModelMessages(memory.messages),
        { role: "user", content: userMessage },
      ]

  return {
    run,
    state: {
      loadedSkillIds: [],
      selectedNodeId: body.selectedNodeId ?? undefined,
      hintSkillId: body.hintSkillId ?? undefined,
      allowStructural: structural,
    },
    metadata: { ...metadata, runId: run.id },
    summaryText: memory.summaryText,
    modelMessages,
  }
}

/**
 * A regenerate re-posts a user turn the store already took, so neither the
 * transcript nor the prompt may take it twice: stored twice it is replayed to
 * the model twice, summarised twice, and shown twice on reload. The window is
 * cut back to that turn instead, which also drops the answer the browser
 * itself dropped when it asked for another one.
 *
 * Null when the newest stored user turn is not this one, which is a
 * regenerate of a message that never landed; the caller stores it as usual.
 */
function windowEndingAt(
  messages: ChatMessage[],
  userMessage: string
): ChatMessage[] | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== "user") continue
    return storedText(message) === userMessage ? messages.slice(0, i + 1) : null
  }
  return null
}

/**
 * The browser answered a `check_fit` call. The run is still open, so the model
 * gets its own turn back with the result attached and carries on.
 *
 * The state is rebuilt from the run row and the request, not carried over:
 * nothing about the first half is remembered except what the row holds, so a
 * continuation cannot be left in a half-primed stage. `loadedSkillIds` starts
 * empty on purpose: the loaded bodies were never part of the compacted
 * transcript, so a playbook has to be loadable again to be usable again.
 */
async function continueTurn(
  deps: ChatDeps,
  body: ChatRequest,
  last: UIMessage
): Promise<Turn> {
  const { services } = deps
  if (checkFitState(last) !== "answered") {
    throw new AppError("VALIDATION", "Nothing to continue from")
  }

  const run = await services.runs.findRunning(body.conversationId)
  if (!run) {
    throw new AppError(
      "CONFLICT",
      "That request has already ended. Send your message again."
    )
  }

  const metadata = last.metadata
  if (
    metadata &&
    typeof metadata === "object" &&
    "runId" in metadata &&
    metadata.runId !== run.id
  ) {
    throw new AppError("CONFLICT", "That request has already ended.")
  }

  const memory = await services.memory.buildContext(body.conversationId)
  const tail = await checkFitAnswer(last)
  return {
    run,
    state: {
      loadedSkillIds: [],
      selectedNodeId: run.selectedNodeId ?? undefined,
      hintSkillId: run.hintSkillId ?? undefined,
      allowStructural: run.structural,
    },
    metadata: { ...metadataFor(run), runId: run.id },
    summaryText: memory.summaryText,
    modelMessages: [...toModelMessages(memory.messages), ...tail],
  }
}

/** What the message rows and the panel read back about the request. */
function metadataFor(facts: {
  hintSkillId?: string | null
  selectedNodeId?: string | null
  structural: boolean
}): MessageMetadata {
  const metadata: MessageMetadata = {}
  if (facts.hintSkillId) metadata.hintSkillId = facts.hintSkillId
  if (facts.selectedNodeId) metadata.selectedNodeId = facts.selectedNodeId
  if (facts.structural) metadata.structural = true
  return metadata
}

/**
 * Hands the turn to `packages/agent`; what happens once it ends is the run
 * lifecycle's.
 */
function stream(
  deps: ChatDeps,
  request: Request,
  turn: Turn & {
    resume: Resume
    skills: readonly Skill[]
    originalMessages: UIMessage[]
  }
): Response {
  const { services, models, now } = deps
  const { run, state, metadata } = turn
  const startedAt = now().getTime()

  return startModelTurn({
    state,
    resume: turn.resume,
    skills: turn.skills,
    models,
    runId: run.id,
    memory: { summaryText: turn.summaryText, messages: turn.modelMessages },
    persist: async (valid) => {
      const saved = await services.suggestions.persistProposal(run.id, valid)
      return saved.map(({ id, ordinal, patch }) => ({ id, ordinal, patch }))
    },
    recordPlan: (plan) => services.runs.recordPlan(run.id, plan),
    addSkill: (id) => services.runs.addSkill(run.id, id),
    originalMessages: turn.originalMessages,
    metadata,
    abortSignal: AbortSignal.any([
      request.signal,
      AbortSignal.timeout(RUN_TIMEOUT_MS),
    ]),
    onSettled: (outcome) =>
      settleRun(
        deps,
        { run, model: models.ids.smart, metadata, startedAt },
        outcome
      ),
  })
}

/**
 * A run paused on `check_fit` stays open until the browser answers. If the
 * user moved on instead, their next message would hit the "still working"
 * conflict for ten minutes, so a new turn closes a run whose only remaining
 * work was that answer. A run that is genuinely streaming has no such part in
 * the messages this browser holds, and keeps its conflict.
 */
async function supersedeStalledRun(
  deps: ChatDeps,
  conversationId: string,
  messages: UIMessage[]
): Promise<void> {
  const previous = messages[messages.length - 2]
  if (previous?.role !== "assistant") return
  if (checkFitState(previous) !== "awaiting") return

  const running = await deps.services.runs.findRunning(conversationId)
  if (!running) return
  await deps.services.runs.finish(running.id, {
    status: "cancelled",
    errorClass: "superseded",
  })
  deps.log.info("chat_superseded", { runId: running.id })
}

/** The text of a stored message, as `textOf` reads an incoming one. */
function storedText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}
