import type { TurnPlan } from "../domain/chat"
import type { AgentRun, AgentRunStatus, RunInput } from "../domain/suggestion"

export type NewAgentRun = {
  conversationId: string
  resumeId: string
  /** The composer's hint, or the tailoring writer's id. Advisory. */
  hintSkillId?: string | null
  model: string
  selectedNodeId?: string | null
  resumeVersionId?: string | null
  /** The user enabled removing and restructuring for this turn. */
  structural?: boolean
  input?: RunInput
}

export type FinishAgentRun = {
  status: AgentRunStatus
  errorClass?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number | null
  /** The step budget ran out with no proposal. */
  budgetExhausted?: boolean
}

export interface AgentRunRepository {
  create(input: NewAgentRun): Promise<AgentRun>
  findById(id: string): Promise<AgentRun | null>
  /** Also clears `input`, so a finished run retains no job description. */
  finish(id: string, input: FinishAgentRun): Promise<void>
  /** Records the line the model planned with; a later call replaces it. */
  recordPlan(id: string, plan: TurnPlan): Promise<void>
  /**
   * Appends a playbook the turn loaded, once. Idempotent, because the model
   * may load the same playbook twice and a reload must not double-count.
   */
  addSkill(id: string, skillId: string): Promise<void>
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
