import type { ConversationRepository } from "@workspace/resume-core"

import type { Db } from "../auth/supabase"

export class SupabaseConversationRepository implements ConversationRepository {
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  /**
   * `conversations` has `unique (resume_id)`, so the insert is what settles a
   * race between two tabs opening the assistant at once. The loser reads the
   * winner's row rather than creating a second conversation.
   */
  async getOrCreate(resumeId: string): Promise<{ id: string }> {
    const existing = await this.find(resumeId)
    if (existing) return existing

    const { data, error } = await this.db
      .from("conversations")
      .insert({ user_id: this.userId, resume_id: resumeId })
      .select("id")
      .maybeSingle()

    if (error) {
      // 23505 is the unique violation on resume_id: someone else got there
      // first, between the select above and this insert.
      if (error.code !== "23505") throw error
      const raced = await this.find(resumeId)
      if (!raced) throw error
      return raced
    }
    if (!data) throw new Error("Conversation insert returned no row")
    return { id: data.id }
  }

  private async find(resumeId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.db
      .from("conversations")
      .select("id")
      .eq("resume_id", resumeId)
      .maybeSingle()
    if (error) throw error
    return data ? { id: data.id } : null
  }
}
