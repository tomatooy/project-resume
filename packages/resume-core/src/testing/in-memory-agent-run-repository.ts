import type { AgentRun } from "../domain/suggestion"
import type {
  AgentRunRepository,
  FinishAgentRun,
  NewAgentRun,
} from "../ports/agent-run-repository"
import { type InMemoryDb, nowIso } from "./db"

export class InMemoryAgentRunRepository implements AgentRunRepository {
  constructor(private readonly db: InMemoryDb) {}

  async create(input: NewAgentRun): Promise<AgentRun> {
    const run: AgentRun = {
      id: this.db.uuid(),
      conversationId: input.conversationId,
      resumeId: input.resumeId,
      skillId: input.skillId,
      model: input.model,
      selectedNodeId: input.selectedNodeId ?? null,
      resumeVersionId: input.resumeVersionId ?? null,
      input: input.input ?? {},
      status: "running",
      errorClass: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      createdAt: nowIso(this.db),
    }
    this.db.runs.push(run)
    return run
  }

  async findById(id: string): Promise<AgentRun | null> {
    return this.db.runs.find((r) => r.id === id) ?? null
  }

  async finish(id: string, input: FinishAgentRun): Promise<void> {
    const run = this.db.runs.find((r) => r.id === id)
    if (!run) return
    run.status = input.status
    run.errorClass = input.errorClass ?? null
    run.inputTokens = input.inputTokens ?? null
    run.outputTokens = input.outputTokens ?? null
    run.latencyMs = input.latencyMs ?? null
    run.input = {}
  }

  async findRunning(conversationId: string): Promise<AgentRun | null> {
    return (
      this.db.runs.find(
        (r) => r.conversationId === conversationId && r.status === "running"
      ) ?? null
    )
  }

  async failAbandoned(
    conversationId: string,
    olderThan: Date
  ): Promise<number> {
    let count = 0
    for (const run of this.db.runs) {
      if (
        run.conversationId === conversationId &&
        run.status === "running" &&
        new Date(run.createdAt) < olderThan
      ) {
        run.status = "failed"
        run.errorClass = "abandoned"
        run.input = {}
        count += 1
      }
    }
    return count
  }

  async createdSince(since: Date): Promise<string[]> {
    return this.db.runs
      .map((r) => r.createdAt)
      .filter((at) => new Date(at) >= since)
      .sort()
  }
}
