/**
 * Structured request logging with a closed field list.
 *
 * Privacy here is by construction, not by review: the only fields that can be
 * logged are the ones named in `LogFields`, and none of them can hold resume
 * text, a message, a job description, or a patch. Adding a field means adding
 * it to this type, which is the moment to ask whether it is content.
 */
export type LogFields = {
  requestId?: string
  userId?: string
  resumeId?: string
  conversationId?: string
  runId?: string
  /** The playbook the composer hinted at, or a writer id. Never content. */
  hintSkillId?: string
  jobTargetId?: string
  model?: string
  status?: number
  errorClass?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  steps?: number
  outcome?: string
  /** Whether the user enabled removing and restructuring for the turn. */
  structural?: boolean
  /** The step budget ran out with nothing proposed. */
  budgetExhausted?: boolean
  count?: number
  /** Whether a tailoring run wrote the document or left a plain duplicate. */
  tailored?: boolean
  /** Length of the text an import read. A size, never the text itself. */
  charCount?: number
}

export type Logger = {
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
}

type Level = "info" | "warn" | "error"

function write(level: Level, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    level,
    event,
    ...fields,
    at: new Date().toISOString(),
  })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export function createLogger(base: LogFields = {}): Logger {
  return {
    info: (event, fields) => write("info", event, { ...base, ...fields }),
    warn: (event, fields) => write("warn", event, { ...base, ...fields }),
    error: (event, fields) => write("error", event, { ...base, ...fields }),
  }
}

/**
 * The class of an error, never its message. A message from PostgREST or a
 * model provider can quote the row or the prompt that failed.
 *
 * A `code` wins over the class name on purpose. The values thrown from the
 * data layer are plain PostgREST objects rather than `Error`s, and their
 * SQLSTATE is the only thing that says *what* broke: a missing column is
 * `42703`, a stale schema cache is `PGRST204`, a unique violation is `23505`.
 * Reading the name first made all of those log as `object`, which is how a
 * pending migration looked like an unexplained 500.
 */
export function errorClassOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === "string" && code.length > 0) return code
  }
  if (error instanceof Error) return error.name || "Error"
  return typeof error
}
