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
  skillId?: string
  model?: string
  status?: number
  errorClass?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  steps?: number
  outcome?: string
  count?: number
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
 */
export function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.name || "Error"
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code)
  }
  return typeof error
}
