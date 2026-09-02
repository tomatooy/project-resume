import type { ConversationRepository } from "../ports/conversation-repository"
import type { InMemoryDb } from "./db"

export class InMemoryConversationRepository implements ConversationRepository {
  constructor(private readonly db: InMemoryDb) {}

  async getOrCreate(resumeId: string): Promise<{ id: string }> {
    const existing = this.db.conversations.find((c) => c.resumeId === resumeId)
    if (existing) return { id: existing.id }
    const row = { id: this.db.uuid(), resumeId }
    this.db.conversations.push(row)
    return { id: row.id }
  }
}
