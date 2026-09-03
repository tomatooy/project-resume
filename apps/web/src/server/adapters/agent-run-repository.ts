import {
  type AgentRun,
  type AgentRunRepository,
  type FinishAgentRun,
  type NewAgentRun,
  RunInputSchema,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"
import type { Database } from "@workspace/supabase"
import { toJson } from "./json"

type Row = Database["public"]["Tables"]["agent_runs"]["Row"]
type RunRow = Omit<Row, "finished_at">

const RUN_COLUMNS =
  "id, conversation_id, resume_id, resume_version_id, skill_id, model, selected_node_id, input, status, error_class, input_tokens, output_tokens, latency_ms, created_at"

function toRun(row: RunRow): AgentRun {
  const input = RunInputSchema.safeParse(row.input)
  return {
    id: row.id,
    conversationId: row.conversation_id,
    resumeId: row.resume_id,
    skillId: row.skill_id,
    model: row.model,
    selectedNodeId: row.selected_node_id,
    resumeVersionId: row.resume_version_id,
    input: input.success ? input.data : {},
    status: row.status,
    errorClass: row.error_class,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
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
        input: toJson(input.input ?? {}),
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

  async findRunning(conversationId: string): Promise<AgentRun | null> {
    const { data, error } = await this.db
      .from("agent_runs")
      .select(RUN_COLUMNS)
      .eq("conversation_id", conversationId)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? toRun(data) : null
  }

  async failAbandoned(
    conversationId: string,
    olderThan: Date
  ): Promise<number> {
    const { data, error } = await this.db
      .from("agent_runs")
      .update({
        status: "failed",
        error_class: "abandoned",
        input: {},
        finished_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId)
      .eq("status", "running")
      .lt("created_at", olderThan.toISOString())
      .select("id")
    if (error) throw error
    return data.length
  }

  /**
   * No user filter in the query: RLS already narrows `agent_runs` to the
   * caller's resumes, which is exactly the population the hourly limit counts.
   */
  async createdSince(since: Date): Promise<string[]> {
    const { data, error } = await this.db
      .from("agent_runs")
      .select("created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
    if (error) throw error
    return data.map((row) => row.created_at)
  }
}
