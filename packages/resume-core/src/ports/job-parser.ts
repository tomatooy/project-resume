import type { ParsedJobPosting } from "../domain/job-target"

export type ParseJobInput = {
  /** The posting as plain text: fetched from LinkedIn, or pasted. */
  text: string
  signal?: AbortSignal
}

export type ParseJobResult = {
  parsed: ParsedJobPosting
  /** Which model read it; goes to the log, never to a row. */
  model: string
}

/** The first of the two model calls behind tailoring. Implemented in `@workspace/agent`. */
export interface JobParser {
  parse(input: ParseJobInput): Promise<ParseJobResult>
}
