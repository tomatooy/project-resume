import type { ChatMessage, NewChatMessage } from "../domain/chat"
import type { MessageRepository } from "../ports/message-repository"
import { type InMemoryDb, nowIso } from "./db"

export class InMemoryMessageRepository implements MessageRepository {
  constructor(private readonly db: InMemoryDb) {}

  async append(message: NewChatMessage): Promise<ChatMessage> {
    const row: ChatMessage = {
      ...message,
      id: this.db.uuid(),
      seq: this.db.nextMessageSeq(),
      createdAt: nowIso(this.db),
    }
    this.db.messages.push(row)
    return row
  }

  async listAfter(
    conversationId: string,
    afterSeq: number | null,
    limit: number
  ): Promise<ChatMessage[]> {
    return this.db.messages
      .filter(
        (m) => m.conversationId === conversationId && m.seq > (afterSeq ?? 0)
      )
      .sort((a, b) => a.seq - b.seq)
      .slice(-limit)
  }

  async countAfter(
    conversationId: string,
    afterSeq: number | null
  ): Promise<number> {
    return this.db.messages.filter(
      (m) => m.conversationId === conversationId && m.seq > (afterSeq ?? 0)
    ).length
  }
}
