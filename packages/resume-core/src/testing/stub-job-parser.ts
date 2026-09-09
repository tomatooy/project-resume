import type { ParsedJobPosting } from "../domain/job-target"
import type {
  JobParser,
  ParseJobInput,
  ParseJobResult,
} from "../ports/job-parser"

const EMPTY: ParsedJobPosting = {
  title: "",
  company: "",
  mustHaves: [],
  niceToHaves: [],
  keywords: [],
}

export class StubJobParser implements JobParser {
  result: ParsedJobPosting = EMPTY
  model = "stub"
  failWith: Error | null = null
  readonly calls: ParseJobInput[] = []

  async parse(input: ParseJobInput): Promise<ParseJobResult> {
    this.calls.push(input)
    if (this.failWith) throw this.failWith
    return { parsed: this.result, model: this.model }
  }
}
