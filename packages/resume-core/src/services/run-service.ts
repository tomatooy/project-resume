import { AppError } from "../domain/errors"
import type { AgentRun, RunInput } from "../domain/suggestion"
import type {
  AgentRunRepository,
  FinishAgentRun,
} from "../ports/agent-run-repository"
import type { VersionService } from "./version-service"

export type StartRunInput = {
  conversationId: string
  resumeId: string
  skillId: string
  model: string
  selectedNodeId?: string | null
  input: RunInput
}

/** A run still `running` after this long was never going to finish. */
const ABANDONED_AFTER_MS = 10 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
export const DEFAULT_HOURLY_LIMIT = 60

export class RunService {
  constructor(
    private readonly versions: VersionService,
    private readonly runs: AgentRunRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /**
   * Snapshots the head first so every proposal is made against an immutable
   * version, then records the run. The snapshot dedupes in the database, so
   * back-to-back runs with no edit between them share one "Before AI run".
   */
  async start(input: StartRunInput): Promise<AgentRun> {
    const now = this.clock()
    await this.runs.failAbandoned(
      input.conversationId,
      new Date(now.getTime() - ABANDONED_AFTER_MS)
    )
    if (await this.runs.findRunning(input.conversationId)) {
      throw new AppError(
        "CONFLICT",
        "The assistant is still working on the previous request"
      )
    }

    const version = await this.versions.snapshot(input.resumeId, {
      label: "Before AI run",
      createdBy: "system",
    })

    return this.runs.create({
      conversationId: input.conversationId,
      resumeId: input.resumeId,
      skillId: input.skillId,
      model: input.model,
      selectedNodeId: input.selectedNodeId ?? null,
      resumeVersionId: version.id,
      input: input.input,
    })
  }

  findRunning(conversationId: string): Promise<AgentRun | null> {
    return this.runs.findRunning(conversationId)
  }

  /**
   * A run against a resume that is being created rather than edited.
   *
   * No "Before AI run" snapshot, because there is no earlier state worth
   * restoring: the head is the untouched duplicate, and this flow writes
   * exactly one version whether the model succeeds or not. No running-run
   * check either, because the conversation was opened one line ago.
   */
  startForCreation(input: StartRunInput): Promise<AgentRun> {
    return this.runs.create({
      conversationId: input.conversationId,
      resumeId: input.resumeId,
      skillId: input.skillId,
      model: input.model,
      selectedNodeId: input.selectedNodeId ?? null,
      resumeVersionId: null,
      input: input.input,
    })
  }

  finish(runId: string, input: FinishAgentRun): Promise<void> {
    return this.runs.finish(runId, input)
  }

  /**
   * Counts this user's runs in the trailing hour. The repository query runs
   * under RLS, which is what scopes it to the user without a user_id column.
   */
  async assertWithinHourlyLimit(limit = DEFAULT_HOURLY_LIMIT): Promise<void> {
    const now = this.clock()
    const recent = await this.runs.createdSince(
      new Date(now.getTime() - HOUR_MS)
    )
    if (recent.length < limit) return

    const oldest = recent[0]
    const resetAt = oldest
      ? new Date(oldest).getTime() + HOUR_MS
      : now.getTime() + HOUR_MS
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetAt - now.getTime()) / 1000)
    )
    throw new AppError(
      "RATE_LIMITED",
      "You have reached the hourly AI limit",
      undefined,
      retryAfterSeconds
    )
  }
}
