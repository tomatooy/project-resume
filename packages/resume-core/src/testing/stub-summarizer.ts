import { EMPTY_SUMMARY, type MemorySummary } from "../domain/memory"
import type {
  SummarizeInput,
  SummarizeResult,
  Summarizer,
} from "../ports/summarizer"

export class StubSummarizer implements Summarizer {
  result: MemorySummary = EMPTY_SUMMARY
  model = "stub"
  failWith: Error | null = null
  readonly calls: SummarizeInput[] = []

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    this.calls.push(input)
    if (this.failWith) throw this.failWith
    return { summary: this.result, model: this.model }
  }
}
