import type { AgentRun } from "../domain/suggestion"
import type {
  AgentRunRepository,
  FinishAgentRun,
  NewAgentRun,
} from "../ports/agent-run-repository"
import type { InMemoryDb } from "./db"

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
      status: "running",
    }
    this.db.runs.push(run)
    return run
  }

  async findById(id: string): Promise<AgentRun | null> {
    return this.db.runs.find((r) => r.id === id) ?? null
  }

  async finish(id: string, input: FinishAgentRun): Promise<void> {
    const run = this.db.runs.find((r) => r.id === id)
    if (run) run.status = input.status
  }
}
