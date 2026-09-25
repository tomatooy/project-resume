import { AppError } from "../domain/errors"
import type { TurnPlan } from "../domain/chat"
import type { AgentRun, RunInput } from "../domain/suggestion"
import type {
  AgentRunRepository,
  FinishAgentRun,
} from "../ports/agent-run-repository"
import type { VersionService } from "./version-service"

export type StartRunInput = {
  conversationId: string
  resumeId: string
  /** The composer's hint, or the tailoring writer's id. Advisory. */
  hintSkillId?: string | null
  model: string
  selectedNodeId?: string | null
  /** The user enabled removing and restructuring for this turn. */
  structural?: boolean
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
      hintSkillId: input.hintSkillId ?? null,
      model: input.model,
      selectedNodeId: input.selectedNodeId ?? null,
      resumeVersionId: version.id,
      structural: input.structural ?? false,
      input: input.input,
    })
  }

  findRunning(conversationId: string): Promise<AgentRun | null> {
    return this.runs.findRunning(conversationId)
  }

  async cancel(runId: string): Promise<void> {
    const run = await this.runs.findById(runId)
    if (!run) throw new AppError("NOT_FOUND", "Run not found")
    if (run.status !== "running") return
    await this.runs.finish(runId, {
      status: "cancelled",
      errorClass: "stopped",
    })
  }

  /**
   * Closes the one run a conversation may have open. Clearing the transcript
   * does this first: a run left `running` refuses the next turn with CONFLICT
   * until `failAbandoned` gives up on it ten minutes later.
   */
  async cancelRunning(
    conversationId: string,
    errorClass: string
  ): Promise<void> {
    const running = await this.runs.findRunning(conversationId)
    if (!running) return
    await this.runs.finish(running.id, { status: "cancelled", errorClass })
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
      hintSkillId: input.hintSkillId ?? null,
      model: input.model,
      selectedNodeId: input.selectedNodeId ?? null,
      resumeVersionId: null,
      structural: input.structural ?? false,
      input: input.input,
    })
  }

  finish(runId: string, input: FinishAgentRun): Promise<void> {
    return this.runs.finish(runId, input)
  }

  /** The line the turn is working to, recorded for the panel and the record. */
  recordPlan(runId: string, plan: TurnPlan): Promise<void> {
    return this.runs.recordPlan(runId, plan)
  }

  /** Appends a loaded playbook. Telemetry and the panel's chips. */
  addSkill(runId: string, skillId: string): Promise<void> {
    return this.runs.addSkill(runId, skillId)
  }

  /**
   * Counts this user's runs in the trailing hour. The repository query runs
   * under RLS, which is what scopes it to the user without a user_id column.
   */
  async assertWithinHourlyLimit(limit = DEFAULT_HOURLY_LIMIT): Promise<void> {
    const now = this.clock()
    const recent = await this.runs.usageSince(new Date(now.getTime() - HOUR_MS))
    if (recent.count < limit) return

    const oldest = recent.oldest
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
