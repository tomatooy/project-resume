import type { ChatMessage } from "../domain/chat"
import type { MemorySummary } from "../domain/memory"

export type SummarizeInput = {
  previous: MemorySummary | null
  messages: ChatMessage[]
}

export type SummarizeResult = {
  summary: MemorySummary
  /** Which model wrote it; recorded on the row. */
  model: string
}

/** The model call behind consolidation. Implemented in `@workspace/agent`. */
export interface Summarizer {
  summarize(input: SummarizeInput): Promise<SummarizeResult>
}
