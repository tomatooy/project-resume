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
  isSkillId,
  type MessageMetadata,
  SKILL_REQUIRES,
  SKILL_STATUS,
  type SkillId,
} from "@workspace/resume-core"
import type { ModelMessage, UIMessage } from "ai"
import { z } from "zod"

import type { Services } from "../container"
import { errorClassOf, type Logger } from "../log"
import { errorResponse } from "./errors"

export type ChatDeps = {
  services: Services
  models: Models
  background: Background
  log: Logger
  now: () => Date
}

/**
 * What `useChat` posts: its own envelope plus the fields the panel adds. The
 * skill inputs travel with every request, but only a new turn reads them; a
 * continuation takes them from the run it belongs to.
 */
const ChatRequestSchema = z.object({
  id: z.string().optional(),
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  messages: z.array(z.unknown()).min(1),
  conversationId: z.uuid(),
  resumeId: z.uuid(),
  skillId: z.string().optional(),
  selectedNodeId: z.string().nullable().optional(),
  jobDescription: z.string().trim().max(20_000).optional(),
  targetPages: z.number().int().min(1).max(4).optional(),
})
type ChatRequest = z.infer<typeof ChatRequestSchema>

/** Longer than any run should take; shorter than the platform's own cutoff. */
export const RUN_TIMEOUT_MS = 90_000

export async function handleChat(
  deps: ChatDeps,
  request: Request
): Promise<Response> {
  const { services, log } = deps
  try {
    const body = ChatRequestSchema.parse(await request.json())
    const messages = await parseUIMessages(body.messages)
    const last = messages[messages.length - 1]
    if (!last) throw new AppError("VALIDATION", "No message to answer")

    // RLS makes both of these the ownership check: a resume that is not the
    // caller's reads as missing, and a conversation id that does not belong
    // to this resume is refused the same way.
    const record = await services.resumes.get(body.resumeId)
    const conversation = await services.conversations.getOrCreate(body.resumeId)
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
  await services.messages.append(
    fromUIMessage(last, {
      conversationId: body.conversationId,
      agentRunId: run.id,
      metadata,
    })
  )

  const memory = await services.memory.buildContext(body.conversationId)
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
    modelMessages: toModelMessages(memory.messages),
  }
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
 * Hands the turn to `packages/agent` and says what to do with how it ended.
 * Everything left here is the app's: the run row, the transcript, the log and
 * the follow-on consolidation.
 */
function stream(
  deps: ChatDeps,
  request: Request,
  turn: Turn & { ctx: SkillContext; originalMessages: UIMessage[] }
): Response {
  const { services, models, background, log, now } = deps
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
    onSettled: async ({ status, usage, message, error }) => {
      // A paused turn leaves the run open: the browser still owes the
      // `check_fit` answer that resumes it.
      if (status === "paused") {
        log.info("chat_paused", { runId: run.id, steps: usage.steps })
        return
      }

      const errorClass =
        status === "failed"
          ? errorClassOf(error)
          : status === "cancelled"
            ? "aborted"
            : undefined
      if (status === "failed") {
        log.error("chat_stream_error", { runId: run.id, errorClass })
      }

      try {
        await services.messages.append(
          fromUIMessage(message, {
            conversationId: run.conversationId,
            agentRunId: run.id,
            metadata:
              status === "cancelled"
                ? { ...metadata, stopped: true }
                : metadata,
          })
        )
        await services.runs.finish(run.id, {
          status,
          errorClass,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: now().getTime() - startedAt,
        })
      } catch (failure) {
        log.error("chat_finish_failed", {
          runId: run.id,
          errorClass: errorClassOf(failure),
        })
      }
      log.info("chat_finished", {
        runId: run.id,
        skillId: skill.id,
        model: models.ids.smart,
        outcome: status,
        errorClass,
        steps: usage.steps,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: now().getTime() - startedAt,
      })

      background.run(async () => {
        const result = await services.memory.maybeConsolidate(
          run.conversationId
        )
        log.info("memory_consolidation", {
          conversationId: run.conversationId,
          outcome: result,
        })
      })
    },
  })
}

/** Registered, shipped, and given what it needs; anything else is a 400. */
function resolveSkill(body: ChatRequest): ResumeSkill {
  if (!isSkillId(body.skillId)) {
    throw new AppError("VALIDATION", "Unknown skill")
  }
  const id: SkillId = body.skillId
  if (SKILL_STATUS[id] !== "mvp") {
    throw new AppError("VALIDATION", "This skill is not available yet")
  }
  for (const requirement of SKILL_REQUIRES[id]) {
    if (requirement === "jobDescription" && !body.jobDescription) {
      throw new AppError("VALIDATION", "This skill needs a job description")
    }
    if (requirement === "targetPages" && body.targetPages === undefined) {
      throw new AppError("VALIDATION", "This skill needs a page target")
    }
  }
  return skills[id]
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
