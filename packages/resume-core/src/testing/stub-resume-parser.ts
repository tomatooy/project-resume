import type { ParsedResume } from "@workspace/resume-schema"

import type {
  ParseResumeInput,
  ParseResumeResult,
  ResumeParser,
} from "../ports/resume-parser"

const EMPTY: ParsedResume = { basics: {}, sections: [] }

export class StubResumeParser implements ResumeParser {
  result: ParsedResume = EMPTY
  model = "stub"
  failWith: Error | null = null
  readonly calls: ParseResumeInput[] = []

  async parse(input: ParseResumeInput): Promise<ParseResumeResult> {
    this.calls.push(input)
    if (this.failWith) throw this.failWith
    return { parsed: this.result, model: this.model }
  }
}
