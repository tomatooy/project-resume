import { AppError } from "@workspace/resume-core"
import type { PostgrestError } from "@supabase/supabase-js"
import { setResponseStatus } from "@tanstack/react-start/server"

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
