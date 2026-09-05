import { AppError } from "@workspace/resume-core"
import type { PostgrestError } from "@supabase/supabase-js"
import { setResponseStatus } from "@tanstack/react-start/server"
import type { z } from "zod"

import type { Logger } from "./log"

/**
 * Postgres error codes that mean something specific to a caller. Everything
 * else becomes an opaque INTERNAL, because a database message can quote the
 * row that failed and rows here hold resume text.
 */
const PG_CODES: Record<string, AppError["code"]> = {
  // Insufficient privilege. RLS refused the write. Reporting this as a 403
  // would tell the caller the row exists and belongs to someone else, so it is
  // deliberately flattened into the same answer as a missing row.
  "42501": "NOT_FOUND",
  // No data found, raised by the RPCs when the resume or run is not visible.
  "02000": "NOT_FOUND",
  P0002: "NOT_FOUND",
  // Unique violation. Two writers raced for the same version number.
  "23505": "CONFLICT",
  // Foreign key violation: the parent row is gone, or was never visible.
  "23503": "NOT_FOUND",
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "details" in error
  )
}

/**
 * Checks a request body or query against its schema. A mismatch is the
 * caller's fault and says so with a 400.
 *
 * This is the only place a schema failure means VALIDATION. A Zod error
 * thrown anywhere else comes from a stored row that no longer parses, which
 * is a server fault and falls through `toAppError` as INTERNAL. Mapping every
 * Zod error to 400 used to blame the request for corrupt storage.
 */
export function parseRequest<S extends z.ZodType>(
  schema: S,
  input: unknown
): z.output<S> {
  const result = schema.safeParse(input)
  if (!result.success) throw new AppError("VALIDATION", "Invalid request")
  return result.data
}

/**
 * Turns anything thrown below a handler into an `AppError`.
 *
 * Note what is *not* carried across: `error.details` and `error.hint` from
 * PostgREST can echo the offending row back, and these rows hold resume and
 * message content. Only the code crosses this line.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (isPostgrestError(error)) {
    const code = PG_CODES[error.code]
    if (code) return new AppError(code, messageFor(code))
    return new AppError("INTERNAL", "Something went wrong")
  }

  return new AppError("INTERNAL", "Something went wrong")
}

function messageFor(code: AppError["code"]): string {
  switch (code) {
    case "NOT_FOUND":
      return "Not found"
    case "CONFLICT":
      return "This resume changed in another tab"
    default:
      return "Something went wrong"
  }
}

/**
 * Sets the HTTP status and rethrows, so the browser sees a real 404 or 409.
 *
 * The error itself is serialized to the client by TanStack Start, own
 * properties included, which is how `code` survives the trip and `api.ts` can
 * turn it back into an `ApiError` the editor's conflict banner recognises.
 */
export function failWith(error: unknown): never {
  const appError = toAppError(error)
  setResponseStatus(appError.status)
  throw appError
}

/**
 * The route counterpart of `failWith`: the JSON shape the browser's
 * `toApiError` already understands, for a request refused before any stream
 * started. Once a stream is open, errors travel inside it instead and the
 * status is long gone.
 */
export function errorResponse(error: unknown, log: Logger): Response {
  const appError = toAppError(error)

  if (appError.status >= 500) {
    log.error("request_failed", { errorClass: errorClassOf(error) })
  } else {
    log.info("request_rejected", {
      status: appError.status,
      errorClass: appError.code,
    })
  }

  const headers = new Headers({ "content-type": "application/json" })
  if (appError.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(appError.retryAfterSeconds))
  }
  return new Response(
    JSON.stringify({
      error: { code: appError.code, message: appError.message },
    }),
    { status: appError.status, headers }
  )
}

function errorClassOf(error: unknown): string {
  if (error instanceof AppError) return error.code
  if (error instanceof Error) return error.name
  return typeof error
}
