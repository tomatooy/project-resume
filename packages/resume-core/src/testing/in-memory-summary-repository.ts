import type { NewSummary, SummaryRecord } from "../domain/memory"
import type { SummaryRepository } from "../ports/summary-repository"
import { type InMemoryDb, nowIso } from "./db"

export class InMemorySummaryRepository implements SummaryRepository {
  constructor(private readonly db: InMemoryDb) {}

  async findActive(conversationId: string): Promise<SummaryRecord | null> {
    const id = this.db.activeSummaries.get(conversationId)
    if (!id) return null
    return this.db.summaries.find((s) => s.id === id) ?? null
  }

  async create(
    conversationId: string,
    summary: NewSummary
  ): Promise<SummaryRecord> {
    const row: SummaryRecord = {
      ...summary,
      id: this.db.uuid(),
      conversationId,
      createdAt: nowIso(this.db),
    }
    this.db.summaries.push(row)
    this.db.activeSummaries.set(conversationId, row.id)
    return row
  }
}
