import type { ParsedResume, Resume } from "@workspace/resume-schema"

import type { ParsedJobPosting } from "../domain/job-target"

export type TailorResumeInput = {
  /** The source document, ids and all. The model is not asked to keep them. */
  resume: Resume
  posting: ParsedJobPosting
  signal?: AbortSignal
}

export type TailorResumeResult = {
  /**
   * Id-free, like import's output. Models cannot reliably emit ids that satisfy
   * the strict format and the global uniqueness check, so `assembleResume`
   * mints them instead and the model never sees one it has to preserve.
   */
  parsed: ParsedResume
  model: string
}

/** The second of the two model calls behind tailoring. Implemented in `@workspace/agent`. */
export interface ResumeTailor {
  tailor(input: TailorResumeInput): Promise<TailorResumeResult>
}
