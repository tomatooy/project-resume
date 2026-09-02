export interface ConversationRepository {
  /** One conversation per resume, created on first use. */
  getOrCreate(resumeId: string): Promise<{ id: string }>
}
