import { fromUIMessage, type TurnOutcome } from "@workspace/agent"
import type {
  AgentRun,
  Background,
  MessageMetadata,
} from "@workspace/resume-core"

import type { Services } from "../container"
import { errorClassOf, type Logger } from "../log"

export type RunLifecycleDeps = {
  services: Services
  background: Background
  log: Logger
  now: () => Date
}

/** The run the turn belongs to, and what every message it stores is stamped with. */
export type OpenRun = {
  run: AgentRun
  model: string
  metadata: MessageMetadata
  startedAt: number
}

/**
 * What the app does with a turn once `packages/agent` is done with it: the
 * transcript row, the run row, the log line, and the follow-on consolidation.
 * The model's stream has already been answered by the time this runs, so a
 * failure here is logged rather than raised; the user has their reply either
 * way, and the run row is what the next request checks.
 */
export async function settleRun(
  deps: RunLifecycleDeps,
  open: OpenRun,
  outcome: TurnOutcome
): Promise<void> {
  const { services, background, log, now } = deps
  const { run, metadata } = open
  const { status, usage } = outcome

  // A paused turn leaves the run open: the browser still owes the
  // `check_fit` answer that resumes it.
  if (status === "paused") {
    log.info("chat_paused", { runId: run.id, steps: usage.steps })
    return
  }

  const errorClass =
    status === "failed"
      ? errorClassOf(outcome.error)
      : status === "cancelled"
        ? "aborted"
        : undefined
  if (status === "failed") {
    log.error("chat_stream_error", { runId: run.id, errorClass })
  }

  const latencyMs = now().getTime() - open.startedAt
  try {
    await services.memory.record(
      fromUIMessage(outcome.message, {
        conversationId: run.conversationId,
        agentRunId: run.id,
        metadata:
          status === "cancelled" ? { ...metadata, stopped: true } : metadata,
      })
    )
    await services.runs.finish(run.id, {
      status,
      errorClass,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      budgetExhausted: outcome.budgetExhausted,
    })
  } catch (failure) {
    log.error("chat_finish_failed", {
      runId: run.id,
      errorClass: errorClassOf(failure),
    })
  }
  log.info("chat_finished", {
    runId: run.id,
    hintSkillId: run.hintSkillId ?? undefined,
    model: open.model,
    outcome: status,
    errorClass,
    structural: run.structural,
    budgetExhausted: outcome.budgetExhausted,
    steps: usage.steps,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs,
  })

  background.run(async () => {
    const result = await services.memory.maybeConsolidate(run.conversationId)
    log.info("memory_consolidation", {
      conversationId: run.conversationId,
      outcome: result,
    })
  })
}
