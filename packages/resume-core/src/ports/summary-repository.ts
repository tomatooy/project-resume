import type { NewSummary, SummaryRecord } from "../domain/memory"

export interface SummaryRepository {
  /** The summary `conversations.active_summary_id` points at. */
  findActive(conversationId: string): Promise<SummaryRecord | null>
  /** Inserts and activates in one step, so a summary is never half-adopted. */
  create(conversationId: string, summary: NewSummary): Promise<SummaryRecord>
}
