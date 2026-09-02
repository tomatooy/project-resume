import type { AgentRun, AgentRunStatus } from "../domain/suggestion"

export type NewAgentRun = {
  conversationId: string
  resumeId: string
  skillId: string
  model: string
  selectedNodeId?: string | null
  resumeVersionId?: string | null
}

export type FinishAgentRun = {
  status: AgentRunStatus
  errorClass?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number | null
}

export interface AgentRunRepository {
  create(input: NewAgentRun): Promise<AgentRun>
  findById(id: string): Promise<AgentRun | null>
  finish(id: string, input: FinishAgentRun): Promise<void>
}
