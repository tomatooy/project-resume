// Only reviewed diagnostics may cross the content boundary.
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  "02000": "Database row not found",
  "22023": "Invalid database parameter",
  "22P02": "Invalid database input syntax",
  "23502": "Database not-null constraint failed",
  "23503": "Database foreign-key constraint failed",
  "23505": "Database unique constraint failed",
  "23514": "Database check constraint failed",
  "42501":
    "Database permission denied or row-level security rejected the write",
  "42703": "Database column does not exist; check deployed migrations",
  "42883": "Database function does not exist; check deployed migrations",
  "42P01": "Database relation does not exist; check deployed migrations",
  "57014": "Database statement timed out or was cancelled",
  P0002: "Database row not found",
  P0409: "Database revision conflict",
  P0429: "Hourly rate limit exceeded",
  PGRST202: "Database function missing from the PostgREST schema cache",
  PGRST204: "Database column missing from the PostgREST schema cache",
  PGRST205: "Database table missing from the PostgREST schema cache",
  UNAUTHENTICATED: "Authentication required",
  NOT_FOUND: "Requested resource not found",
  CONFLICT: "Concurrent modification conflict",
  VALIDATION: "Validation failed",
  RATE_LIMITED: "Rate limit exceeded",
  ECONNREFUSED: "Upstream connection refused",
  ECONNRESET: "Upstream connection reset",
  ETIMEDOUT: "Upstream connection timed out",
  ENOTFOUND: "Upstream DNS lookup failed",
}

const NAME_MESSAGES: Readonly<Record<string, string>> = {
  ZodError: "Stored data or model output did not match its schema",
  AI_APICallError: "Model provider request failed",
  AI_RetryError: "Model provider retries exhausted",
  AI_NoObjectGeneratedError: "Model did not generate valid structured output",
  AI_NoOutputGeneratedError: "Model did not generate output",
  AI_TypeValidationError: "Model output did not match its schema",
  AI_JSONParseError: "Model output could not be parsed as JSON",
  AI_LoadAPIKeyError: "Model provider API key is missing",
  AuthApiError: "Authentication service request failed",
  AuthRetryableFetchError: "Authentication service is temporarily unreachable",
  AbortError: "Operation aborted",
  TimeoutError: "Operation timed out",
  SyntaxError: "Invalid syntax or malformed JSON",
}

const SAFE_MESSAGES = new Set([
  "fetch failed",
  "Failed to fetch",
  "Network connection lost.",
  "The operation was aborted.",
  "The operation timed out.",
  "Maximum call stack size exceeded",
  "AI is not configured",
  "Conversation insert returned no row",
  "Workflow authorization failed",
  "Workflow deadline mismatch",
  "Tailoring claim failed",
  "Tailoring parse failed",
  "Tailoring generate failed",
  "Tailoring commit failed",
  "Tailoring attempt did not complete",
])

const CONFIG_NAMES = [
  "DEEPSEEK_API_KEY",
  "TYPESAFE_API_KEY",
  "OPENAI_API_KEY",
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
]

export type ErrorDiagnostic = {
  name: string
  code?: string
  message: string
  messageRedacted: boolean
  stack?: string
  status?: number
  retryable?: boolean
  cause?: ErrorDiagnostic
}

function property(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null) return undefined
  // Error getters and proxies must not break the request's error handler.
  try {
    return Reflect.get(error, key)
  } catch {
    return undefined
  }
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,80}$/.test(value)
    ? value
    : undefined
}

export function errorClassOf(error: unknown): string {
  return (
    identifier(property(error, "code")) ??
    identifier(property(error, "name")) ??
    (error instanceof Error ? "Error" : typeof error)
  )
}

function safeMessage(
  error: unknown,
  name: string,
  code?: string
): string | undefined {
  const message = property(error, "message")
  if (typeof message === "string") {
    // Schema identifiers are useful; row values, details and hints are not.
    if (
      code === "42703" &&
      /^column [a-zA-Z_][a-zA-Z0-9_."]{0,160} does not exist$/.test(message)
    )
      return message
    if (
      (code === "42P01" || code === "42883") &&
      /^(?:relation|function) "[a-zA-Z_][a-zA-Z0-9_.]{0,160}" does not exist$/.test(
        message
      )
    )
      return message
    if (
      code === "PGRST204" &&
      /^Could not find the '[a-zA-Z_][a-zA-Z0-9_]{0,80}' column of '[a-zA-Z_][a-zA-Z0-9_]{0,80}' in the schema cache$/.test(
        message
      )
    )
      return message
    for (const config of CONFIG_NAMES) {
      if (message.startsWith(`${config} is not set.`))
        return `${config} is not set`
    }
    if (SAFE_MESSAGES.has(message)) return message
    if (
      name === "TypeError" &&
      /^Cannot (?:read|set) properties of (?:undefined|null) \((?:reading|setting) '[a-zA-Z_$][a-zA-Z0-9_$]{0,80}'\)$/.test(
        message
      )
    )
      return message
    if (
      name === "ReferenceError" &&
      /^[a-zA-Z_$][a-zA-Z0-9_$]{0,80} is not defined$/.test(message)
    )
      return message
  }
  if (code && Object.hasOwn(CODE_MESSAGES, code)) return CODE_MESSAGES[code]
  return Object.hasOwn(NAME_MESSAGES, name) ? NAME_MESSAGES[name] : undefined
}

function stackFrames(error: unknown): string | undefined {
  const stack = property(error, "stack")
  if (typeof stack !== "string") return undefined
  const name = property(error, "name")
  const message = property(error, "message")
  if (typeof name !== "string" || typeof message !== "string") return undefined
  const header = message ? `${name}: ${message}` : name
  if (!stack.startsWith(header)) return undefined
  // Remove the full message, including multiline content that resembles a frame.
  const locations = stack.slice(header.length, header.length + 16_000)
  const frames: string[] = []
  for (const line of locations.split("\n")) {
    const frame =
      /^\s+at (?:[\w.$<> ]+ \()?((?:[\w@./:-]+\/)?[\w.-]+\.[cm]?[jt]sx?:\d+:\d+)\)?$/.exec(
        line
      )
    if (frame?.[1]) frames.push(`at ${frame[1].split("/").at(-1)}`)
    if (frames.length === 12) break
  }
  return frames.length ? frames.join("\n") : undefined
}

export function errorDiagnostic(error: unknown): ErrorDiagnostic {
  return diagnose(error, new Set(), 0)
}

function diagnose(
  error: unknown,
  seen: Set<unknown>,
  depth: number
): ErrorDiagnostic {
  seen.add(error)
  const name =
    identifier(property(error, "name")) ??
    (error instanceof Error ? "Error" : typeof error)
  const code = identifier(property(error, "code"))
  const message = safeMessage(error, name, code)
  const status = property(error, "statusCode") ?? property(error, "status")
  const retryable = property(error, "isRetryable")
  const cause = property(error, "cause") ?? property(error, "lastError")
  return {
    name,
    code,
    message: message ?? "Unrecognized error; inspect the code, stack and cause",
    messageRedacted:
      message === undefined || message !== property(error, "message"),
    stack: stackFrames(error),
    status:
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : undefined,
    retryable: typeof retryable === "boolean" ? retryable : undefined,
    cause:
      cause !== undefined && cause !== null && depth < 3 && !seen.has(cause)
        ? diagnose(cause, seen, depth + 1)
        : undefined,
  }
}
