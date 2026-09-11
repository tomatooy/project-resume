import {
  type AgentRun,
  type AgentRunRepository,
  type FinishAgentRun,
  type NewAgentRun,
  RunInputSchema,
  type TurnPlan,
  TurnPlanSchema,
} from "@workspace/resume-core"

import type { Database } from "@workspace/supabase"
import type { Db } from "../auth/supabase"
import { toJson } from "./json"

type Row = Database["public"]["Tables"]["agent_runs"]["Row"]
type RunRow = Omit<Row, "finished_at">

const RUN_COLUMNS =
  "id, conversation_id, resume_id, resume_version_id, hint_skill_id, model, selected_node_id, input, status, error_class, input_tokens, output_tokens, latency_ms, created_at, plan, skill_ids, structural, budget_exhausted"

function toRun(row: RunRow): AgentRun {
  const input = RunInputSchema.safeParse(row.input)
  const plan = TurnPlanSchema.safeParse(row.plan)
  return {
    id: row.id,
    conversationId: row.conversation_id,
    resumeId: row.resume_id,
    hintSkillId: row.hint_skill_id,
    model: row.model,
    selectedNodeId: row.selected_node_id,
    resumeVersionId: row.resume_version_id,
    // A row written before the plan existed parses as absent, not as an error.
    plan: plan.success ? plan.data : null,
    skillIds: row.skill_ids ?? [],
    structural: row.structural,
    budgetExhausted: row.budget_exhausted,
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
        hint_skill_id: input.hintSkillId ?? null,
        model: input.model,
        selected_node_id: input.selectedNodeId ?? null,
        resume_version_id: input.resumeVersionId ?? null,
        structural: input.structural ?? false,
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
        budget_exhausted: input.budgetExhausted ?? false,
        input: {},
        finished_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) throw error
  }

  async recordPlan(id: string, plan: TurnPlan): Promise<void> {
    const { error } = await this.db
      .from("agent_runs")
      .update({ plan: toJson(plan) })
      .eq("id", id)
    if (error) throw error
  }

  /**
   * Read-modify-write rather than a SQL array union: one run streams at a time
   * per conversation, so there is no writer to race, and the read is one cheap
   * primary-key select on a table RLS already scopes.
   */
  async addSkill(id: string, skillId: string): Promise<void> {
    const run = await this.findById(id)
    if (!run || run.skillIds.includes(skillId)) return
    const { error } = await this.db
      .from("agent_runs")
      .update({ skill_ids: [...run.skillIds, skillId] })
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
