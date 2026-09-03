/**
 * The error type every service throws. Server functions map it to
 * `{ error: { code, message } }` plus a status, and the browser turns that
 * back into an `ApiError` with the same codes, so a conflict stays a conflict
 * all the way from Postgres to the editor's conflict banner.
 */
export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "INTERNAL"

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly status: number

  constructor(
    readonly code: AppErrorCode,
    message: string,
    status?: number,
    /** Set on RATE_LIMITED; becomes the `Retry-After` header. */
    readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = "AppError"
    this.status = status ?? STATUS[code]
  }
}

export function statusForCode(code: AppErrorCode): number {
  return STATUS[code]
}
