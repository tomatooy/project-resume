import {
  type ChatMessage,
  MessageMetadataSchema,
  type MessagePart,
  MessagePartSchema,
  type MessageRepository,
  type NewChatMessage,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"
import type { Database } from "@workspace/supabase"
import { toJson } from "./json"

type Row = Database["public"]["Tables"]["messages"]["Row"]

const COLUMNS =
  "id, conversation_id, seq, role, content, agent_run_id, metadata, created_at"

/**
 * Parts are parsed one at a time and unknown ones dropped, rather than the
 * whole array parsed or nothing. A history written before a part type was
 * retired must still load; losing one card is better than losing the thread.
 */
function toParts(content: Row["content"]): MessagePart[] {
  if (!Array.isArray(content)) return []
  const parts: MessagePart[] = []
  for (const candidate of content) {
    const parsed = MessagePartSchema.safeParse(candidate)
    if (parsed.success) parts.push(parsed.data)
  }
  return parts
}

function toMessage(row: Row): ChatMessage {
  const metadata = MessageMetadataSchema.safeParse(row.metadata)
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    role: row.role,
    parts: toParts(row.content),
    agentRunId: row.agent_run_id,
    metadata: metadata.success ? metadata.data : {},
    createdAt: row.created_at,
  }
}

export class SupabaseMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  async append(message: NewChatMessage): Promise<ChatMessage> {
    const { data, error } = await this.db
      .from("messages")
      .insert({
        conversation_id: message.conversationId,
        role: message.role,
        content: toJson(message.parts),
        agent_run_id: message.agentRunId,
        metadata: toJson(message.metadata),
      })
      .select(COLUMNS)
      .single()
    if (error) throw error
    return toMessage(data)
  }

  /**
   * Fetched newest first so `limit` trims the old end, then reversed: the
   * window is the last N messages, not the first N after the summary.
   */
  async listAfter(
    conversationId: string,
    afterSeq: number | null,
    limit: number
  ): Promise<ChatMessage[]> {
    let query = this.db
      .from("messages")
      .select(COLUMNS)
      .eq("conversation_id", conversationId)
    if (afterSeq !== null) query = query.gt("seq", afterSeq)
    const { data, error } = await query
      .order("seq", { ascending: false })
      .limit(limit)
    if (error) throw error
    return data.map(toMessage).reverse()
  }

  async countAfter(
    conversationId: string,
    afterSeq: number | null
  ): Promise<number> {
    let query = this.db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
    if (afterSeq !== null) query = query.gt("seq", afterSeq)
    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  }

  async clearForConversation(conversationId: string): Promise<void> {
    const { error } = await this.db
      .from("messages")
      .delete()
      .eq("conversation_id", conversationId)
    if (error) throw error
  }
}
