import {
  MemorySummarySchema,
  type NewSummary,
  type SummaryRecord,
  type SummaryRepository,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"
import type { Database } from "@workspace/supabase"
import { toJson } from "./json"

type Row = Database["public"]["Tables"]["memory_summaries"]["Row"]

function toRecord(row: Row): SummaryRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    // Parsed, not cast: the summary is fed back to the model as its previous
    // memory, and a malformed one should fail here rather than in a prompt.
    summary: MemorySummarySchema.parse(row.summary),
    summaryText: row.summary_text,
    sourceFromSeq: row.source_from_seq,
    sourceToSeq: row.source_to_seq,
    model: row.model,
    createdAt: row.created_at,
  }
}

export class SupabaseSummaryRepository implements SummaryRepository {
  constructor(private readonly db: Db) {}

  /**
   * Follows `conversations.active_summary_id` rather than taking the newest
   * row. The pointer is what `create_memory_summary` moves, so it is the one
   * definition of "active".
   */
  async findActive(conversationId: string): Promise<SummaryRecord | null> {
    const { data: conversation, error } = await this.db
      .from("conversations")
      .select("active_summary_id")
      .eq("id", conversationId)
      .maybeSingle()
    if (error) throw error
    if (!conversation?.active_summary_id) return null

    const { data, error: summaryError } = await this.db
      .from("memory_summaries")
      .select("*")
      .eq("id", conversation.active_summary_id)
      .maybeSingle()
    if (summaryError) throw summaryError
    return data ? toRecord(data) : null
  }

  async create(
    conversationId: string,
    summary: NewSummary
  ): Promise<SummaryRecord> {
    const { data, error } = await this.db.rpc("create_memory_summary", {
      p_conversation_id: conversationId,
      p_summary: toJson(summary.summary),
      p_summary_text: summary.summaryText,
      p_from_seq: summary.sourceFromSeq,
      p_to_seq: summary.sourceToSeq,
      p_model: summary.model,
    })
    if (error) throw error
    return toRecord(data)
  }
}
