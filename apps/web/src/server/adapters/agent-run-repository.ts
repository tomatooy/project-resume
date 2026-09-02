import type {
  AgentRun,
  AgentRunRepository,
  FinishAgentRun,
  NewAgentRun,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"
import type { Database } from "@workspace/supabase"

type Row = Database["public"]["Tables"]["agent_runs"]["Row"]
type RunRow = Pick<
  Row,
  | "id"
  | "conversation_id"
  | "resume_id"
  | "skill_id"
  | "model"
  | "selected_node_id"
  | "status"
>

const RUN_COLUMNS =
  "id, conversation_id, resume_id, skill_id, model, selected_node_id, status"

function toRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    resumeId: row.resume_id,
    skillId: row.skill_id,
    model: row.model,
    selectedNodeId: row.selected_node_id,
    status: row.status,
  }
}

export class SupabaseAgentRunRepository implements AgentRunRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewAgentRun): Promise<AgentRun> {
    const { data, error } = await this.db
      .from("agent_runs")
      .insert({
        conversation_id: input.conversationId,
        resume_id: input.resumeId,
        skill_id: input.skillId,
        model: input.model,
        selected_node_id: input.selectedNodeId ?? null,
        resume_version_id: input.resumeVersionId ?? null,
      })
      .select(RUN_COLUMNS)
      .single()
    if (error) throw error
    return toRun(data)
  }

  async findById(id: string): Promise<AgentRun | null> {
    const { data, error } = await this.db
      .from("agent_runs")
      .select(RUN_COLUMNS)
      .eq("id", id)
      .maybeSingle()
    if (error) throw error
    return data ? toRun(data) : null
  }

  /**
   * `input` holds the job description the run was given. It is cleared here
   * rather than kept, so a finished run retains no copy of what the user pasted
   * into it.
   */
  async finish(id: string, input: FinishAgentRun): Promise<void> {
    const { error } = await this.db
      .from("agent_runs")
      .update({
        status: input.status,
        error_class: input.errorClass ?? null,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        latency_ms: input.latencyMs ?? null,
        input: {},
        finished_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) throw error
  }
}
