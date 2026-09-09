import type { ParsedResume } from "@workspace/resume-schema"

import type {
  ResumeTailor,
  TailorResumeInput,
  TailorResumeResult,
} from "../ports/resume-tailor"

const EMPTY: ParsedResume = { basics: {}, sections: [] }

export class StubResumeTailor implements ResumeTailor {
  result: ParsedResume = EMPTY
  model = "stub"
  failWith: Error | null = null
  readonly calls: TailorResumeInput[] = []

  async tailor(input: TailorResumeInput): Promise<TailorResumeResult> {
    this.calls.push(input)
    if (this.failWith) throw this.failWith
    return { parsed: this.result, model: this.model }
  }
}
