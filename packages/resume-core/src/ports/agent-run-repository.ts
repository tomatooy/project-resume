import type { AgentRun, AgentRunStatus, RunInput } from "../domain/suggestion"

export type NewAgentRun = {
  conversationId: string
  resumeId: string
  skillId: string
  model: string
  selectedNodeId?: string | null
  resumeVersionId?: string | null
  input?: RunInput
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
  /** Also clears `input`, so a finished run retains no job description. */
  finish(id: string, input: FinishAgentRun): Promise<void>
  /** The one run with `status = 'running'` for this conversation, if any. */
  findRunning(conversationId: string): Promise<AgentRun | null>
  /**
   * Marks runs still `running` from before `olderThan` as failed with error
   * class `abandoned`. Returns how many. A tab closed mid-stream never
   * finishes its run; this is what stops it blocking the conversation.
   */
  failAbandoned(conversationId: string, olderThan: Date): Promise<number>
  /** `createdAt` of every run by this user since `since`, oldest first. */
  createdSince(since: Date): Promise<string[]>
}
