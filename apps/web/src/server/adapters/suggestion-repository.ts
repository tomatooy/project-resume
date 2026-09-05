import { ResumePatchSchema } from "@workspace/resume-schema"
import type {
  DecideInput,
  DecideOutcome,
  NewSuggestion,
  Suggestion,
  SuggestionRepository,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"
import type { Database } from "@workspace/supabase"
import { toJson } from "./json"
import { decideResultSchema, toVersionSummary } from "./rpc"

type Row = Database["public"]["Tables"]["suggestions"]["Row"]
type SuggestionRow = Pick<
  Row,
  "id" | "agent_run_id" | "ordinal" | "patch" | "status"
>

const COLUMNS = "id, agent_run_id, ordinal, patch, status"

function toSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    runId: row.agent_run_id,
    ordinal: row.ordinal,
    // Parsed, not cast: the patch contract is enforced by resume-schema and a
    // stored patch that no longer satisfies it must not reach `applyPatches`.
    patch: ResumePatchSchema.parse(row.patch),
    status: row.status,
  }
}

export class SupabaseSuggestionRepository implements SuggestionRepository {
  constructor(private readonly db: Db) {}

  async insertMany(
    runId: string,
    resumeId: string,
    suggestions: NewSuggestion[]
  ): Promise<Suggestion[]> {
    if (suggestions.length === 0) return []

    const { data, error } = await this.db
      .from("suggestions")
      .insert(
        suggestions.map((suggestion) => ({
          agent_run_id: runId,
          resume_id: resumeId,
          ordinal: suggestion.ordinal,
          patch: toJson(suggestion.patch),
          target_node_id: suggestion.targetNodeId,
          operation: suggestion.patch.op,
        }))
      )
      .select(COLUMNS)
    if (error) throw error
    return data.map(toSuggestion)
  }

  async listForRun(runId: string): Promise<Suggestion[]> {
    const { data, error } = await this.db
      .from("suggestions")
      .select(COLUMNS)
      .eq("agent_run_id", runId)
      .order("ordinal", { ascending: true })
    if (error) throw error
    return data.map(toSuggestion)
  }

  async listForRuns(runIds: string[]): Promise<Suggestion[]> {
    if (runIds.length === 0) return []
    const { data, error } = await this.db
      .from("suggestions")
      .select(COLUMNS)
      .in("agent_run_id", runIds)
    if (error) throw error
    return data.map(toSuggestion)
  }

  /**
   * Recording the decisions and creating the resulting version are one call, so
   * a suggestion can never end up marked accepted with no version to show for
   * it. Patch application itself already happened in `SuggestionService`.
   */
  async decide(input: DecideInput): Promise<DecideOutcome> {
    const { data, error } = await this.db.rpc("decide_suggestions", {
      p_run_id: input.runId,
      p_decisions: toJson(input.decisions.map(toDecisionJson)),
      p_new_content: input.newContent ? toJson(input.newContent) : undefined,
      p_content_hash: input.contentHash ?? undefined,
    })
    if (error) throw error

    const result = decideResultSchema.parse(data)
    return {
      version: result.version ? toVersionSummary(result.version) : null,
      revision: result.revision,
      updatedAt: result.updated_at,
    }
  }
}

function toDecisionJson(decision: DecideInput["decisions"][number]) {
  return { suggestionId: decision.suggestionId, status: decision.status }
}
