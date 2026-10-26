import { AsyncLocalStorage } from "node:async_hooks"
import { errorClassOf, errorDiagnostic } from "./log-error"

export { errorClassOf } from "./log-error"

// Metadata only. Exceptions go through the diagnostic allowlist separately.
export type LogFields = {
  requestId?: string
  cfRay?: string
  method?: string
  route?: string
  operationId?: string
  step?: string
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
  /** Static contract path, never URL parameters or inputs. */
  procedure?: string
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
  warn(event: string, fields?: LogFields, error?: unknown): void
  error(event: string, fields?: LogFields, error?: unknown): void
}

type Level = "info" | "warn" | "error"

const context = new AsyncLocalStorage<LogFields>()

export function withLogContext<T>(fields: LogFields, work: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, work)
}

function write(
  level: Level,
  event: string,
  fields: LogFields,
  error?: unknown
): void {
  const line = {
    level,
    event,
    message: event,
    ...fields,
    ...(error === undefined
      ? {}
      : {
          errorClass: errorClassOf(error),
          error: errorDiagnostic(error),
        }),
    at: new Date().toISOString(),
  }
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export function createLogger(base: LogFields = {}): Logger {
  const fields = { ...context.getStore(), ...base }
  return {
    info: (event, extra) => write("info", event, { ...fields, ...extra }),
    warn: (event, extra, error) =>
      write("warn", event, { ...fields, ...extra }, error),
    error: (event, extra, error) =>
      write("error", event, { ...fields, ...extra }, error),
  }
}
