import type { ChatMessage } from "../domain/chat"
import { renderSummaryText } from "../domain/memory"
import type { MessageRepository } from "../ports/message-repository"
import type { Summarizer } from "../ports/summarizer"
import type { SummaryRepository } from "../ports/summary-repository"

export type MemoryContext = {
  /** The active consolidated summary, rendered; null before the first one. */
  summaryText: string | null
  /** The short-term window, oldest first. */
  messages: ChatMessage[]
}

export type MemoryOptions = {
  /** How many recent messages each model request sees. */
  window: number
  /** How many messages accumulate past the active summary before a new one. */
  threshold: number
}

const DEFAULTS: MemoryOptions = { window: 12, threshold: 12 }

/**
 * The three memory layers from the over-all design, section 6.4: the recent
 * window, the consolidated summary, and the full history on demand. The
 * policy is here; the model call behind consolidation is a port.
 */
export class MemoryService {
  private readonly options: MemoryOptions

  constructor(
    private readonly messages: MessageRepository,
    private readonly summaries: SummaryRepository,
    private readonly summarizer: Summarizer,
    options: Partial<MemoryOptions> = {}
  ) {
    this.options = { ...DEFAULTS, ...options }
  }

  async buildContext(conversationId: string): Promise<MemoryContext> {
    const active = await this.summaries.findActive(conversationId)
    const messages = await this.messages.listAfter(
      conversationId,
      active?.sourceToSeq ?? null,
      this.options.window
    )
    return { summaryText: active?.summaryText ?? null, messages }
  }

  history(conversationId: string, limit = 100): Promise<ChatMessage[]> {
    return this.messages.listAfter(conversationId, null, limit)
  }

  /**
   * Runs after a completed response, off the request path. Errors propagate so
   * the caller can log the class; nothing is written until the summariser has
   * answered, so a failure leaves the previous summary active.
   */
  async maybeConsolidate(
    conversationId: string
  ): Promise<"skipped" | "consolidated"> {
    const active = await this.summaries.findActive(conversationId)
    const afterSeq = active?.sourceToSeq ?? null
    const pending = await this.messages.countAfter(conversationId, afterSeq)
    if (pending < this.options.threshold) return "skipped"

    const messages = await this.messages.listAfter(
      conversationId,
      afterSeq,
      pending
    )
    const first = messages[0]
    const last = messages[messages.length - 1]
    if (!first || !last) return "skipped"

    const { summary, model } = await this.summarizer.summarize({
      previous: active?.summary ?? null,
      messages,
    })
    await this.summaries.create(conversationId, {
      summary,
      summaryText: renderSummaryText(summary),
      sourceFromSeq: first.seq,
      sourceToSeq: last.seq,
      model,
    })
    return "consolidated"
  }
}
