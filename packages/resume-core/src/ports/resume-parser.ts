import type { ParsedResume } from "@workspace/resume-schema"

export type ParseResumeInput = {
  /** Plain text: extracted from a PDF in the browser, or pasted by the user. */
  text: string
  signal?: AbortSignal
}

export type ParseResumeResult = {
  parsed: ParsedResume
  /** Which model read it; goes to the log, never to a row. */
  model: string
}

/** The model call behind import. Implemented in `@workspace/agent`. */
export interface ResumeParser {
  parse(input: ParseResumeInput): Promise<ParseResumeResult>
}
