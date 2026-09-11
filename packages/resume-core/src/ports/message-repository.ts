import type { ChatMessage, NewChatMessage } from "../domain/chat"

export interface MessageRepository {
  append(message: NewChatMessage): Promise<ChatMessage>
  /**
   * The last `limit` messages with `seq > afterSeq` (all of them when
   * `afterSeq` is null), returned oldest first.
   */
  listAfter(
    conversationId: string,
    afterSeq: number | null,
    limit: number
  ): Promise<ChatMessage[]>
  countAfter(conversationId: string, afterSeq: number | null): Promise<number>
  /**
   * Drops the whole transcript. The conversation row stays, so its id and the
   * runs recorded against it survive the clear.
   */
  clearForConversation(conversationId: string): Promise<void>
}
