import {
  checkFitAnswer,
  checkFitState,
  fromUIMessage,
  type Models,
  parseUIMessages,
  type ResumeSkill,
  type SkillContext,
  skills,
  startTurn as startModelTurn,
  toModelMessages,
} from "@workspace/agent"
import {
  type AgentRun,
  AppError,
  type Background,
  type ChatMessage,
  isSkillId,
  type MessageMetadata,
  SKILL,
} from "@workspace/resume-core"
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

    // RLS makes both of these the ownership check: a resume that is not the
    // caller's reads as missing, and a conversation id that does not belong
    // to this resume is refused the same way.
    const record = await services.resumes.get(body.resumeId)
    const conversation = await services.memory.openConversation(body.resumeId)
    if (conversation.id !== body.conversationId) {
      throw new AppError("NOT_FOUND", "Not found")
    }

    const turn =
      last.role === "user"
        ? await startTurn(deps, body, messages, last)
        : await continueTurn(deps, body, messages, last)

    return stream(deps, request, {
      ...turn,
      ctx: { ...turn.ctx, resume: record.data },
      originalMessages: messages,
    })
  } catch (error) {
    return errorResponse(error, log)
  }
}

type Turn = {
  run: AgentRun
  skill: ResumeSkill
  ctx: Omit<SkillContext, "resume">
  summaryText: string | null
  modelMessages: ModelMessage[]
}

/** A user message: check the skill, open a run, store the message. */
async function startTurn(
  deps: ChatDeps,
  body: ChatRequest,
  messages: UIMessage[],
  last: UIMessage
): Promise<Turn> {
  const { services, models } = deps
  const skill = resolveSkill(body)
  const userMessage = textOf(last)
  if (userMessage.length === 0) {
    throw new AppError("VALIDATION", "The message is empty")
  }

  await services.runs.assertWithinHourlyLimit()
  await supersedeStalledRun(deps, body.conversationId, messages)

  const input = {
    jobDescription: body.jobDescription || undefined,
    targetPages: body.targetPages,
  }
  const run = await services.runs.start({
    conversationId: body.conversationId,
    resumeId: body.resumeId,
    skillId: skill.id,
    model: models.ids.smart,
    selectedNodeId: body.selectedNodeId ?? null,
    input,
  })

  const metadata: MessageMetadata = { skillId: skill.id }
  if (body.selectedNodeId) metadata.selectedNodeId = body.selectedNodeId
  if (input.targetPages !== undefined) metadata.targetPages = input.targetPages

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
    skill,
    ctx: {
      userMessage,
      selectedNodeId: body.selectedNodeId ?? undefined,
      jobDescription: input.jobDescription,
      targetPages: input.targetPages,
    },
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
 * The browser answered a `check_fit` call. The run is still open, so the
 * model gets its own turn back with the result attached and carries on.
 */
async function continueTurn(
  deps: ChatDeps,
  body: ChatRequest,
  messages: UIMessage[],
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
  if (!isSkillId(run.skillId)) {
    throw new AppError(
      "CONFLICT",
      "That request used a skill this release lacks"
    )
  }

  const memory = await services.memory.buildContext(body.conversationId)
  const tail = await checkFitAnswer(last)
  return {
    run,
    skill: skills[run.skillId],
    ctx: {
      userMessage: lastUserText(messages),
      selectedNodeId: run.selectedNodeId ?? undefined,
      jobDescription: run.input.jobDescription,
      targetPages: run.input.targetPages,
    },
    summaryText: memory.summaryText,
    modelMessages: [...toModelMessages(memory.messages), ...tail],
  }
}

/**
 * Hands the turn to `packages/agent`; what happens once it ends is the run
 * lifecycle's.
 */
function stream(
  deps: ChatDeps,
  request: Request,
  turn: Turn & { ctx: SkillContext; originalMessages: UIMessage[] }
): Response {
  const { services, models, now } = deps
  const { run, skill } = turn
  const startedAt = now().getTime()

  const metadata: MessageMetadata = { skillId: skill.id }
  if (turn.ctx.selectedNodeId) metadata.selectedNodeId = turn.ctx.selectedNodeId
  if (turn.ctx.targetPages !== undefined) {
    metadata.targetPages = turn.ctx.targetPages
  }

  return startModelTurn({
    skill,
    ctx: turn.ctx,
    models,
    runId: run.id,
    memory: { summaryText: turn.summaryText, messages: turn.modelMessages },
    persist: async (valid) => {
      const saved = await services.suggestions.persistProposal(run.id, valid)
      return saved.map(({ id, ordinal, patch }) => ({ id, ordinal, patch }))
    },
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

/** Registered, shipped, and given what it needs; anything else is a 400. */
function resolveSkill(body: ChatRequest): ResumeSkill {
  if (!isSkillId(body.skillId)) {
    throw new AppError("VALIDATION", "Unknown skill")
  }
  const spec = SKILL[body.skillId]
  if (spec.status !== "mvp") {
    throw new AppError("VALIDATION", "This skill is not available yet")
  }
  for (const requirement of spec.requires) {
    if (requirement === "jobDescription" && !body.jobDescription) {
      throw new AppError("VALIDATION", "This skill needs a job description")
    }
    if (requirement === "targetPages" && body.targetPages === undefined) {
      throw new AppError("VALIDATION", "This skill needs a page target")
    }
  }
  return skills[spec.id]
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

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === "user") return textOf(message)
  }
  return ""
}
